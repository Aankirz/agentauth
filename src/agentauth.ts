import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomUUID } from 'node:crypto';
import { MemoryStore, type RevocationStore } from './store.js';
import type { Grant, AgentClaims, VerifyOptions } from './types.js';

export interface AgentAuthConfig {
  /** HS256 signing secret. Must be at least 32 bytes. Keep it server-side only. */
  secret: string | Uint8Array;
  issuer?: string;
  audience?: string;
  defaultTtlSeconds?: number;
  store?: RevocationStore;
}

const DEFAULT_TTL_SECONDS = 15 * 60; // short-lived by default
const MIN_SECRET_BYTES = 32;

export class AgentAuth {
  private readonly key: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly ttl: number;
  private readonly store: RevocationStore;

  constructor(config: AgentAuthConfig) {
    if (!config.secret) throw new Error('AgentAuth: secret is required');
    this.key =
      typeof config.secret === 'string'
        ? new TextEncoder().encode(config.secret)
        : config.secret;
    if (this.key.length < MIN_SECRET_BYTES) {
      throw new Error(`AgentAuth: secret must be at least ${MIN_SECRET_BYTES} bytes for HS256`);
    }
    this.issuer = config.issuer ?? 'agentauth';
    this.audience = config.audience ?? 'agentauth';
    this.ttl = config.defaultTtlSeconds ?? DEFAULT_TTL_SECONDS;
    this.store = config.store ?? new MemoryStore();
  }

  /** Mint a scoped, short-lived token from a user's grant to an agent. */
  async issue(grant: Grant): Promise<{ token: string; jti: string; expiresAt: number }> {
    if (!grant.subject) throw new Error('issue: subject is required');
    if (!grant.agent) throw new Error('issue: agent is required');
    if (!grant.scopes?.length) throw new Error('issue: at least one scope is required');

    const jti = randomUUID();
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + (grant.ttlSeconds ?? this.ttl);

    const token = await new SignJWT({ agent: grant.agent, scopes: grant.scopes })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(grant.subject)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setJti(jti)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.key);

    return { token, jti, expiresAt: exp };
  }

  /** Verify a token's signature, claims, revocation status, and required scopes. */
  async verify(token: string, opts: VerifyOptions = {}): Promise<AgentClaims> {
    const { payload } = await jwtVerify(token, this.key, {
      issuer: this.issuer,
      audience: this.audience,
    });
    const claims = toClaims(payload);

    if (await this.store.isRevoked(claims.jti)) {
      throw new Error('AgentAuth: token has been revoked');
    }
    const missing = (opts.requiredScopes ?? []).filter((s) => !claims.scopes.includes(s));
    if (missing.length) {
      throw new Error(`AgentAuth: missing required scope(s): ${missing.join(', ')}`);
    }
    return claims;
  }

  /** Revoke by raw jti or by full token (the jti + expiry are read from the token). */
  async revoke(jtiOrToken: string): Promise<void> {
    let jti = jtiOrToken;
    let expiresAt = Math.floor(Date.now() / 1000) + this.ttl;
    try {
      const { payload } = await jwtVerify(jtiOrToken, this.key, {
        issuer: this.issuer,
        audience: this.audience,
      });
      jti = String(payload.jti);
      expiresAt = Number(payload.exp);
    } catch {
      // Not a valid token — treat the input as a bare jti.
    }
    await this.store.revoke(jti, expiresAt);
  }
}

function toClaims(p: JWTPayload): AgentClaims {
  return {
    sub: String(p.sub),
    agent: String((p as Record<string, unknown>).agent),
    scopes: ((p as Record<string, unknown>).scopes as string[]) ?? [],
    jti: String(p.jti),
    iss: String(p.iss),
    aud: String(p.aud),
    iat: Number(p.iat),
    exp: Number(p.exp),
  };
}

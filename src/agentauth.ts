import { SignJWT, jwtVerify, errors as joseErrors, type JWTPayload } from 'jose';
import { randomUUID } from 'node:crypto';
import { MemoryStore, type RevocationStore, type RevocationCriteria } from './store.js';
import { missingScopes } from './scope.js';
import {
  AgentAuthError,
  InvalidConfigError,
  InvalidGrantError,
  MissingScopeError,
  RevokedError,
  TokenExpiredError,
  TokenInvalidError,
} from './errors.js';
import type { Grant, AgentClaims, VerifyOptions, AgentAuthEvent } from './types.js';

export interface AgentAuthConfig {
  /** HS256 signing secret. Must be at least 32 bytes. Keep it server-side only. */
  secret: string | Uint8Array;
  issuer?: string;
  audience?: string;
  defaultTtlSeconds?: number;
  /** Key id stamped into each token header so signing keys can rotate. */
  kid?: string;
  /** Allowed clock skew (seconds) between issuer and verifier. Default 30. */
  clockToleranceSeconds?: number;
  /** Default for whether verify() consults the revocation store. Default true. */
  checkRevocation?: boolean;
  store?: RevocationStore;
  /** Structured audit hook; a throwing handler never breaks auth. */
  onEvent?: (event: AgentAuthEvent) => void;
}

const DEFAULT_TTL_SECONDS = 15 * 60;
const DEFAULT_CLOCK_TOLERANCE = 30;
const MIN_SECRET_BYTES = 32;

export class AgentAuth {
  private readonly key: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly ttl: number;
  private readonly kid?: string;
  private readonly clockTolerance: number;
  private readonly checkRevocationDefault: boolean;
  private readonly store: RevocationStore;
  private readonly onEvent?: (event: AgentAuthEvent) => void;
  /** Longest TTL this instance has ever issued — bounds how long jti/criteria revocations must live. */
  private maxIssuedTtl: number;

  constructor(config: AgentAuthConfig) {
    if (!config.secret) throw new InvalidConfigError('secret is required');
    this.key =
      typeof config.secret === 'string'
        ? new TextEncoder().encode(config.secret)
        : config.secret;
    if (this.key.length < MIN_SECRET_BYTES) {
      throw new InvalidConfigError(`secret must be at least ${MIN_SECRET_BYTES} bytes for HS256`);
    }
    this.issuer = config.issuer ?? 'agentauth';
    this.audience = config.audience ?? 'agentauth';
    this.ttl = config.defaultTtlSeconds ?? DEFAULT_TTL_SECONDS;
    this.kid = config.kid;
    this.clockTolerance = config.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE;
    this.checkRevocationDefault = config.checkRevocation ?? true;
    this.store = config.store ?? new MemoryStore();
    this.onEvent = config.onEvent;
    this.maxIssuedTtl = this.ttl;
  }

  /** Mint a scoped, short-lived token from a user's grant to an agent. */
  async issue(grant: Grant): Promise<{ token: string; jti: string; expiresAt: number }> {
    if (!grant.subject) throw new InvalidGrantError('subject is required');
    if (!grant.agent) throw new InvalidGrantError('agent is required');
    if (!grant.scopes?.length) throw new InvalidGrantError('at least one scope is required');
    // Trust-boundary validation: reject blank scopes so `[""]` can't silently match a required `""`.
    if (grant.scopes.some((s) => typeof s !== 'string' || s.trim() === '')) {
      throw new InvalidGrantError('scopes must be non-empty strings');
    }

    const jti = randomUUID();
    const iat = Math.floor(Date.now() / 1000);
    const ttlSeconds = grant.ttlSeconds ?? this.ttl;
    const exp = iat + ttlSeconds;
    if (ttlSeconds > this.maxIssuedTtl) this.maxIssuedTtl = ttlSeconds;

    const header: { alg: 'HS256'; kid?: string } = { alg: 'HS256' };
    if (this.kid) header.kid = this.kid;

    const token = await new SignJWT({ agent: grant.agent, scopes: grant.scopes })
      .setProtectedHeader(header)
      .setSubject(grant.subject)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setJti(jti)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.key);

    this.emit({ type: 'issued', jti, subject: grant.subject, agent: grant.agent, scopes: grant.scopes, expiresAt: exp });
    return { token, jti, expiresAt: exp };
  }

  /** Verify a token's signature, claims, revocation status, and required scopes. */
  async verify(token: string, opts: VerifyOptions = {}): Promise<AgentClaims> {
    let claims: AgentClaims;
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: this.clockTolerance,
        algorithms: ['HS256'],
      });
      claims = toClaims(payload);
    } catch (err) {
      const wrapped =
        err instanceof joseErrors.JWTExpired ? new TokenExpiredError() : new TokenInvalidError();
      this.emit({ type: 'denied', reason: wrapped.code });
      throw wrapped;
    }

    const shouldCheck = opts.checkRevocation ?? this.checkRevocationDefault;
    const revSubject = { jti: claims.jti, agent: claims.agent, subject: claims.sub };
    if (shouldCheck && (await this.store.isRevoked(revSubject))) {
      this.emit({ type: 'denied', reason: 'token_revoked', jti: claims.jti });
      throw new RevokedError();
    }

    const missing = missingScopes(claims.scopes, opts.requiredScopes ?? []);
    if (missing.length) {
      this.emit({ type: 'denied', reason: 'missing_scope', jti: claims.jti });
      throw new MissingScopeError(missing);
    }

    this.emit({ type: 'verified', jti: claims.jti, subject: claims.sub, agent: claims.agent, scopes: claims.scopes });
    return claims;
  }

  /**
   * Revoke a token (by raw jti, full token string, or criteria object).
   * jti/criteria revocations are held for the longest TTL this instance has issued,
   * so they reliably outlive any token minted by it. Note: with the default in-memory
   * store this is per-process — use a shared RevocationStore for multi-process setups.
   */
  async revoke(target: string | RevocationCriteria): Promise<void> {
    if (typeof target === 'object') {
      // No single token exp to key on — keep the entry alive for the longest TTL we've issued.
      const expiresAt = Math.floor(Date.now() / 1000) + this.maxIssuedTtl;
      await this.store.revoke(target, expiresAt);
      this.emit({ type: 'revoked', agent: target.agent, subject: target.subject, jti: target.jti });
      return;
    }

    let jti = target;
    // Bare jti: we can't read the token's exp, so bound the entry by the longest TTL issued.
    let expiresAt = Math.floor(Date.now() / 1000) + this.maxIssuedTtl;
    try {
      const { payload } = await jwtVerify(target, this.key, {
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: this.clockTolerance,
        algorithms: ['HS256'],
      });
      jti = String(payload.jti);
      expiresAt = Number(payload.exp);
    } catch {
      // Not a valid token — treat the input as a bare jti.
    }
    await this.store.revoke({ jti }, expiresAt);
    this.emit({ type: 'revoked', jti });
  }

  private emit(event: AgentAuthEvent): void {
    if (!this.onEvent) return;
    try {
      this.onEvent(event);
    } catch {
      // ponytail: audit must never break auth. A broken sink is the operator's problem, not the caller's.
    }
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function toClaims(p: JWTPayload): AgentClaims {
  const rawScopes = (p as Record<string, unknown>).scopes;
  return {
    sub: String(p.sub),
    agent: String((p as Record<string, unknown>).agent),
    scopes: isStringArray(rawScopes) ? rawScopes : [],
    jti: String(p.jti),
    iss: String(p.iss),
    // aud may be string | string[] per RFC 7519; issue() always sets one string.
    aud: Array.isArray(p.aud) ? (p.aud[0] ?? '') : String(p.aud ?? ''),
    iat: Number(p.iat),
    exp: Number(p.exp),
  };
}

export { AgentAuthError };

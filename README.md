# AgentAuth

**OAuth-style delegated authorization for AI agents and MCP servers.**

🌐 **[Landing page & quickstart →](https://aankirz.github.io/agentauth/)** · [Live demo](https://aankirz.github.io/agentauth/demo/) · [Tutorial](./docs/TUTORIAL.md)

Agents (ChatGPT, Claude, Gemini, Grok, your own) increasingly act *on behalf of a user* — reading email, calling internal APIs, hitting MCP tools. Handing them a full-access API key is the wrong default: it can't be scoped, can't be revoked, and never expires.

AgentAuth lets a user **grant** an agent a narrow set of permissions, mints a **scoped, short-lived, revocable token** from that grant, and gives your server a one-call **verify** to enforce it.

```
user ──grant(scopes)──▶ AgentAuth ──token──▶ agent ──token──▶ your API/MCP server ──verify──▶ ✅/❌
```

## Install

```bash
npm install agentauth
```

## Quick start

```ts
import { AgentAuth } from 'agentauth';

const auth = new AgentAuth({
  secret: process.env.AGENTAUTH_SECRET!, // >= 32 bytes, server-side only
  issuer: 'my-app',
  audience: 'my-api',
});

// 1. User authorizes an agent for specific scopes.
const { token } = await auth.issue({
  subject: 'user_123',
  agent: 'agent_research_bot',
  scopes: ['email:read', 'calendar:read'],
  ttlSeconds: 600,
});

// 2. The agent presents that token to your API.
const claims = await auth.verify(token, { requiredScopes: ['email:read'] });
//    claims.sub === 'user_123', claims.scopes === ['email:read','calendar:read']

// 3. Revoke any time. By token, bare jti, or criteria.
await auth.revoke(token);                 // one token
await auth.revoke({ agent: 'agent_research_bot' }); // "disconnect this agent"
await auth.revoke({ subject: 'user_123' });         // every token for a user
```

## Config

```ts
new AgentAuth({
  secret,                      // required, >= 32 bytes
  issuer: 'my-app',
  audience: 'my-api',
  defaultTtlSeconds: 900,      // 15 min default
  kid: 'k1',                   // stamped in the token header for key rotation
  clockToleranceSeconds: 30,   // skew allowed on verify
  checkRevocation: true,       // set false for a stateless verify fast path
  store: new MemoryStore(),    // swap for Redis/DB
  onEvent: (e) => log(e),      // 'issued' | 'verified' | 'denied' | 'revoked'
});
```

## API

| Method | Purpose |
|---|---|
| `new AgentAuth(config)` | Configure signing, TTL, rotation, revocation, audit hook. |
| `issue(grant)` | Mint a token from `{ subject, agent, scopes, ttlSeconds? }`. Returns `{ token, jti, expiresAt }`. |
| `verify(token, { requiredScopes?, checkRevocation? })` | Validate signature, expiry, audience, scopes, and (optionally) revocation. Returns `AgentClaims` or throws a typed error. |
| `revoke(tokenOrJtiOrCriteria)` | Revoke by token string, bare jti, or `{ jti?, agent?, subject? }`. |

### Scopes

Compared by equality, plus wildcards: a granted `email:*` satisfies a required `email:read`, and `*` satisfies anything. Blank scopes are rejected at `issue`.

### Errors

`verify`/`issue` throw typed errors extending `AgentAuthError`, each with a stable `.code`: `TokenInvalidError`, `TokenExpiredError`, `RevokedError`, `MissingScopeError` (carries `.missing` for server-side logging — its message is intentionally generic so an agent can't read off scopes to escalate to), `InvalidGrantError`, `InvalidConfigError`.

### Revocation lifetime

`revoke(token)` keys the entry to the token's own expiry. Revoking by bare jti or criteria keys it to the longest TTL this instance has issued, so it reliably outlives any token it minted. With the default in-memory store this is per-process — use a shared `RevocationStore` for multi-process setups.

### Revocation stores

Revocation defaults to an in-memory store. For multi-process or persistent revocation, implement `RevocationStore`:

A store revokes by **criteria** (`{ jti?, agent?, subject? }`) and checks each token's claims against them, so "disconnect this agent" works, not just single tokens:

```ts
import type { RevocationStore, RevocationCriteria, RevocationSubject } from 'agentauth';

class RedisStore implements RevocationStore {
  // Persist each provided field with a TTL until `expiresAt` (unix seconds).
  async revoke(c: RevocationCriteria, expiresAt: number) {
    const ttl = expiresAt - Math.floor(Date.now() / 1000);
    if (c.jti) await redis.set(`revoked:jti:${c.jti}`, '1', 'EXAT', expiresAt);
    if (c.agent) await redis.set(`revoked:agent:${c.agent}`, '1', 'EX', ttl);
    if (c.subject) await redis.set(`revoked:subject:${c.subject}`, '1', 'EX', ttl);
  }
  // Revoked if ANY of the token's jti / agent / subject is marked.
  async isRevoked(claims: RevocationSubject) {
    const hits = await redis.mget(
      `revoked:jti:${claims.jti}`,
      `revoked:agent:${claims.agent}`,
      `revoked:subject:${claims.subject}`,
    );
    return hits.some(Boolean);
  }
}

const auth = new AgentAuth({ secret, store: new RedisStore() });
```

## Design

- **Stateless by default** — tokens are signed JWTs (via [`jose`](https://github.com/panva/jose)); verification needs no DB round-trip unless you check revocation.
- **Short-lived** — 15-minute default TTL keeps blast radius small.
- **Scope-checked** — `verify` enforces required scopes so each tool only sees what it needs.
- **Revocable** — pluggable store, in-memory for dev, your DB/Redis for prod.

Current signing is HS256 (shared secret). Asymmetric keys (EdDSA/RS256), so verifiers never hold the signing key, are on the roadmap.

## Roadmap

- [ ] Asymmetric signing (EdDSA) + JWKS endpoint
- [ ] Express / Hono / Fastify middleware helpers
- [ ] First-class MCP server helper (`auth.mcp()`)
- [ ] Consent/grant UI primitives
- [ ] Audit log hooks

## Develop

```bash
npm install
npm test     # builds, then runs node:test against dist/
```

## License

MIT

# AgentAuth

**OAuth-style delegated authorization for AI agents and MCP servers.**

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

// 3. Revoke any time (kills the grant before it expires).
await auth.revoke(token); // or auth.revoke(jti)
```

## API

| Method | Purpose |
|---|---|
| `new AgentAuth(config)` | Configure signing secret, issuer, audience, default TTL, revocation store. |
| `issue(grant)` | Mint a token from `{ subject, agent, scopes, ttlSeconds? }`. Returns `{ token, jti, expiresAt }`. |
| `verify(token, { requiredScopes? })` | Validate signature, expiry, audience, revocation, and scopes. Returns `AgentClaims` or throws. |
| `revoke(jtiOrToken)` | Revoke a token until its natural expiry. |

### Revocation stores

Revocation defaults to an in-memory store. For multi-process or persistent revocation, implement `RevocationStore`:

```ts
import type { RevocationStore } from 'agentauth';

class RedisStore implements RevocationStore {
  async revoke(jti: string, expiresAt: number) { /* SETEX agentauth:revoked:<jti> ... */ }
  async isRevoked(jti: string) { /* EXISTS ... */ return false; }
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

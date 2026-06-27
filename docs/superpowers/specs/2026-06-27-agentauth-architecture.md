# AgentAuth — Plan & Technical Architecture

## 1. Goal

A drop-in SDK that lets an AI agent act **on behalf of a user** using **scoped, short-lived, revocable** tokens instead of a full-access API key. The viral wedge: *"one line to add OAuth to your MCP server / agent."*

## 2. Actors

| Actor | Role |
|---|---|
| **Principal (user)** | The human delegating authority. |
| **Agent** | The AI process receiving delegated authority. |
| **Resource server** | The dev's API / MCP server that enforces the token. |
| **Authorization server (AgentAuth)** | Issues, verifies, revokes tokens. Embedded as a library, or run standalone. |

## 3. Core flow

```
user ──consent(scopes)──▶ AgentAuth.issue ──token──▶ agent
agent ──token──▶ resource server ──AgentAuth.verify(requiredScopes)──▶ allow / deny
user/admin ──AgentAuth.revoke(jti)──▶ store ──▶ next verify fails
```

## 4. Token model

- **Format:** signed JWT (`jose`).
- **Signing:** HS256 today (shared secret). EdDSA + JWKS on roadmap so resource servers verify without holding the signing key.
- **Claims:** `sub` (user), `agent`, `scopes[]`, `jti`, `iss`, `aud`, `iat`, `exp`.
- **TTL:** 15 min default. Short-lived = small blast radius.
- **Scopes:** opaque strings, convention `resource:action` (e.g. `email:read`).

## 5. Components (current repo)

| Module | Responsibility | Depends on |
|---|---|---|
| `agentauth.ts` | `issue` / `verify` / `revoke`, config, validation | `jose`, `store`, `types` |
| `store.ts` | `RevocationStore` interface + `MemoryStore` | — |
| `types.ts` | `Grant`, `AgentClaims`, `VerifyOptions` | — |
| `index.ts` | Public surface | all |

## 6. Revocation

- Pluggable `RevocationStore` (`revoke(jti, expiresAt)`, `isRevoked(jti)`).
- `MemoryStore` default; Redis/DB for multi-process + persistence.
- Only revoked jtis are stored, auto-evicted past natural expiry → bounded memory.

## 7. Security stance

- Secret ≥ 32 bytes enforced.
- Verify checks signature + issuer + audience + expiry + revocation + required scopes.
- Tamper/expired/wrong-audience tokens reject.
- Open question (for grill): refresh tokens, key rotation, replay, multi-tenant isolation.

## 8. Roadmap (post-MVP)

1. Asymmetric signing (EdDSA) + JWKS endpoint.
2. Framework middleware: Express / Hono / Fastify.
3. First-class MCP helper (`auth.mcp()`).
4. Consent/grant UI primitives.
5. Audit log hooks.

## 9. Non-goals (YAGNI)

- Not a full IdP / user-login system (that's "Sign in with AI", parked).
- Not an LLM gateway / key vault (parked).
- No billing/metering in core.

# PRD — AgentAuth

## Problem Statement

Developers building AI agents and MCP servers need their agent to act on a user's behalf — read email, call internal APIs, invoke tools. Today they hand the agent a full-access API key. That credential can't be scoped to a single action, can't be revoked when the agent misbehaves, and never expires. Giving an autonomous agent a long-lived master key is the wrong default, and there's no easy drop-in way to do better.

## Solution

AgentAuth is a library-first SDK that turns an explicit user grant into a **scoped, short-lived, revocable** token. The user authorizes an agent for specific scopes; AgentAuth mints a signed token from that grant; the developer's resource server enforces it in one `verify` call. Possession of the token grants only the named scopes, for a short window, and the user can revoke it at any time. The headline experience: *one line to add OAuth-style delegation to your MCP server or agent.*

## User Stories

1. As an app developer, I want to issue a token from a user's grant, so that an agent can act on that user's behalf without my master key.
2. As an app developer, I want to restrict a token to specific scopes, so that an agent can only do what the user approved.
3. As an app developer, I want tokens to expire quickly by default, so that a leaked token has a small blast radius.
4. As an app developer, I want to set a custom TTL per grant, so that long-running and one-shot tasks each get an appropriate lifetime.
5. As a resource-server developer, I want to verify a token in one call, so that I can gate an endpoint without writing crypto.
6. As a resource-server developer, I want verification to enforce required scopes, so that each endpoint only accepts tokens permitted for it.
7. As a resource-server developer, I want verification to reject tampered, expired, or wrong-audience tokens, so that forged credentials never pass.
8. As a resource-server developer, I want a fast stateless verify path by default, so that I don't pay a datastore round-trip on every request.
9. As a security-conscious developer, I want to opt into a revocation check per verify, so that sensitive endpoints can confirm a token wasn't revoked.
10. As a user, I want to revoke a token I granted, so that I can cut off an agent that misbehaves.
11. As a user, I want to disconnect an agent entirely, so that every token it holds stops working at once.
12. As an app developer, I want to revoke by jti, grant, agent, or subject, so that I can implement both per-token and "disconnect this agent" controls.
13. As an app developer, I want a typed error with a stable code for each failure, so that I can branch on the reason instead of parsing messages.
14. As an operator, I want structured events for issue/verify/deny/revoke, so that I can build an audit trail.
15. As an app developer, I want to configure issuer and audience, so that tokens are bound to my app and a specific resource.
16. As an app developer, I want clock-skew tolerance on verify, so that minor clock drift between machines doesn't reject valid tokens.
17. As an app developer, I want a key id on every token, so that I can rotate signing keys without breaking outstanding tokens.
18. As an app developer, I want to swap the revocation store for Redis or a database, so that revocation survives restarts and spans processes.
19. As an MCP server author, I want to gate each tool by required scopes, so that an agent calling a tool must hold permission for it.
20. As an MCP server author, I want AgentAuth to conform to the MCP auth spec, so that standard MCP clients work without custom glue.
21. As an MCP integrator, I want resource servers to verify tokens without holding the signing key, so that client and server can be different trust domains.
22. As an app developer, I want the secret length validated at construction, so that I can't accidentally ship a weak signing key.
23. As an open-source user, I want a readable, well-documented public API, so that I trust the library enough to build on it.
24. As a product owner, I want the consent gap documented, so that I know AgentAuth enforces grants while consent UI is my responsibility in v1.

## Implementation Decisions

- **Deployment shape:** Library-first. Internal boundaries (revocation store, signer, clock, event sink) are interfaces so the same core can later run as a standalone authorization server without a rewrite. No hosted service in scope.
- **Trust model (v1):** The resource server holds the signing secret and both issues and verifies — a single trust domain. The agent only ever holds issued tokens.
- **Token format:** Signed JWT via `jose`. Claims: `sub`, `agent`, `scopes[]`, `jti`, `iss`, `aud`, `iat`, `exp`.
- **Signing:** HS256 in v1. Add a `kid` header now so key rotation is non-breaking later. EdDSA + JWKS is a required milestone that must land **before** the MCP helper (client and server are different trust domains there).
- **Key rotation:** `kid` header plus a verifier keyset — sign with newest, verify against any non-retired key, retire old keys after one TTL window.
- **TTL:** 15-minute default, configurable per grant. No refresh tokens in core — the durable primitive is the grant; re-issuing a short token from a still-valid grant is the refresh equivalent.
- **Scopes:** Opaque `resource:action` strings, compared by equality in core. Optional scope matcher supporting hierarchical wildcards (`email:*` implies `email:read`) is opt-in via a `verify` option.
- **Revocation interface:** Widen the store to revoke by `{ jti?, grant?, agent?, subject? }` so "disconnect this agent" is one call. `MemoryStore` default; Redis/DB via the interface.
- **Revocation check:** Opt-in per verify (`checkRevocation`). Stateless fast path by default; checked path is fail-closed when enabled. Tradeoff documented.
- **Clock skew:** Configurable `clockTolerance`, default 30s.
- **Error model:** Typed errors (`TokenExpiredError`, `MissingScopeError`, `RevokedError`, etc.) extending an `AgentAuthError` base with a stable `.code`.
- **Observability:** Optional `onEvent` hook emitting structured `issued` / `verified` / `denied` / `revoked` events.
- **MCP helper:** Wraps an MCP server, gating each tool against a required-scope map; conforms to the MCP OAuth-flavored auth spec rather than inventing a parallel scheme. Depends on EdDSA.
- **Secret validation:** Reject secrets shorter than 32 bytes at construction.

## Testing Decisions

- **What makes a good test:** Exercise only external behavior through the public `AgentAuth` surface (`issue` / `verify` / `revoke`) and observable outputs (returned claims, thrown typed errors, emitted events). No assertions on internal token-string layout or private fields.
- **Seam:** The public `AgentAuth` API is the highest existing seam and is already what the current suite uses — no new seam needed.
- **Modules tested:** `AgentAuth` (issue/verify/revoke), `RevocationStore`/`MemoryStore` behavior via the public API, scope matcher, error codes, event emission.
- **Prior art:** `src/test/agentauth.test.ts` — round-trip, missing-scope rejection, revocation, tamper rejection, weak-secret rejection. New decisions extend this file: typed-error `.code` assertions, `onEvent` emission, `kid` presence, `checkRevocation` opt-in path, wildcard scope matching, revoke-by-agent/subject.

## Out of Scope

- Hosted/standalone authorization-server deployment.
- User login / identity provider ("Sign in with AI").
- LLM gateway / provider key vaulting.
- Consent UI and persistent `GrantStore` (v2 — v1 enforces grants; consent is the developer's responsibility and is documented as such).
- Sender-constrained tokens (DPoP / mTLS) and cryptographic agent attestation (roadmap).
- Refresh tokens.
- Billing / usage metering.

## Further Notes

- **Threat model (state honestly in docs):** v1 tokens are bearer tokens — possession equals use. Mitigations available today: short TTL, audience binding, revocation, optional one-time-use jti for sensitive scopes. Stronger sender-constrained / attestation defenses are roadmap.
- **External dependency risk:** The MCP auth spec and OAuth-2.1-for-agents conventions are evolving; the MCP helper must track them. Keep the core spec-agnostic with adapters.
- **Cheap MVP code changes surfaced by the grill:** add `kid` header, typed error classes, `onEvent` hook. These are low-cost and make the v1 surface production-credible.

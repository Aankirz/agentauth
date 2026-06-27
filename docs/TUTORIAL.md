# AgentAuth — Tutorial

Zero to a working scoped delegation token in five steps. The same flow is on the
[landing page](https://aankirz.github.io/agentauth/). No service to run — it's a library.

> Want to try before installing? Play with the [live interactive demo](https://aankirz.github.io/agentauth/demo/) right in your browser.

## 1. Install

```bash
npm install agentauth
# generate a secret (>= 32 bytes):
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
```

Requirements: Node 18+. The core has a single dependency (`jose`).

## 2. Configure once (server-side)

```ts
// auth.ts
import { AgentAuth } from 'agentauth';

export const auth = new AgentAuth({
  secret: process.env.AGENTAUTH_SECRET!, // >= 32 bytes, never ship to the client
  issuer: 'my-app',
  audience: 'my-api',
});
```

The secret lives only on the server that issues and verifies. The agent never holds it.

## 3. Issue a token after the user consents

```ts
const { token, expiresAt } = await auth.issue({
  subject: 'user_123',          // the human delegating
  agent:   'research-bot',      // the agent receiving authority
  scopes:  ['email:read', 'calendar:read'],
  ttlSeconds: 600,              // optional; 15-min default
});
// hand `token` to the agent
```

> AgentAuth enforces the grant; collecting consent (the approval UI) is your app's job in v1.

## 4. Verify on every protected route

```ts
import { MissingScopeError, TokenExpiredError } from 'agentauth';

try {
  const claims = await auth.verify(token, { requiredScopes: ['email:read'] });
  // claims.sub === 'user_123', claims.agent, claims.scopes
} catch (err) {
  if (err instanceof MissingScopeError) return res.status(403).end();
  if (err instanceof TokenExpiredError) return res.status(401).end();
  throw err;
}
```

Scopes match exactly, plus wildcards: a granted `email:*` satisfies a required `email:read`.

## 5. Revoke

```ts
await auth.revoke(token);                     // a single token
await auth.revoke({ agent: 'research-bot' }); // "disconnect this agent"
await auth.revoke({ subject: 'user_123' });   // every token for a user
```

## Production checklist

- **Revocation store** — swap the in-memory default for Redis/DB via the `RevocationStore` interface so revocation survives restarts and spans processes.
- **Audit** — pass an `onEvent` hook to capture `issued / verified / denied / revoked`.
- **Key rotation** — set a `kid` now so you can rotate signing keys without breaking outstanding tokens.
- **Stateless fast path** — set `checkRevocation: false` (config) or per-`verify` where you want no store round-trip.

Full reference: [README](https://github.com/Aankirz/agentauth#readme).

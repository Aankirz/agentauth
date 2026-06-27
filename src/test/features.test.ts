import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeProtectedHeader } from 'jose';
import {
  AgentAuth,
  AgentAuthError,
  InvalidGrantError,
  MissingScopeError,
  RevokedError,
  TokenInvalidError,
  type AgentAuthEvent,
  type RevocationStore,
} from '../index.js';

const secret = 'x'.repeat(32);

test('typed errors carry stable codes', async () => {
  const auth = new AgentAuth({ secret });
  const { token } = await auth.issue({ subject: 'u', agent: 'a', scopes: ['email:read'] });

  const scopeErr = await auth.verify(token, { requiredScopes: ['email:write'] }).catch((e) => e);
  assert.ok(scopeErr instanceof MissingScopeError);
  assert.equal(scopeErr.code, 'missing_scope');
  assert.deepEqual(scopeErr.missing, ['email:write']);

  const tamperErr = await auth.verify(token + 'nope').catch((e) => e);
  assert.ok(tamperErr instanceof TokenInvalidError);
  assert.ok(tamperErr instanceof AgentAuthError);
  assert.equal(tamperErr.code, 'token_invalid');
});

test('tokens carry a kid header for rotation', async () => {
  const auth = new AgentAuth({ secret, kid: 'k1' });
  const { token } = await auth.issue({ subject: 'u', agent: 'a', scopes: ['x'] });
  assert.equal(decodeProtectedHeader(token).kid, 'k1');
});

test('wildcard scope satisfies a specific required scope', async () => {
  const auth = new AgentAuth({ secret });
  const { token } = await auth.issue({ subject: 'u', agent: 'a', scopes: ['email:*'] });
  const claims = await auth.verify(token, { requiredScopes: ['email:read'] });
  assert.deepEqual(claims.scopes, ['email:*']);
});

test('onEvent fires for issue / verify / denied / revoke', async () => {
  const events: AgentAuthEvent[] = [];
  const auth = new AgentAuth({ secret, onEvent: (e) => events.push(e) });
  const { token } = await auth.issue({ subject: 'u', agent: 'a', scopes: ['x'] });
  await auth.verify(token, { checkRevocation: true });
  await auth.verify(token, { requiredScopes: ['nope'] }).catch(() => {});
  await auth.revoke(token);

  const types = events.map((e) => e.type);
  assert.deepEqual(types, ['issued', 'verified', 'denied', 'revoked']);
});

test('a throwing onEvent handler never breaks auth', async () => {
  const auth = new AgentAuth({
    secret,
    onEvent: () => {
      throw new Error('boom');
    },
  });
  const { token } = await auth.issue({ subject: 'u', agent: 'a', scopes: ['x'] });
  const claims = await auth.verify(token);
  assert.equal(claims.sub, 'u');
});

test('revoke by agent kills every token that agent holds', async () => {
  const auth = new AgentAuth({ secret });
  const t1 = await auth.issue({ subject: 'u', agent: 'bad_agent', scopes: ['x'] });
  const t2 = await auth.issue({ subject: 'u', agent: 'bad_agent', scopes: ['y'] });
  const t3 = await auth.issue({ subject: 'u', agent: 'good_agent', scopes: ['z'] });

  await auth.revoke({ agent: 'bad_agent' });

  await assert.rejects(() => auth.verify(t1.token, { checkRevocation: true }), RevokedError);
  await assert.rejects(() => auth.verify(t2.token, { checkRevocation: true }), RevokedError);
  const ok = await auth.verify(t3.token, { checkRevocation: true });
  assert.equal(ok.agent, 'good_agent');
});

test('revoke by subject kills every token for that user', async () => {
  const auth = new AgentAuth({ secret });
  const t1 = await auth.issue({ subject: 'user_x', agent: 'a', scopes: ['x'] });
  await auth.revoke({ subject: 'user_x' });
  await assert.rejects(() => auth.verify(t1.token, { checkRevocation: true }), RevokedError);
});

test('criteria revocation outlives a token with a longer-than-default TTL', async () => {
  // Regression: criteria/jti revocation must persist for the longest TTL issued,
  // not the default TTL — else a long-lived token survives a "disconnect agent".
  let captured = 0;
  const store: RevocationStore = {
    revoke(_criteria, expiresAt) {
      captured = expiresAt;
    },
    isRevoked() {
      return false;
    },
  };
  const auth = new AgentAuth({ secret, defaultTtlSeconds: 900, store });
  await auth.issue({ subject: 'u', agent: 'a', scopes: ['x'], ttlSeconds: 3600 });
  await auth.revoke({ agent: 'a' });
  const now = Math.floor(Date.now() / 1000);
  assert.ok(captured >= now + 3600, `revocation entry must cover the 3600s token (got ${captured - now}s)`);
});

test('issue rejects blank scopes', async () => {
  const auth = new AgentAuth({ secret });
  await assert.rejects(() => auth.issue({ subject: 'u', agent: 'a', scopes: [''] }), InvalidGrantError);
  await assert.rejects(() => auth.issue({ subject: 'u', agent: 'a', scopes: ['  '] }), InvalidGrantError);
});

test('stateless verify skips revocation when checkRevocation is false', async () => {
  // config opts out of revocation checks for the stateless fast path
  const auth = new AgentAuth({ secret, checkRevocation: false });
  const { token } = await auth.issue({ subject: 'u', agent: 'a', scopes: ['x'] });
  await auth.revoke(token);
  // revoked, but the fast path doesn't consult the store
  const claims = await auth.verify(token);
  assert.equal(claims.sub, 'u');
  // explicit per-call opt-in still enforces it
  await assert.rejects(() => auth.verify(token, { checkRevocation: true }), RevokedError);
});

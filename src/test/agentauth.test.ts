import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentAuth } from '../index.js';

const secret = 'x'.repeat(32);

test('issue + verify round-trips with scopes', async () => {
  const auth = new AgentAuth({ secret });
  const { token } = await auth.issue({ subject: 'user_1', agent: 'agent_1', scopes: ['email:read'] });
  const claims = await auth.verify(token, { requiredScopes: ['email:read'] });
  assert.equal(claims.sub, 'user_1');
  assert.equal(claims.agent, 'agent_1');
  assert.deepEqual(claims.scopes, ['email:read']);
});

test('verify rejects a missing scope', async () => {
  const auth = new AgentAuth({ secret });
  const { token } = await auth.issue({ subject: 'u', agent: 'a', scopes: ['email:read'] });
  await assert.rejects(() => auth.verify(token, { requiredScopes: ['email:write'] }));
});

test('revoked token fails verification', async () => {
  const auth = new AgentAuth({ secret });
  const { token, jti } = await auth.issue({ subject: 'u', agent: 'a', scopes: ['x'] });
  await auth.revoke(jti);
  await assert.rejects(() => auth.verify(token));
});

test('tampered token fails verification', async () => {
  const auth = new AgentAuth({ secret });
  const { token } = await auth.issue({ subject: 'u', agent: 'a', scopes: ['x'] });
  await assert.rejects(() => auth.verify(token + 'tamper'));
});

test('secret shorter than 32 bytes is rejected', () => {
  assert.throws(() => new AgentAuth({ secret: 'tooshort' }));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {providerFailure} from '../src/agents/providers.js';

// The HTTP envelope must not turn an explicit terminal safety refusal into an
// access/configuration pause or transient retry. Raw messages remain private.
for (const code of ['content_policy_violation', 'safety_violation', 'refusal']) {
  for (const status of [400, 401, 403, 429, 500, 503]) {
    test(`explicit ${code} remains terminal under HTTP ${status}`, () => {
      const error = providerFailure({error: {code, message: 'PRIVATE-UPSTREAM-CONTENT'}}, status);
      assert.equal(error.kind, 'safety'); assert.equal(error.retryable, false);
      assert.ok(!error.message.includes('PRIVATE-UPSTREAM-CONTENT'));
    });
  }
}
test('explicit safety code takes priority over context-looking diagnostic text', () => {
  const error = providerFailure({error: {code: 'content_policy_violation', message: "This model's maximum context length is PRIVATE"}}, 400);
  assert.equal(error.kind, 'safety'); assert.equal(error.retryable, false);
  assert.ok(!error.message.includes('PRIVATE'));
});

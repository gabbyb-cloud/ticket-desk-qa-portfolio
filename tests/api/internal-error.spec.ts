import { test, expect, errorResponse } from '../fixtures.js';

test('SEC-05 DATA-01: one-shot IPC fault returns a sanitized API 500 without altering tickets', async ({ client, instance }) => {
  const alice = await client('alice');
  await alice.create();
  const before = await alice.snapshot();
  const detail = `Synthetic internal path C:/synthetic-private/internal.ts; ${process.env.QA_SENTINEL ?? 'local-test-sentinel'}; ticketdesk.sid=fake-sensitive-cookie`;
  test.info().annotations.push({ type: 'sensitive-sample', description: detail });
  await instance.armReadFault(detail);
  const response = await test.step('case:API GET /api/tickets expected-500', () => alice.api.get('/api/tickets'));
  await test.step(`case:API response expected-500 actual-${response.status()}`, async () => {
    expect(await errorResponse(response, 500, 'INTERNAL_ERROR')).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } });
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await alice.snapshot()).toEqual(before);
  });
});

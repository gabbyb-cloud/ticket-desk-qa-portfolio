import { test, expect, Client } from '../fixtures.js';

test('SEC-05 DATA-01: one-shot IPC fault returns a sanitized browser 500 and leaves the session usable', async ({ page, instance }) => {
  const alice = new Client(page.request, instance.origin);
  await alice.login('alice');
  await alice.create();
  const before = await alice.snapshot();
  await instance.armReadFault(`C:/synthetic-private/internal.ts; ${process.env.QA_SENTINEL ?? 'local-test-sentinel'}; ticketdesk.sid=fake-sensitive-cookie`);
  const response = await page.goto('/tickets');
  expect(response?.status()).toBe(500);
  expect(response?.headers()['cache-control']).toBe('no-store');
  await expect(page.getByRole('alert')).toHaveText('Internal server error.');
  const text = await page.content();
  expect(text.includes('synthetic-private')).toBe(false);
  expect(text.includes(process.env.QA_SENTINEL ?? 'local-test-sentinel')).toBe(false);
  expect(text.includes('fake-sensitive-cookie')).toBe(false);
  expect(text.includes('Error:')).toBe(false);
  expect(await alice.snapshot()).toEqual(before);
  await page.goto('/tickets');
  await expect(page.getByRole('heading', { name: 'Tickets', exact: true })).toBeVisible();
});

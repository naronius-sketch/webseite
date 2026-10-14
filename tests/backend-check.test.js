import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkBackend } from '../scripts/check-backend.mjs';

const config = { schemaVersion: 1, supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  publishableKey: 'sb_publishable_public_preflight_example' };
const catalogue = JSON.parse(readFileSync(new URL('../public/site-config.json', import.meta.url), 'utf8'));
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function backend({ publicResponse, membershipResponse, adminResponse, sdkResponse } = {}) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/rest/v1/site_catalogues?select=id,config')) return publicResponse?.() ?? json([{ id: 'published', config: catalogue }]);
      if (url.endsWith('/rest/v1/site_admins?select=user_id&limit=1')) return membershipResponse?.() ?? json({ message: 'denied' }, 403);
      if (url.endsWith('/rest/v1/rpc/site_catalogue_state')) return adminResponse?.() ?? json({ message: 'denied' }, 401);
      if (url.endsWith('/rest/v1/site_catalogues?select=config&id=eq.published')) return sdkResponse?.() ?? json([{ config: catalogue }]);
      throw new Error('Unexpected network target');
    },
  };
}

test('disabled admin config needs no network request', async () => {
  let calls = 0;
  assert.deepEqual(await checkBackend({ schemaVersion: 1, supabaseUrl: '', publishableKey: '' }, {
    fetchImpl: () => { calls++; throw new Error('must not fetch'); },
  }), { configured: false, status: 'disabled' });
  assert.equal(calls, 0);
});

test('a valid public catalogue with denied private access is ready for deployment', async () => {
  const fake = backend();
  assert.deepEqual(await checkBackend(config, fake), { configured: true, status: 'ready' });
  assert.equal(fake.calls.length, 4);
  for (const { url, options } of fake.calls) {
    assert.ok(url.startsWith(`${config.supabaseUrl}/rest/v1/`));
    assert.equal(new Headers(options.headers).get('apikey'), config.publishableKey);
    if (!url.includes('select=config&')) assert.equal(new Headers(options.headers).get('Authorization'), null);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
  const rpc = fake.calls.find(call => call.url.endsWith('/rpc/site_catalogue_state'));
  assert.equal(rpc.options.method, 'POST');
  assert.equal(rpc.options.body, '{}');
  assert.equal(fake.calls.filter(call => call.options.method === 'GET').length, 3);
  assert.ok(!fake.calls.some(call => /site_save_draft|site_publish_catalogue|storage\/|auth\/v1/.test(new URL(call.url).pathname)));
});

test('the production SDK must be able to read the real published catalogue too', async () => {
  for (const sdkResponse of [() => json({ message: 'invalid credentials' }, 401),
    () => json([]), () => json([{ config: { ...catalogue, privateLeads: [] } }])]) {
    await assert.rejects(checkBackend(config, backend({ sdkResponse })), { code: 'SDK_PUBLIC_READ_FAILED' });
  }
});

test('RLS-hidden membership and an intentionally empty published property list are valid', async () => {
  const fake = backend({
    membershipResponse: () => json([]),
    publicResponse: () => json([{ id: 'published', config: { ...catalogue, properties: [] } }]),
  });
  assert.equal((await checkBackend(config, fake)).status, 'ready');
});

test('a bad key, missing catalogue API or transport failure prevents deployment', async () => {
  for (const status of [401, 403, 404, 500]) {
    const fake = backend({ publicResponse: () => json({ secret: 'response must not leak' }, status) });
    await assert.rejects(checkBackend(config, fake), error =>
      error.code === 'CATALOGUE_UNAVAILABLE' && error.status === status && !error.message.includes('secret'));
  }
  await assert.rejects(checkBackend(config, { fetchImpl: async () => {
    throw new Error(`Failed request contained ${config.publishableKey}`);
  } }), error => error.code === 'BACKEND_NETWORK' && !error.message.includes(config.publishableKey));
});

test('missing, invalid or draft catalogue exposure prevents deployment', async () => {
  const privateConfig = { ...catalogue, enquiries: [{ email: 'private@example.com' }] };
  const realWithoutRights = structuredClone(catalogue);
  realWithoutRights.properties[0].demo = false;
  const invalid = [[], {}, [{ id: 'published', config: null }], [{ id: 'draft', config: catalogue }],
    [{ id: 'published', config: catalogue }, { id: 'draft', config: catalogue }],
    [{ id: 'published', config: catalogue, privateEmails: ['private@example.com'] }],
    [{ id: 'published', config: privateConfig }], [{ id: 'published', config: realWithoutRights }]];
  for (const response of invalid) {
    const fake = backend({ publicResponse: () => json(response) });
    await assert.rejects(checkBackend(config, fake), { code: 'CATALOGUE_INVALID' });
  }
  const malformed = backend({ publicResponse: () => new Response('not JSON', { status: 200 }) });
  await assert.rejects(checkBackend(config, malformed), { code: 'CATALOGUE_INVALID' });
});

test('exposed admin membership or readable admin-state RPC prevents deployment', async () => {
  for (const response of [[{ user_id: 'private-admin-uuid' }], { user_id: 'private-admin-uuid' }, null]) {
    const fake = backend({ membershipResponse: () => json(response) });
    await assert.rejects(checkBackend(config, fake), error => error.code === 'MEMBERSHIP_EXPOSED'
      && !error.message.includes('private-admin-uuid'));
  }
  for (const response of [{ draftConfig: catalogue }, null, {}]) {
    const fake = backend({ adminResponse: () => json(response) });
    await assert.rejects(checkBackend(config, fake), { code: 'ADMIN_STATE_EXPOSED' });
  }
});

test('unavailable private permission checks fail closed rather than count as denied', async () => {
  for (const status of [404, 429, 500]) {
    await assert.rejects(checkBackend(config, backend({ membershipResponse: () => json({}, status) })), { code: 'MEMBERSHIP_CHECK_FAILED' });
    await assert.rejects(checkBackend(config, backend({ adminResponse: () => json({}, status) })), { code: 'ADMIN_STATE_CHECK_FAILED' });
  }
});

test('an unexpected host, nonpublic key or invalid version is rejected before networking', async () => {
  for (const input of [{ ...config, supabaseUrl: 'https://outside.example' },
    { ...config, supabaseUrl: `${config.supabaseUrl}/rest/v1/` },
    { ...config, publishableKey: 'sb_secret_must_not_be_sent' }, { ...config, schemaVersion: 99 }]) {
    let calls = 0;
    await assert.rejects(checkBackend(input, { fetchImpl: () => { calls++; } }), { code: 'CONFIG' });
    assert.equal(calls, 0);
  }
});

test('the deadline aborts stalled checks even when a transport ignores the abort signal', async () => {
  const calls = [];
  await assert.rejects(checkBackend(config, { timeoutMs: 10, fetchImpl: async (url, options) => {
    calls.push(options);
    return new Promise(() => {});
  } }), { code: 'BACKEND_TIMEOUT' });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.signal.aborted));
});

test('the deadline also covers a response body that never finishes', async () => {
  const fake = backend({ publicResponse: () => ({ status: 200, json: () => new Promise(() => {}) }) });
  await assert.rejects(checkBackend(config, { ...fake, timeoutMs: 10 }), { code: 'BACKEND_TIMEOUT' });
});

test('the production SDK read has the same bounded response deadline', async () => {
  const fake = backend({ sdkResponse: () => ({ status: 200, ok: true, headers: new Headers(),
    text: () => new Promise(() => {}) }) });
  await assert.rejects(checkBackend(config, { ...fake, timeoutMs: 10 }), { code: 'BACKEND_TIMEOUT' });
});

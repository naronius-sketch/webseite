import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_ADMIN_CONFIG, getBackendConfig, loadBackendConfig } from '../src/admin-config.js';

const connection = { schemaVersion: 1, supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  publishableKey: 'sb_publishable_public_key_example' };
const jwt = role => `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ role })).replace(/=/g, '')}.signature`;

test('an empty runtime configuration disables cloud admin deliberately', () => {
  assert.equal(getBackendConfig({ schemaVersion: 1, supabaseUrl: '', publishableKey: '' }), EMPTY_ADMIN_CONFIG);
  assert.equal(getBackendConfig().configured, false);
});

test('hosted Supabase public keys and legacy anon JWTs are accepted', () => {
  assert.equal(getBackendConfig({ ...connection, supabaseUrl: `${connection.supabaseUrl}/` }).supabaseUrl, connection.supabaseUrl);
  assert.equal(getBackendConfig(connection).configured, true);
  assert.equal(getBackendConfig({ ...connection, publishableKey: jwt('anon') }).publishableKey, jwt('anon'));
  assert.ok(Object.isFrozen(getBackendConfig(connection)));
});

test('secret/service role keys and non-anon JWTs never become browser settings', () => {
  for (const publishableKey of ['sb_secret_this_must_never_be_public', jwt('service_role'), jwt('authenticated'),
    jwt('administrator'), 'not-a-valid-key', 'sb_publishable_']) {
    assert.throws(() => getBackendConfig({ ...connection, publishableKey }), error =>
      error.code === 'CONFIG' && !error.message.includes(publishableKey));
  }
  assert.throws(() => getBackendConfig({ ...connection, serviceRoleKey: 'secret' }), { code: 'CONFIG' });
});

test('connection cannot point public keys at an arbitrary host or embed credentials', () => {
  for (const supabaseUrl of ['http://abcdefghijklmnopqrst.supabase.co', 'https://supabase.co',
    'https://abcdefghijklmnopqrst.supabase.co.evil.example', 'https://user:password@abcdefghijklmnopqrst.supabase.co',
    'https://abcdefghijklmnopqrst.supabase.co/path', 'https://abcdefghijklmnopqrst.supabase.co/?key=secret',
    'https://abcdefghijklmnopqrst.supabase.co/#secret', 'https://abcdefghijklmnopqrst.supabase.co:8443',
    'https://localhost', 'https://127.0.0.1']) {
    assert.throws(() => getBackendConfig({ ...connection, supabaseUrl }), { code: 'CONFIG' });
  }
  assert.throws(() => getBackendConfig({ ...connection, publishableKey: '' }), { code: 'CONFIG' });
  assert.throws(() => getBackendConfig({ ...connection, schemaVersion: 2 }), { code: 'CONFIG' });
});

test('runtime loading omits credentials and cache, and validates the response', async () => {
  let call;
  const result = await loadBackendConfig({ fetchImpl: async (url, options) => {
    call = { url, options };
    return { ok: true, json: async () => connection };
  } });
  assert.equal(result.configured, true);
  assert.equal(call.url, '/admin-config.json');
  assert.equal(call.options.cache, 'no-store');
  assert.equal(call.options.credentials, 'omit');
  await assert.rejects(loadBackendConfig({ fetchImpl: async () => ({ ok: true, json: async () => ({ ...connection, publishableKey: jwt('service_role') }) }) }), { code: 'CONFIG' });
});

test('runtime errors are clear without exposing response bodies or secrets', async () => {
  for (const fetchImpl of [async () => { throw new Error('secret network detail'); },
    async () => ({ ok: false, status: 404 })]) {
    await assert.rejects(loadBackendConfig({ fetchImpl }), error => error.code === 'NETWORK' && !error.message.includes('secret'));
  }
  await assert.rejects(loadBackendConfig({ fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('bad secret JSON'); } }) }), { code: 'CONFIG' });
});

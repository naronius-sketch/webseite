import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminService, createPublicCatalogueService, validatePropertyPhoto, MAX_PROPERTY_PHOTO_BYTES } from '../src/admin-service.js';
import { validatePublicConfig } from '../src/broker-model.js';

const config = { schemaVersion: 1, supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  publishableKey: 'sb_publishable_public_key_example' };
const catalogue = validatePublicConfig(JSON.parse(readFileSync(new URL('../public/site-config.json', import.meta.url)))).config;
const uid = '11111111-1111-4111-8111-111111111111';
const state = { draftConfig: catalogue, publishedConfig: catalogue, draftRevision: 2, publishedRevision: 1 };

function fakeClient({ signedIn = true, approved = true, rpcError, publicError, publicConfig = catalogue } = {}) {
  const calls = [];
  let callback;
  const session = signedIn ? { user: { id: uid } } : null;
  const client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: cb => { callback = cb; return { data: { subscription: { unsubscribe: () => calls.push(['unsubscribe']) } } }; },
      signInWithPassword: async input => { calls.push(['signIn', input]); return { data: { session }, error: null }; },
      signOut: async () => { calls.push(['signOut']); return { error: null }; },
    },
    rpc: async (name, args) => {
      calls.push([name, args]);
      return name === 'site_admin_check' ? { data: approved, error: null } : { data: state, error: rpcError ?? null };
    },
    from: table => {
      calls.push(['table', table]);
      return { select: columns => {
        calls.push(['select', columns]);
        return { eq: (field, value) => {
          calls.push(['eq', field, value]);
          return { maybeSingle: async () => ({ data: publicConfig === undefined ? null : { config: publicConfig }, error: publicError ?? null }) };
        } };
      } };
    },
    storage: { from: bucket => ({
      upload: async (path, file, options) => { calls.push(['upload', bucket, path, file, options]); return { data: { path }, error: null }; },
      getPublicUrl: path => ({ data: { publicUrl: `${config.supabaseUrl}/storage/v1/object/public/${bucket}/${path}` } }),
    }) },
  };
  return { client, calls, fireAuth: (...args) => callback?.(...args) };
}

test('public reader cannot persist or restore an admin session', async () => {
  let options;
  const fake = fakeClient();
  const reader = createPublicCatalogueService(config, { createClientImpl: (url, key, value) => {
    assert.equal(url, config.supabaseUrl); assert.equal(key, config.publishableKey); options = value; return fake.client;
  } });
  assert.deepEqual(options.auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
    storageKey: 'wangechi-public-catalogue-abcdefghijklmnopqrst.supabase.co' });
  assert.deepEqual(await reader.readPublished(), catalogue);
  assert.deepEqual(fake.calls, [['table', 'site_catalogues'], ['select', 'config'], ['eq', 'id', 'published']]);
  assert.equal(reader.signIn, undefined);
});

test('injected clients stay isolated, and public auth storage differs from administrator storage', () => {
  const creations = [];
  const createClientImpl = (url, key, options) => {
    const fake = fakeClient();
    creations.push({ options, client: fake.client });
    return fake.client;
  };
  createAdminService(config, { createClientImpl });
  createAdminService(config, { createClientImpl });
  createPublicCatalogueService(config, { createClientImpl });
  createPublicCatalogueService(config, { createClientImpl });
  assert.equal(creations.length, 4);
  assert.notEqual(creations[0].client, creations[1].client);
  assert.notEqual(creations[2].client, creations[3].client);
  assert.equal(creations[0].options.auth.persistSession, true);
  assert.equal(creations[0].options.auth.autoRefreshToken, true);
  assert.equal(creations[0].options.auth.storageKey, undefined);
  assert.notEqual(creations[2].options.auth.storageKey, creations[0].options.auth.storageKey);
});

test('public publication failures never fall back to stale sample listings', async () => {
  const fake = fakeClient({ publicError: { message: 'secret database body' } });
  await assert.rejects(createPublicCatalogueService(config, { client: fake.client }).readPublished(), error =>
    error.code === 'NETWORK' && !error.message.includes('secret'));
  const missing = fakeClient({ publicConfig: null });
  assert.equal(await createPublicCatalogueService(config, { client: missing.client }).readPublished(), null);
  const invalid = fakeClient({ publicConfig: { ...catalogue, leads: [{ privatePhone: 'secret' }] } });
  await assert.rejects(createPublicCatalogueService(config, { client: invalid.client }).readPublished(), { code: 'VALIDATION' });
});

test('unconfigured admin never creates an SDK client', () => {
  assert.throws(() => createAdminService({ schemaVersion: 1, supabaseUrl: '', publishableKey: '' }), { code: 'CONFIG' });
});

test('anonymous and unapproved authenticated sessions cannot use admin operations', async () => {
  for (const [signedIn, code] of [[false, 'AUTH_REQUIRED'], [true, 'ADMIN_REQUIRED']]) {
    const fake = fakeClient({ signedIn, approved: false });
    const service = createAdminService(config, { client: fake.client });
    assert.equal(await service.checkAdmin(), false);
    await assert.rejects(service.loadCatalogue(), { code });
    await assert.rejects(service.saveDraft(catalogue, { draftRevision: 2 }), { code });
    await assert.rejects(service.publish(catalogue, { draftRevision: 2, publishedRevision: 1 }), { code });
    assert.equal(fake.calls.filter(call => ['site_catalogue_state', 'site_save_draft', 'site_publish_catalogue'].includes(call[0])).length, 0);
  }
});

test('authorized saves and publication pass both expected revisions without private data', async () => {
  const fake = fakeClient();
  const service = createAdminService(config, { client: fake.client });
  assert.deepEqual(await service.loadCatalogue(), state);
  assert.deepEqual(await service.saveDraft(catalogue, { draftRevision: 2 }), state);
  assert.deepEqual(await service.publish(catalogue, { draftRevision: 2, publishedRevision: 1 }), state);
  assert.deepEqual(fake.calls.find(call => call[0] === 'site_save_draft')[1], { p_config: catalogue, p_expected_draft_revision: 2 });
  assert.deepEqual(fake.calls.find(call => call[0] === 'site_publish_catalogue')[1], {
    p_config: catalogue, p_expected_draft_revision: 2, p_expected_published_revision: 1,
  });
});

test('invalid/private public fields and unsafe revision values are rejected before RPC', async () => {
  const fake = fakeClient(); const service = createAdminService(config, { client: fake.client });
  await assert.rejects(service.publish({ ...catalogue, enquiries: [{ email: 'private' }] }, { draftRevision: 2, publishedRevision: 1 }), { code: 'VALIDATION' });
  for (const draftRevision of [undefined, -1, 2.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(service.saveDraft(catalogue, { draftRevision }), { code: 'VALIDATION' });
  }
  assert.equal(fake.calls.length, 0);
});

test('server revision conflicts remain distinct and backend details are sanitized', async () => {
  const fake = fakeClient({ rpcError: { code: '40001', message: 'sensitive row payload' } });
  await assert.rejects(createAdminService(config, { client: fake.client }).publish(catalogue, {
    draftRevision: 2, publishedRevision: 1,
  }), error => error.code === 'REVISION_CONFLICT' && !error.message.includes('sensitive'));
  for (const [serverCode, code] of [['22023', 'VALIDATION'], ['42501', 'ADMIN_REQUIRED'], ['28000', 'AUTH_REQUIRED'], ['NETWORK', 'NETWORK']]) {
    const fakeError = fakeClient({ rpcError: { code: serverCode, message: 'secret password' } });
    await assert.rejects(createAdminService(config, { client: fakeError.client }).loadCatalogue(), error => error.code === code && !error.message.includes('secret'));
  }
});

test('sign-in uses validated email and unsubscribing removes auth listeners', async () => {
  const fake = fakeClient(); const service = createAdminService(config, { client: fake.client });
  await service.signIn('agent@example.com', 'correct-password');
  await assert.rejects(service.signIn('agent@example.com\nheader: injected', 'password'), { code: 'SIGN_IN' });
  const observed = []; const unsubscribe = service.onAuthStateChange((...args) => observed.push(args));
  fake.fireAuth('SIGNED_IN', { user: { id: uid } });
  unsubscribe(); await service.signOut();
  assert.deepEqual(observed, [['SIGNED_IN', { user: { id: uid } }]]);
  assert.ok(fake.calls.some(call => call[0] === 'unsubscribe'));
  assert.ok(fake.calls.some(call => call[0] === 'signOut'));
});

test('photo validation rejects SVG, disguised HTML, MIME mismatch and oversize bytes', async () => {
  const png = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])], 'photo.png', { type: 'image/png' });
  const jpeg = new File([new Uint8Array([255, 216, 255, 1])], 'photo.jpg', { type: 'image/jpeg' });
  const webp = new File([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])], 'photo.webp', { type: 'image/webp' });
  assert.deepEqual(await validatePropertyPhoto(png), { extension: 'png', contentType: 'image/png' });
  assert.equal((await validatePropertyPhoto(jpeg)).extension, 'jpg');
  assert.equal((await validatePropertyPhoto(webp)).extension, 'webp');
  for (const file of [new File(['<svg/>'], 'photo.svg', { type: 'image/svg+xml' }),
    new File(['<html>unsafe</html>'], 'pretend.png', { type: 'image/png' }),
    new File([await png.arrayBuffer()], 'pretend.jpg', { type: 'image/jpeg' }),
    new File([], 'empty.jpg', { type: 'image/jpeg' }),
    { type: 'image/png', size: MAX_PROPERTY_PHOTO_BYTES + 1, slice: () => png }]) {
    await assert.rejects(validatePropertyPhoto(file), { code: 'UPLOAD' });
  }
});

test('upload uses unique immutable names in the signed-in admin UID folder', async () => {
  const fake = fakeClient(); const service = createAdminService(config, { client: fake.client });
  const photo = new File([new Uint8Array([255, 216, 255, 1])], '../../unsafe-original-name.jpg', { type: 'image/jpeg' });
  const first = await service.uploadPhoto(photo); const second = await service.uploadPhoto(photo);
  assert.notEqual(first, second);
  for (const call of fake.calls.filter(call => call[0] === 'upload')) {
    assert.equal(call[1], 'property-photos');
    assert.match(call[2], new RegExp(`^${uid}/[a-f0-9-]{36}\\.jpg$`));
    assert.equal(call[4].upsert, false);
    assert.equal(call[4].contentType, 'image/jpeg');
    assert.ok(!call[2].includes('unsafe-original-name'));
  }
  assert.ok(first.startsWith(`${config.supabaseUrl}/storage/v1/object/public/property-photos/${uid}/`));
});

test('unapproved users cannot upload even valid photos', async () => {
  const fake = fakeClient({ approved: false });
  await assert.rejects(createAdminService(config, { client: fake.client }).uploadPhoto(
    new File([new Uint8Array([255, 216, 255, 1])], 'photo.jpg', { type: 'image/jpeg' })), { code: 'ADMIN_REQUIRED' });
  assert.equal(fake.calls.filter(call => call[0] === 'upload').length, 0);
});

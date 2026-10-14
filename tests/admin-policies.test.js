import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Execute the production migration in real PostgreSQL (WASM). Supabase Auth's
// JWT identity and Storage's SQL tables are the only local stand-ins. These
// tests do not exercise GoTrue, PostgREST, Storage HTTP, or a hosted project.
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STRANGER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PHOTO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg';
let db;
let schema;
let seed;
let publicConfig;

const bootstrap = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id), name text not null,
    owner uuid, owner_id text, metadata jsonb,
    created_at timestamptz default now(), updated_at timestamptz default now(),
    unique (bucket_id, name)
  );
  create function storage.foldername(name text) returns text[]
    language sql immutable as $$
      select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
    $$;
  alter table storage.objects enable row level security;
  grant usage on schema public, storage to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant all on storage.objects, storage.buckets to service_role;
  grant select on storage.buckets to anon, authenticated;
  grant execute on function storage.foldername(text) to anon, authenticated;
  -- Match existing Supabase projects that grant broad privileges to newly
  -- created public tables. The actual migration must remove these grants.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  -- Model the hosted restriction observed in the SQL editor: Storage already
  -- has RLS and grants, and application setup must not ALTER its managed table.
  -- This guard models the restriction, not Supabase's internal implementation.
  create function storage.test_protect_managed_table() returns event_trigger
    language plpgsql as $$
    declare command record;
    begin
      for command in select * from pg_event_trigger_ddl_commands() loop
        if command.object_identity = 'storage.objects' then
          raise exception using errcode = '42501', message = 'must be owner of table objects';
        end if;
      end loop;
    end
    $$;
  create event trigger test_protect_managed_storage on ddl_command_end
    when tag in ('ALTER TABLE') execute function storage.test_protect_managed_table();
`;

before(async () => {
  [schema, seed, publicConfig] = await Promise.all([
    readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/seed.sql', import.meta.url), 'utf8'),
    readFile(new URL('../public/site-config.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  db = await PGlite.create();
  await db.exec(bootstrap);
  await db.exec(schema);
  await db.exec(seed);
  await db.query('insert into auth.users(id, email) values ($1, $2), ($3, $4)',
    [ADMIN, 'approved@example.test', STRANGER, 'stranger@example.test']);
  await db.query('insert into public.site_admins(user_id) values ($1)', [ADMIN]);
});

after(async () => { await db?.close(); });

async function asRole(role, userId, action) {
  assert.ok(['anon', 'authenticated'].includes(role));
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? '']);
  try { return await action(); }
  finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

async function rpc(name, args = []) {
  const slots = args.map((_, index) => `$${index + 1}`).join(', ');
  const result = await db.query(`select public.${name}(${slots}) as result`, args);
  return result.rows[0].result;
}

const state = () => asRole('authenticated', ADMIN, () => rpc('site_catalogue_state'));
const clone = value => structuredClone(value);
const expectSqlError = (promise, codes) => assert.rejects(promise, error => {
  assert.ok(codes.includes(error.code), `Expected SQLSTATE ${codes.join(' or ')}, received ${error.code}: ${error.message}`);
  return true;
});

test('setup preserves provider-managed Storage RLS and installs policies without altering its table', async () => {
  const result = await db.query("select relrowsecurity from pg_class where oid = 'storage.objects'::regclass");
  assert.equal(result.rows[0].relrowsecurity, true);
  await expectSqlError(db.exec('alter table storage.objects enable row level security'), ['42501']);
  const policies = await db.query("select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'");
  assert.ok(policies.rows.some(row => row.policyname === 'site_admin_photo_insert'));
});

async function cannotRead(role, userId, table) {
  await asRole(role, userId, async () => {
    try {
      const result = await db.query(`select * from public.${table}`);
      assert.deepEqual(result.rows, [], `${role} must not see ${table}`);
    } catch (error) {
      if (error.code !== '42501') throw error;
    }
  });
}

async function cannotChangeStorage(sql, params, role, userId) {
  await asRole(role, userId, async () => {
    try {
      const result = await db.query(sql, params);
      assert.equal(result.rows.length, 0, 'Storage write must be denied by grants or RLS');
    } catch (error) {
      if (error.code !== '42501') throw error;
    }
  });
}

test('actual seed supplies the current public catalogue and visitors read only the published row', async () => {
  const rows = await asRole('anon', null,
    async () => (await db.query('select id, config from public.site_catalogues order by id')).rows);
  assert.deepEqual(rows.map(row => row.id), ['published']);
  assert.deepEqual(rows[0].config, publicConfig);
  await cannotRead('anon', null, 'site_admins');
  const signedInRows = await asRole('authenticated', STRANGER,
    async () => (await db.query('select id from public.site_catalogues order by id')).rows);
  assert.deepEqual(signedInRows.map(row => row.id), ['published']);
  await cannotRead('authenticated', STRANGER, 'site_admins');
});

test('anonymous and unapproved authenticated users cannot use admin RPCs or grant themselves membership', async () => {
  await expectSqlError(asRole('anon', null, () => rpc('site_catalogue_state')), ['42501']);
  await expectSqlError(asRole('anon', null, () => rpc('site_admin_check')), ['42501']);
  assert.equal(await asRole('authenticated', null, () => rpc('site_admin_check')), false);
  await expectSqlError(asRole('authenticated', null, () => rpc('site_catalogue_state')), ['28000']);
  assert.equal(await asRole('authenticated', STRANGER, () => rpc('site_admin_check')), false);
  await expectSqlError(asRole('authenticated', STRANGER, () => rpc('site_catalogue_state')), ['42501']);
  for (const role of ['anon', 'authenticated']) {
    await expectSqlError(asRole(role, role === 'authenticated' ? STRANGER : null,
      () => db.query('insert into public.site_admins(user_id) values ($1)', [STRANGER])), ['42501']);
    await expectSqlError(asRole(role, role === 'authenticated' ? STRANGER : null,
      () => rpc('site_save_draft', [publicConfig, 1])), ['42501']);
    await expectSqlError(asRole(role, role === 'authenticated' ? STRANGER : null,
      () => rpc('site_publish_catalogue', [publicConfig, 1, 1])), ['42501']);
  }
});

test('approved admin can use state RPC, while direct catalogue writes remain denied for every client role', async () => {
  assert.equal(await asRole('authenticated', ADMIN, () => rpc('site_admin_check')), true);
  const current = await state();
  assert.deepEqual(current.publishedConfig, publicConfig);
  assert.ok(Number.isSafeInteger(current.draftRevision));
  assert.ok(Number.isSafeInteger(current.publishedRevision));
  for (const [role, userId] of [['anon', null], ['authenticated', STRANGER], ['authenticated', ADMIN]]) {
    await expectSqlError(asRole(role, userId,
      () => db.query("update public.site_catalogues set config = '{}' where id = 'published'")), ['42501']);
    await expectSqlError(asRole(role, userId,
      () => db.query("delete from public.site_catalogues where id = 'published'")), ['42501']);
    await expectSqlError(asRole(role, userId,
      () => db.query("insert into public.site_catalogues(id, revision) values ('draft', 0)")), ['42501']);
  }
});

test('saving a draft preserves the public version, and stale draft/publish attempts cannot overwrite it', async () => {
  const original = await state();
  const draft = clone(original.publishedConfig);
  draft.properties[0].title = 'Unpublished test title';
  await asRole('authenticated', ADMIN,
    () => rpc('site_save_draft', [draft, original.draftRevision]));
  const saved = await state();
  assert.equal(saved.draftRevision, original.draftRevision + 1);
  assert.equal(saved.publishedRevision, original.publishedRevision);
  assert.deepEqual(saved.draftConfig, draft);
  assert.deepEqual(saved.publishedConfig, original.publishedConfig);
  const visitorRows = await asRole('anon', null,
    async () => (await db.query('select config from public.site_catalogues')).rows);
  assert.deepEqual(visitorRows, [{ config: original.publishedConfig }]);
  await expectSqlError(asRole('authenticated', ADMIN,
    () => rpc('site_save_draft', [original.publishedConfig, original.draftRevision])), ['40001']);
  await expectSqlError(asRole('authenticated', ADMIN,
    () => rpc('site_publish_catalogue', [draft, original.draftRevision, original.publishedRevision])), ['40001']);
  await expectSqlError(asRole('authenticated', ADMIN,
    () => rpc('site_publish_catalogue', [draft, saved.draftRevision, original.publishedRevision - 1])), ['40001']);
  assert.deepEqual(await state(), saved);
});

test('publishing changes draft and public catalogue atomically and rejects a second outdated publisher', async () => {
  const current = await state();
  const config = clone(current.draftConfig);
  config.properties[0].title = 'Published test title';
  await asRole('authenticated', ADMIN,
    () => rpc('site_publish_catalogue', [config, current.draftRevision, current.publishedRevision]));
  const published = await state();
  assert.equal(published.draftRevision, current.draftRevision + 1);
  assert.equal(published.publishedRevision, current.publishedRevision + 1);
  assert.deepEqual(published.draftConfig, config);
  assert.deepEqual(published.publishedConfig, config);
  const visitor = await asRole('anon', null,
    async () => (await db.query("select config from public.site_catalogues where id = 'published'")).rows[0]);
  assert.deepEqual(visitor.config, config);
  await expectSqlError(asRole('authenticated', ADMIN,
    () => rpc('site_publish_catalogue', [current.publishedConfig, current.draftRevision, current.publishedRevision])), ['40001']);
  assert.deepEqual(await state(), published);
});

test('server rejects private fields, invalid real photo rights, duplicate IDs and unsafe image addresses', async () => {
  const current = await state();
  const invalid = [
    config => { config.enquiries = [{ name: 'Private customer' }]; },
    config => { config.business.apiSecret = 'private'; },
    config => { config.properties[0].ownerPhone = '+254123456789'; },
    config => { config.properties[0].demo = false; config.properties[0].photoRightsConfirmed = false; },
    config => { config.properties[1].id = String(config.properties[0].id); },
    config => { config.properties[0].image = 'javascript:alert(1)'; },
    config => { config.properties[0].image = 'https://127.1/private.jpg'; },
    config => { config.properties[0].image = 'https://0x7f.0.0.1/private.jpg'; },
    config => { config.properties[0].image = 'https://0177.0.0.1/private.jpg'; },
    config => { config.properties[0].image = 'https://example.com:65536/photo.jpg'; },
    config => { config.properties[0].image = 'https://bad-.example.com/photo.jpg'; },
    config => { config.business.email = 'agent@bad-.example.com'; },
    config => { config.business.email = `agent@${'a'.repeat(64)}.com`; },
    config => { config.properties[0].title = '🙂'.repeat(101); },
    config => { config.business.name = '🙂'.repeat(51); },
    config => { config.properties[0].title = '\u00a0\ufeff'; },
    config => { config.properties[0].id = '\u00a0\ufeff'; },
    config => { config.business.name = '\u00a0\ufeff'; },
    config => { config.properties[0].image = 'https://example.com/photo\u00a0.jpg'; },
    config => { config.properties[0].price = -1; },
    config => { config.properties[0].status = 'sold'; config.properties[0].purpose = 'rent'; },
  ];
  for (const mutate of invalid) {
    const config = clone(current.publishedConfig);
    mutate(config);
    await expectSqlError(asRole('authenticated', ADMIN,
      () => rpc('site_save_draft', [config, current.draftRevision])), ['22023', '23514']);
    await expectSqlError(asRole('authenticated', ADMIN,
      () => rpc('site_publish_catalogue', [config, current.draftRevision, current.publishedRevision])), ['22023', '23514']);
  }
  assert.deepEqual(await state(), current, 'Rejected data must not increment revisions or change either catalogue');
});

test('only approved admin can add photos under their own folder, and live files cannot be overwritten or deleted', async () => {
  // A pre-existing broad policy for some other bucket must not open this one.
  await db.exec(`create policy unrelated_bucket_open on storage.objects for all
    to anon, authenticated using (true) with check (true)`);
  const bucket = (await db.query("select * from storage.buckets where id = 'property-photos'")).rows[0];
  assert.equal(bucket.public, true);
  assert.equal(Number(bucket.file_size_limit), 8 * 1024 * 1024);
  assert.deepEqual([...bucket.allowed_mime_types].sort(), ['image/jpeg', 'image/png', 'image/webp']);
  const sql = 'insert into storage.objects(bucket_id, name, owner_id, metadata) values ($1, $2, $3, $4) returning id';
  await expectSqlError(asRole('anon', null, () => db.query(sql,
    ['property-photos', `${ADMIN}/${PHOTO}`, ADMIN, { mimetype: 'image/jpeg', size: 100 }])), ['42501']);
  await expectSqlError(asRole('authenticated', STRANGER, () => db.query(sql,
    ['property-photos', `${STRANGER}/${PHOTO}`, STRANGER, { mimetype: 'image/jpeg', size: 100 }])), ['42501']);
  await expectSqlError(asRole('authenticated', ADMIN, () => db.query(sql,
    ['property-photos', `${STRANGER}/${PHOTO}`, ADMIN, { mimetype: 'image/jpeg', size: 100 }])), ['42501']);
  const inserted = await asRole('authenticated', ADMIN, () => db.query(sql,
    ['property-photos', `${ADMIN}/${PHOTO}`, ADMIN, { mimetype: 'image/jpeg', size: 100 }]));
  assert.equal(inserted.rows.length, 1);
  const objectId = inserted.rows[0].id;
  for (const [role, userId] of [['anon', null], ['authenticated', STRANGER]]) {
    const visible = await asRole(role, userId,
      async () => (await db.query("select * from storage.objects where bucket_id = 'property-photos'")).rows);
    assert.deepEqual(visible, [], 'Broad storage policy must not reveal draft photo names');
  }
  await cannotChangeStorage('update storage.objects set name = $1 where id = $2 returning id',
    [`${ADMIN}/changed.jpg`, objectId], 'authenticated', ADMIN);
  await cannotChangeStorage('delete from storage.objects where id = $1 returning id',
    [objectId], 'authenticated', ADMIN);
  assert.equal((await db.query('select count(*)::int as count from storage.objects where id = $1', [objectId])).rows[0].count, 1);
  await db.exec('drop policy unrelated_bucket_open on storage.objects');
});

test('removing admin membership revokes RPC and storage rights even while the auth session remains valid', async () => {
  await db.query('delete from public.site_admins where user_id = $1', [ADMIN]);
  try {
    assert.equal(await asRole('authenticated', ADMIN, () => rpc('site_admin_check')), false);
    await expectSqlError(asRole('authenticated', ADMIN, () => rpc('site_catalogue_state')), ['42501']);
    await expectSqlError(asRole('authenticated', ADMIN,
      () => db.query('insert into storage.objects(bucket_id, name) values ($1, $2)',
        ['property-photos', `${ADMIN}/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg`])), ['42501']);
  } finally {
    await db.query('insert into public.site_admins(user_id) values ($1)', [ADMIN]);
  }
});

test('rerunning installation and sample seed does not reset a catalogue already edited by the agent', async () => {
  const current = await state();
  await db.exec(schema);
  await db.exec(seed);
  assert.deepEqual(await state(), current);
});

test('an installation without seed can save its first shared draft and publish atomically from revision zero', async () => {
  await db.exec('begin');
  try {
    await db.exec('delete from public.site_catalogues');
    assert.deepEqual(await state(), {
      draftConfig: null, publishedConfig: null, draftRevision: 0, publishedRevision: 0,
    });
    await asRole('authenticated', ADMIN, () => rpc('site_save_draft', [publicConfig, 0]));
    const draft = await state();
    assert.deepEqual(draft.draftConfig, publicConfig);
    assert.equal(draft.draftRevision, 1);
    assert.equal(draft.publishedConfig, null);
    assert.equal(draft.publishedRevision, 0);
    assert.deepEqual(await asRole('anon', null,
      async () => (await db.query('select * from public.site_catalogues')).rows), []);
    await asRole('authenticated', ADMIN, () => rpc('site_publish_catalogue', [publicConfig, 1, 0]));
    const published = await state();
    assert.deepEqual(published.publishedConfig, publicConfig);
    assert.equal(published.draftRevision, 2);
    assert.equal(published.publishedRevision, 1);
  } finally { await db.exec('rollback'); }
});

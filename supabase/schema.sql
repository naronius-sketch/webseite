-- Run once in the Supabase SQL editor, then run seed.sql. Safe to rerun.
-- Only trusted project owners may edit site_admins. Never grant membership from the browser.
begin;

create table if not exists public.site_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.site_catalogues (
  id text primary key check (id in ('draft', 'published')),
  config jsonb,
  revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  updated_at timestamptz not null default now(),
  check ((revision = 0 and config is null) or (revision > 0 and config is not null))
);
alter table public.site_admins enable row level security;
alter table public.site_catalogues enable row level security;
revoke all on public.site_admins, public.site_catalogues from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;
grant select on public.site_catalogues to anon, authenticated;

create or replace function public.site_admin_check()
returns boolean language sql stable security definer set search_path = ''
as $$ select auth.uid() is not null and exists (
  select 1 from public.site_admins where user_id = auth.uid()
); $$;
revoke all on function public.site_admin_check() from public, anon, authenticated;
grant execute on function public.site_admin_check() to authenticated;

drop policy if exists site_published_read on public.site_catalogues;
create policy site_published_read on public.site_catalogues for select to anon, authenticated
  using (id = 'published');
drop policy if exists site_admin_draft_read on public.site_catalogues;
create policy site_admin_draft_read on public.site_catalogues for select to authenticated
  using (public.site_admin_check());
-- No membership policies or direct catalogue write policies: guarded RPCs are the only writes.

create or replace function public.site_assert_keys(value jsonb, allowed text[], required text[] default '{}')
returns void language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  if value is null or jsonb_typeof(value) <> 'object' then
    raise exception using errcode = '22023', message = 'Invalid public catalogue: expected an object.';
  end if;
  for k in select jsonb_object_keys(value) loop
    if not (k = any(allowed)) then
      raise exception using errcode = '22023', message = 'Invalid public catalogue: unknown or private field.';
    end if;
  end loop;
  foreach k in array required loop
    if not (value ? k) then
      raise exception using errcode = '22023', message = 'Invalid public catalogue: required field missing.';
    end if;
  end loop;
end; $$;

-- Match JavaScript string length, including the two UTF-16 units of supplementary characters.
create or replace function public.site_text_length(value text)
returns integer language plpgsql immutable strict set search_path = '' as $$
declare units integer := length(value); i integer;
begin
  for i in 1..length(value) loop
    if ascii(substr(value, i, 1)) > 65535 then units := units + 1; end if;
  end loop;
  return units;
end; $$;

create or replace function public.site_assert_text(value jsonb, maximum integer, required boolean default false)
returns void language plpgsql immutable set search_path = '' as $$
declare v text;
begin
  if value is null or jsonb_typeof(value) <> 'string' then
    raise exception using errcode = '22023', message = 'Invalid public catalogue: expected text.';
  end if;
  v := value #>> '{}';
  if public.site_text_length(v) > maximum or regexp_replace(v, E'[\t\n\r]', '', 'g') ~ '[[:cntrl:]]'
    or (required and btrim(v, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '') then
    raise exception using errcode = '22023', message = 'Invalid public catalogue: invalid text.';
  end if;
end; $$;

create or replace function public.site_assert_number(value jsonb, minimum numeric, maximum numeric, whole boolean default false)
returns void language plpgsql immutable set search_path = '' as $$
declare v numeric;
begin
  if value is null or jsonb_typeof(value) <> 'number' then
    raise exception using errcode = '22023', message = 'Invalid public catalogue: expected a number.';
  end if;
  v := (value #>> '{}')::numeric;
  if v < minimum or v > maximum or (whole and trunc(v) <> v) then
    raise exception using errcode = '22023', message = 'Invalid public catalogue: number outside allowed range.';
  end if;
end; $$;

create or replace function public.site_public_image_url(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v text; authority text; host text; parts text[]; a integer; b integer; octet text; label text;
begin
  if value is null or jsonb_typeof(value) <> 'string' then return false; end if;
  v := value #>> '{}';
  if v = '' or public.site_text_length(v) > 2048 or v ~ '[[:cntrl:]]'
    or translate(v, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF', '') <> v
    or position(chr(92) in v) > 0 then return false; end if;
  if left(v, 1) = '/' then return left(v, 2) <> '//'; end if;
  parts := regexp_match(v, '^https://([^/?#]+)(?:[/?#].*)?$');
  if parts is null then return false; end if;
  authority := lower(parts[1]);
  if authority ~ '[@\[\]]' then return false; end if;
  parts := regexp_match(authority, '^([^:]+)(?::([0-9]+))?$');
  if parts is null then return false; end if;
  host := parts[1];
  if parts[2] is not null and (length(parts[2]) > 5 or parts[2]::integer > 65535) then return false; end if;
  if host !~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' or position('.' in host) = 0
    or host ~ '(^|\.)(localhost|local|internal)$' then return false; end if;
  if host ~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' then
    parts := string_to_array(host, '.');
    foreach octet in array parts loop
      if length(octet) > 3 or octet::integer > 255 or (length(octet) > 1 and left(octet, 1) = '0') then return false; end if;
    end loop;
    a := parts[1]::integer; b := parts[2]::integer;
    if a in (0, 10, 127) or a >= 224 or (a = 169 and b = 254)
      or (a = 172 and b between 16 and 31) or (a = 192 and b = 168) then return false; end if;
  else
    -- WHATWG browsers normalize abbreviated/hex/octal IPv4 hosts; reject those spellings.
    if host ~ '(^|\.)([0-9]+|0x[0-9a-f]+)$' then return false; end if;
    foreach label in array string_to_array(host, '.') loop
      if length(label) > 63 or label !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' then return false; end if;
    end loop;
  end if;
  return true;
end; $$;

create or replace function public.site_validate_catalogue(value jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare business jsonb; policy jsonb; property jsonb; item jsonb; k text;
  identifier text; identifiers text[] := '{}'; phone text; email text; label text;
begin
  if value is null or octet_length(value::text) > 2000000 then
    raise exception using errcode = '22023', message = 'Invalid public catalogue: maximum size is 2 MB.';
  end if;
  perform public.site_assert_keys(value, array['schemaVersion','business','properties'], array['schemaVersion','business','properties']);
  if value->'schemaVersion' <> '1'::jsonb then
    raise exception using errcode = '22023', message = 'Invalid public catalogue: unsupported version.';
  end if;
  business := value->'business';
  perform public.site_assert_keys(business,
    array['name','agentName','whatsapp','email','serviceArea','viewingPolicy'],
    array['name','agentName','whatsapp','email','serviceArea','viewingPolicy']);
  perform public.site_assert_text(business->'name', 100, true);
  perform public.site_assert_text(business->'agentName', 100);
  perform public.site_assert_text(business->'whatsapp', 50);
  perform public.site_assert_text(business->'email', 254);
  perform public.site_assert_text(business->'serviceArea', 200);
  phone := business->>'whatsapp'; email := business->>'email';
  if phone <> '' and (phone !~ '^\+[1-9][0-9 ()-]*$'
    or regexp_replace(phone, '[^0-9]', '', 'g') !~ '^[1-9][0-9]{7,14}$') then
    raise exception using errcode = '22023', message = 'Invalid public catalogue: international phone required.';
  end if;
  if email <> '' and (email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$'
    or length(split_part(email, '@', 1)) > 64 or split_part(email, '@', 1) ~ '(^\.|\.$|\.\.)'
    or split_part(email, '@', 2) ~ '(\.\.|\.-|-\.)') then
    raise exception using errcode = '22023', message = 'Invalid public catalogue: invalid contact email.';
  end if;
  if email <> '' then
    foreach label in array string_to_array(split_part(email, '@', 2), '.') loop
      if length(label) > 63 or label !~ '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$' then
        raise exception using errcode = '22023', message = 'Invalid public catalogue: invalid email domain.';
      end if;
    end loop;
  end if;
  policy := business->'viewingPolicy';
  perform public.site_assert_keys(policy,
    array['mode','fixedAmount','enabled','creditOnCompletion','cancellationHours'],
    array['mode','fixedAmount','enabled','creditOnCompletion','cancellationHours']);
  if policy->>'mode' not in ('quote','fixed') or jsonb_typeof(policy->'mode') <> 'string'
    or jsonb_typeof(policy->'enabled') <> 'boolean' or jsonb_typeof(policy->'creditOnCompletion') <> 'boolean' then
    raise exception using errcode = '22023', message = 'Invalid public catalogue: invalid viewing policy.';
  end if;
  if policy->'fixedAmount' <> 'null'::jsonb then
    perform public.site_assert_number(policy->'fixedAmount', 1, 1000000);
  elsif policy->>'enabled' = 'true' and policy->>'mode' = 'fixed' then
    raise exception using errcode = '22023', message = 'Invalid public catalogue: fixed fee requires an amount.';
  end if;
  perform public.site_assert_number(policy->'cancellationHours', 0, 168, true);
  if jsonb_typeof(value->'properties') <> 'array' or jsonb_array_length(value->'properties') > 2000 then
    raise exception using errcode = '22023', message = 'Invalid public catalogue: expected up to 2000 properties.';
  end if;
  for property in select jsonb_array_elements(value->'properties') loop
    perform public.site_assert_keys(property,
      array['id','title','location','city','category','purpose','price','beds','baths','area','image','tag','description','amenities','demo','status','photos','photoCredit','photoLicense','photoSource','photoRightsConfirmed'],
      array['id','title','location','city','category','purpose','price','beds','baths','area','image','tag','description','amenities','demo','status']);
    if jsonb_typeof(property->'id') = 'string' then
      perform public.site_assert_text(property->'id', 100, true);
      identifier := property->>'id';
    elsif jsonb_typeof(property->'id') = 'number' then
      perform public.site_assert_number(property->'id', 0, 9007199254740991, true);
      identifier := ((property->>'id')::numeric)::bigint::text;
    else raise exception using errcode = '22023', message = 'Invalid public catalogue: invalid property ID.';
    end if;
    if identifier = any(identifiers) then
      raise exception using errcode = '22023', message = 'Invalid public catalogue: duplicate property ID.';
    end if;
    identifiers := array_append(identifiers, identifier);
    foreach k in array array['title','location'] loop perform public.site_assert_text(property->k, 200, true); end loop;
    foreach k in array array['city','category'] loop perform public.site_assert_text(property->k, 100, true); end loop;
    perform public.site_assert_text(property->'description', 10000, true);
    perform public.site_assert_text(property->'tag', 100);
    if property->>'purpose' not in ('buy','rent') or jsonb_typeof(property->'purpose') <> 'string'
      or property->>'status' not in ('available','reserved','sold','let') or jsonb_typeof(property->'status') <> 'string'
      or (property->>'status' = 'sold' and property->>'purpose' <> 'buy')
      or (property->>'status' = 'let' and property->>'purpose' <> 'rent') then
      raise exception using errcode = '22023', message = 'Invalid public catalogue: invalid property status or purpose.';
    end if;
    perform public.site_assert_number(property->'price', 1, 1000000000000);
    perform public.site_assert_number(property->'beds', 0, 100, true);
    perform public.site_assert_number(property->'baths', 0, 100, true);
    perform public.site_assert_number(property->'area', 1, 100000000);
    if not public.site_public_image_url(property->'image') then
      raise exception using errcode = '22023', message = 'Invalid public catalogue: unsafe property image.';
    end if;
    if jsonb_typeof(property->'demo') <> 'boolean'
      or (property ? 'photoRightsConfirmed' and jsonb_typeof(property->'photoRightsConfirmed') <> 'boolean')
      or (property->>'demo' = 'false' and (property->'photoRightsConfirmed') is distinct from 'true'::jsonb) then
      raise exception using errcode = '22023', message = 'Invalid public catalogue: confirm rights to real property photos.';
    end if;
    if jsonb_typeof(property->'amenities') <> 'array' or jsonb_array_length(property->'amenities') > 100 then
      raise exception using errcode = '22023', message = 'Invalid public catalogue: invalid amenities.';
    end if;
    for item in select jsonb_array_elements(property->'amenities') loop perform public.site_assert_text(item, 200, true); end loop;
    if property ? 'photos' then
      if jsonb_typeof(property->'photos') <> 'array' or jsonb_array_length(property->'photos') > 50 then
        raise exception using errcode = '22023', message = 'Invalid public catalogue: invalid photo list.';
      end if;
      for item in select jsonb_array_elements(property->'photos') loop
        if not public.site_public_image_url(item) then
          raise exception using errcode = '22023', message = 'Invalid public catalogue: unsafe photo URL.';
        end if;
      end loop;
    end if;
    foreach k in array array['photoCredit','photoLicense','photoSource'] loop
      if property ? k then perform public.site_assert_text(property->k, 2000); end if;
    end loop;
  end loop;
end; $$;

create or replace function public.site_catalogue_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception using errcode = '28000', message = 'Sign-in required.'; end if;
  if not public.site_admin_check() then raise exception using errcode = '42501', message = 'Approved admin required.'; end if;
  select jsonb_build_object(
    'draftConfig', d.config, 'publishedConfig', p.config,
    'draftRevision', coalesce(d.revision, 0), 'publishedRevision', coalesce(p.revision, 0)
  ) into result from (select 1) singleton
  left join public.site_catalogues d on d.id = 'draft'
  left join public.site_catalogues p on p.id = 'published';
  return result;
end; $$;

create or replace function public.site_save_draft(p_config jsonb, p_expected_draft_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_revision bigint;
begin
  if auth.uid() is null then raise exception using errcode = '28000', message = 'Sign-in required.'; end if;
  if not public.site_admin_check() then raise exception using errcode = '42501', message = 'Approved admin required.'; end if;
  perform public.site_validate_catalogue(p_config);
  insert into public.site_catalogues(id, config, revision) values ('draft', null, 0) on conflict (id) do nothing;
  select revision into current_revision from public.site_catalogues where id = 'draft' for update;
  if current_revision is distinct from p_expected_draft_revision then
    raise exception using errcode = '40001', message = 'Catalogue revision conflict.';
  end if;
  update public.site_catalogues set config = p_config, revision = revision + 1, updated_at = now() where id = 'draft';
  return public.site_catalogue_state();
end; $$;

create or replace function public.site_publish_catalogue(p_config jsonb, p_expected_draft_revision bigint, p_expected_published_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare draft_revision bigint; published_revision bigint;
begin
  if auth.uid() is null then raise exception using errcode = '28000', message = 'Sign-in required.'; end if;
  if not public.site_admin_check() then raise exception using errcode = '42501', message = 'Approved admin required.'; end if;
  perform public.site_validate_catalogue(p_config);
  -- All writers lock draft first; publication atomically checks and updates both versions.
  insert into public.site_catalogues(id, config, revision) values ('draft', null, 0) on conflict (id) do nothing;
  select revision into draft_revision from public.site_catalogues where id = 'draft' for update;
  insert into public.site_catalogues(id, config, revision) values ('published', null, 0) on conflict (id) do nothing;
  select revision into published_revision from public.site_catalogues where id = 'published' for update;
  if draft_revision is distinct from p_expected_draft_revision or published_revision is distinct from p_expected_published_revision then
    raise exception using errcode = '40001', message = 'Catalogue revision conflict.';
  end if;
  update public.site_catalogues set config = p_config, revision = revision + 1, updated_at = now() where id in ('draft', 'published');
  return public.site_catalogue_state();
end; $$;

revoke all on function public.site_assert_keys(jsonb, text[], text[]) from public, anon, authenticated;
revoke all on function public.site_text_length(text) from public, anon, authenticated;
revoke all on function public.site_assert_text(jsonb, integer, boolean) from public, anon, authenticated;
revoke all on function public.site_assert_number(jsonb, numeric, numeric, boolean) from public, anon, authenticated;
revoke all on function public.site_public_image_url(jsonb) from public, anon, authenticated;
revoke all on function public.site_validate_catalogue(jsonb) from public, anon, authenticated;
revoke all on function public.site_catalogue_state() from public, anon, authenticated;
revoke all on function public.site_save_draft(jsonb, bigint) from public, anon, authenticated;
revoke all on function public.site_publish_catalogue(jsonb, bigint, bigint) from public, anon, authenticated;
grant execute on function public.site_catalogue_state() to authenticated;
grant execute on function public.site_save_draft(jsonb, bigint) to authenticated;
grant execute on function public.site_publish_catalogue(jsonb, bigint, bigint) to authenticated;

-- Public photo URLs are immediately visible. Upload only photos intended for publication.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('property-photos', 'property-photos', true, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
alter table storage.objects enable row level security;
grant select, insert on storage.objects to authenticated;

drop policy if exists site_admin_photo_insert on storage.objects;
create policy site_admin_photo_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'property-photos' and public.site_admin_check()
  and (storage.foldername(name))[1] = auth.uid()::text
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
);
drop policy if exists site_admin_photo_select on storage.objects;
create policy site_admin_photo_select on storage.objects for select to authenticated
  using (bucket_id = 'property-photos' and public.site_admin_check());
-- Restrictive policies keep this bucket protected even if another bucket has broad policies.
drop policy if exists site_photo_insert_guard on storage.objects;
create policy site_photo_insert_guard on storage.objects as restrictive for insert to authenticated with check (
  bucket_id <> 'property-photos' or (public.site_admin_check()
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
);
drop policy if exists site_photo_anon_insert_guard on storage.objects;
create policy site_photo_anon_insert_guard on storage.objects as restrictive for insert to anon
  with check (bucket_id <> 'property-photos');
drop policy if exists site_photo_select_guard on storage.objects;
create policy site_photo_select_guard on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'property-photos' or public.site_admin_check());
drop policy if exists site_photo_anon_select_guard on storage.objects;
create policy site_photo_anon_select_guard on storage.objects as restrictive for select to anon
  using (bucket_id <> 'property-photos');
drop policy if exists site_photo_update_guard on storage.objects;
create policy site_photo_update_guard on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id <> 'property-photos') with check (bucket_id <> 'property-photos');
drop policy if exists site_photo_delete_guard on storage.objects;
create policy site_photo_delete_guard on storage.objects as restrictive for delete to anon, authenticated
  using (bucket_id <> 'property-photos');

commit;

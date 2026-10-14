import { createClient } from '@supabase/supabase-js';
import { getBackendConfig } from './admin-config.js';
import { safeContactEmail, validatePublicConfig } from './broker-model.js';

export const PROPERTY_PHOTO_BUCKET = 'property-photos';
export const MAX_PROPERTY_PHOTO_BYTES = 8 * 1024 * 1024;

// One real auth client per connection avoids duplicated refresh timers when the panel reopens.
// Anonymous readers use a separate, non-persistent client and cannot restore that session.
const adminClients = new Map();
const publicClients = new Map();

const messages = {
  CONFIG: 'The cloud admin connection has not been configured.',
  AUTH_REQUIRED: 'Please sign in to continue.',
  ADMIN_REQUIRED: 'This account has not been approved to manage the website.',
  SIGN_IN: 'Sign-in failed. Check your email and password and try again.',
  REVISION_CONFLICT: 'Another device has changed this catalogue. Reload the latest version before saving.',
  VALIDATION: 'The catalogue contains invalid or private fields. Check the listing details before saving.',
  NETWORK: 'The website service could not complete this request. Please try again.',
  UPLOAD: 'Upload failed. Use a JPEG, PNG or WebP photo of at most 8 MB.',
};

function failure(code) {
  const error = new Error(messages[code] ?? messages.NETWORK);
  error.code = code;
  return error;
}

function serviceFailure(error, fallback = 'NETWORK') {
  if (error?.code && Object.hasOwn(messages, error.code)) return failure(error.code);
  if (error?.code === '40001') return failure('REVISION_CONFLICT');
  if (error?.code === '22023') return failure('VALIDATION');
  if (error?.code === '28000' || error?.status === 401) return failure('AUTH_REQUIRED');
  if (error?.code === '42501' || error?.status === 403) return failure('ADMIN_REQUIRED');
  return failure(fallback);
}

function makeClient(input, options, publicOnly) {
  const config = getBackendConfig(input);
  if (!config.configured) throw failure('CONFIG');
  if (options.client) return options.client;
  const clientOptions = {
    auth: { persistSession: !publicOnly, autoRefreshToken: !publicOnly, detectSessionInUrl: false,
      ...(publicOnly ? { storageKey: `wangechi-public-catalogue-${new URL(config.supabaseUrl).hostname}` } : {}) },
  };
  // Injected factories remain isolated so tests and alternate callers never share clients.
  if (options.createClientImpl !== undefined) {
    return options.createClientImpl(config.supabaseUrl, config.publishableKey, clientOptions);
  }
  const cache = publicOnly ? publicClients : adminClients;
  let projectClients = cache.get(config.supabaseUrl);
  if (!projectClients) { projectClients = new Map(); cache.set(config.supabaseUrl, projectClients); }
  if (!projectClients.has(config.publishableKey)) {
    projectClients.set(config.publishableKey, createClient(config.supabaseUrl, config.publishableKey, clientOptions));
  }
  return projectClients.get(config.publishableKey);
}

function validRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw failure('VALIDATION');
  return revision;
}

function normalizedConfig(input) {
  const result = validatePublicConfig(input);
  if (!result.valid || JSON.stringify(result.config).length > 2_000_000) throw failure('VALIDATION');
  return result.config;
}

function catalogueState(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure('NETWORK');
  return {
    draftConfig: data.draftConfig === null ? null : normalizedConfig(data.draftConfig),
    publishedConfig: data.publishedConfig === null ? null : normalizedConfig(data.publishedConfig),
    draftRevision: validRevision(data.draftRevision),
    publishedRevision: validRevision(data.publishedRevision),
  };
}

async function request(operation, fallback) {
  try {
    const result = await operation();
    if (result?.error) throw serviceFailure(result.error, fallback);
    return result?.data;
  } catch (error) { throw serviceFailure(error, fallback); }
}

async function readPublished(client) {
  try {
    const result = await client.from('site_catalogues').select('config').eq('id', 'published').maybeSingle();
    if (result.error) throw serviceFailure(result.error);
    return result.data?.config == null ? null : normalizedConfig(result.data.config);
  } catch (error) { throw serviceFailure(error); }
}

/** Anonymous catalogue reader never restores or persists an administrator's session. */
export function createPublicCatalogueService(config, options = {}) {
  const client = makeClient(config, options, true);
  return Object.freeze({ readPublished: () => readPublished(client) });
}

/** Validate bytes as well as MIME; SVG/HTML and misleading file extensions are rejected. */
export async function validatePropertyPhoto(file) {
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  if (!file || !Object.hasOwn(extensions, file.type) || !Number.isSafeInteger(file.size)
    || file.size <= 0 || file.size > MAX_PROPERTY_PHOTO_BYTES || typeof file.slice !== 'function') throw failure('UPLOAD');
  let bytes;
  try { bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer()); } catch { throw failure('UPLOAD'); }
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  const webp = bytes.length >= 12 && [82, 73, 70, 70].every((byte, index) => bytes[index] === byte)
    && [87, 69, 66, 80].every((byte, index) => bytes[index + 8] === byte);
  if (!(file.type === 'image/jpeg' && jpeg) && !(file.type === 'image/png' && png)
    && !(file.type === 'image/webp' && webp)) throw failure('UPLOAD');
  return { extension: extensions[file.type], contentType: file.type };
}

/** Password-only admin access; every write is also independently authorized by RLS/RPCs. */
export function createAdminService(config, options = {}) {
  const client = makeClient(config, options, false);

  const getSession = async () => {
    const data = await request(() => client.auth.getSession());
    return data?.session ?? null;
  };
  const checkAdmin = async () => {
    const session = await getSession();
    if (!session?.user?.id) return false;
    return (await request(() => client.rpc('site_admin_check'))) === true;
  };
  const requireAdmin = async () => {
    const session = await getSession();
    if (!session?.user?.id) throw failure('AUTH_REQUIRED');
    if ((await request(() => client.rpc('site_admin_check'))) !== true) throw failure('ADMIN_REQUIRED');
    return session;
  };

  return Object.freeze({
    getSession,
    onAuthStateChange(callback) {
      if (typeof callback !== 'function') throw new TypeError('An auth change callback is required.');
      const subscription = client.auth.onAuthStateChange(callback)?.data?.subscription;
      return () => subscription?.unsubscribe();
    },
    async signIn(email, password) {
      const cleanEmail = safeContactEmail(email);
      if (!cleanEmail || typeof password !== 'string' || !password) throw failure('SIGN_IN');
      const data = await request(() => client.auth.signInWithPassword({ email: cleanEmail, password }), 'SIGN_IN');
      if (!data?.session?.user?.id) throw failure('SIGN_IN');
      return data.session;
    },
    async signOut() { await request(() => client.auth.signOut()); },
    checkAdmin,
    async loadCatalogue() {
      await requireAdmin();
      return catalogueState(await request(() => client.rpc('site_catalogue_state')));
    },
    readPublished: () => readPublished(client),
    async saveDraft(input, { draftRevision } = {}) {
      const payload = normalizedConfig(input);
      validRevision(draftRevision);
      await requireAdmin();
      return catalogueState(await request(() => client.rpc('site_save_draft', {
        p_config: payload, p_expected_draft_revision: draftRevision,
      })));
    },
    async publish(input, { draftRevision, publishedRevision } = {}) {
      const payload = normalizedConfig(input);
      validRevision(draftRevision);
      validRevision(publishedRevision);
      await requireAdmin();
      return catalogueState(await request(() => client.rpc('site_publish_catalogue', {
        p_config: payload, p_expected_draft_revision: draftRevision, p_expected_published_revision: publishedRevision,
      })));
    },
    async uploadPhoto(file) {
      const { extension, contentType } = await validatePropertyPhoto(file);
      const session = await requireAdmin();
      const uid = session.user.id;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) throw failure('AUTH_REQUIRED');
      const path = `${uid}/${globalThis.crypto.randomUUID()}.${extension}`;
      const bucket = client.storage.from(PROPERTY_PHOTO_BUCKET);
      await request(() => bucket.upload(path, file, { contentType, upsert: false, cacheControl: '31536000' }), 'UPLOAD');
      const publicUrl = bucket.getPublicUrl(path)?.data?.publicUrl;
      let url;
      try { url = new URL(publicUrl); } catch { throw failure('UPLOAD'); }
      const expectedOrigin = getBackendConfig(config).supabaseUrl;
      if (url.origin !== expectedOrigin || url.username || url.password
        || !url.pathname.startsWith(`/storage/v1/object/public/${PROPERTY_PHOTO_BUCKET}/`)) throw failure('UPLOAD');
      return url.href;
    },
  });
}

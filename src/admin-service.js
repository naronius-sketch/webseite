import { createClient } from '@supabase/supabase-js';
import { getBackendConfig } from './admin-config.js';
import { safeContactEmail, validatePublicConfig } from './broker-model.js';

export const PROPERTY_PHOTO_BUCKET = 'property-photos';
export const MAX_PROPERTY_PHOTO_BYTES = 8 * 1024 * 1024;
export const MIN_AGENT_PASSWORD_LENGTH = 12;
export const MAX_AGENT_PASSWORD_LENGTH = 200;
export const MAX_NEW_AGENT_PASSWORD_BYTES = 72;

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
  PASSWORD_CURRENT: 'Check your current password and try again. It must be no longer than 200 characters.',
  PASSWORD_WEAK: 'Use a stronger password with at least 12 characters. It cannot contain only spaces.',
  PASSWORD_TOO_LONG: 'This password is too long. Use a shorter password, especially if it contains emoji or accented letters.',
  PASSWORD_SAME: 'Choose a new password that is different from your current password.',
  PASSWORD_REAUTH: 'Your current password could not be verified. Please try again.',
  PASSWORD_UPDATE: 'The password change could not be confirmed. Try signing in with your new password before changing it again.',
  PASSWORD_RATE_LIMIT: 'Too many password attempts. Please wait a few minutes before trying again.',
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

// Password verification errors must not use the ordinary 401 => signed-out mapping:
// a mistyped current password does not invalidate the agent's existing session.
async function passwordRequest(operation, fallback) {
  const mapError = error => {
    if (error?.status === 429 || ['over_request_rate_limit', 'rate_limit_exceeded'].includes(error?.code)) return failure('PASSWORD_RATE_LIMIT');
    if (['invalid_credentials', 'invalid_password'].includes(error?.code)) return failure('PASSWORD_CURRENT');
    if (error?.code === 'weak_password') return failure('PASSWORD_WEAK');
    if (error?.code === 'same_password') return failure('PASSWORD_SAME');
    if (['reauthentication_needed', 'reauthentication_not_valid'].includes(error?.code)) return failure('PASSWORD_REAUTH');
    return failure(fallback);
  };
  let result;
  try { result = await operation(); } catch (error) { throw mapError(error); }
  if (result?.error) throw mapError(result.error);
  return result?.data;
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
    async changePassword(currentPassword, newPassword) {
      if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > MAX_AGENT_PASSWORD_LENGTH) throw failure('PASSWORD_CURRENT');
      if (typeof newPassword !== 'string' || newPassword.length < MIN_AGENT_PASSWORD_LENGTH
        || !newPassword.trim()) throw failure('PASSWORD_WEAK');
      if (new TextEncoder().encode(newPassword).length > MAX_NEW_AGENT_PASSWORD_BYTES) throw failure('PASSWORD_TOO_LONG');
      if (newPassword === currentPassword) throw failure('PASSWORD_SAME');

      const original = await requireAdmin();
      const originalId = original.user.id;
      const email = safeContactEmail(original.user.email);
      if (!email) throw failure('AUTH_REQUIRED');
      const requireOriginalSession = async () => {
        if ((await getSession())?.user?.id !== originalId) throw failure('AUTH_REQUIRED');
      };
      await requireOriginalSession();
      const verified = await passwordRequest(() => client.auth.signInWithPassword({
        email, password: currentPassword,
      }), 'PASSWORD_REAUTH');
      if (verified?.session?.user?.id !== originalId || verified?.user?.id !== originalId) throw failure('AUTH_REQUIRED');

      const approved = await requireAdmin();
      if (approved.user.id !== originalId) throw failure('AUTH_REQUIRED');
      await requireOriginalSession();
      const updated = await passwordRequest(() => client.auth.updateUser({
        password: newPassword, current_password: currentPassword,
      }), 'PASSWORD_UPDATE');
      if (!updated?.user?.id) throw failure('PASSWORD_UPDATE');
      if (updated.user.id !== originalId) throw failure('AUTH_REQUIRED');
      await requireOriginalSession();
    },
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

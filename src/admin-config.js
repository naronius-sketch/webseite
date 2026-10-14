/** Public connection settings only. Service-role/secret keys must never enter this file. */
export const EMPTY_ADMIN_CONFIG = Object.freeze({
  schemaVersion: 1, supabaseUrl: '', publishableKey: '', configured: false,
});

function configError() {
  const error = new Error('The admin connection settings are invalid. Use your Supabase project URL and public publishable key.');
  error.code = 'CONFIG';
  return error;
}

function isPublicKey(key) {
  if (/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key)) return true;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
  try {
    const segment = key.split('.')[1];
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - segment.length % 4) % 4);
    const payload = JSON.parse(atob(padded));
    return payload !== null && typeof payload === 'object' && !Array.isArray(payload) && payload.role === 'anon';
  } catch { return false; }
}

/** Validate a hosted Supabase connection; empty settings deliberately disable cloud admin. */
export function getBackendConfig(input = EMPTY_ADMIN_CONFIG) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw configError();
  if (Object.keys(input).some(key => !['schemaVersion', 'supabaseUrl', 'publishableKey', 'configured'].includes(key))
    || (input.schemaVersion !== undefined && input.schemaVersion !== 1)
    || typeof input.supabaseUrl !== 'string' || typeof input.publishableKey !== 'string') throw configError();
  const suppliedUrl = input.supabaseUrl.trim();
  const publishableKey = input.publishableKey.trim();
  if (!suppliedUrl && !publishableKey) return EMPTY_ADMIN_CONFIG;
  if (!suppliedUrl || !publishableKey || publishableKey.length > 4096 || !isPublicKey(publishableKey)) throw configError();
  let url;
  try { url = new URL(suppliedUrl); } catch { throw configError(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
    || url.pathname !== '/' || !/^[a-z0-9]{8,64}\.supabase\.co$/.test(url.hostname)) throw configError();
  return Object.freeze({ schemaVersion: 1, supabaseUrl: url.origin, publishableKey, configured: true });
}

/** Runtime settings permit deployment on GitHub Pages without embedding keys in source. */
export async function loadBackendConfig({ fetchImpl = globalThis.fetch,
  url = `${import.meta.env?.BASE_URL ?? '/'}admin-config.json`, signal } = {}) {
  let response;
  try { response = await fetchImpl(url, { cache: 'no-store', credentials: 'omit', signal }); }
  catch {
    const error = new Error('The admin connection settings could not be loaded. Please try again.');
    error.code = 'NETWORK';
    throw error;
  }
  if (!response?.ok) {
    const error = new Error('The admin connection settings could not be loaded. Please try again.');
    error.code = 'NETWORK';
    throw error;
  }
  let input;
  try { input = await response.json(); } catch { throw configError(); }
  return getBackendConfig(input);
}

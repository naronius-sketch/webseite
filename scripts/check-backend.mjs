import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { getBackendConfig } from '../src/admin-config.js';
import { createPublicCatalogueService } from '../src/admin-service.js';
import { validatePublicConfig } from '../src/broker-model.js';

function failed(code, status) {
  const error = new Error('The configured backend did not pass the deployment readiness checks.');
  error.code = code;
  if (Number.isInteger(status)) error.status = status;
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function bodyJson(response, code) {
  try { return await response.json(); } catch { throw failed(code, response.status); }
}

/**
 * Run only read operations against the production backend before publishing the site.
 * The API key is public, but no connection settings or response data are ever logged.
 */
export async function checkBackend(input, { fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  let config;
  try { config = getBackendConfig(input); } catch { throw failed('CONFIG'); }
  if (!config.configured) return { configured: false, status: 'disabled' };
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw failed('CONFIG');
  }

  const withinDeadline = async operation => {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(failed('BACKEND_TIMEOUT'));
        controller.abort();
      }, timeoutMs);
    });
    try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]); }
    finally { clearTimeout(timer); }
  };
  const request = (path, processResponse, post = false) => withinDeadline(async signal => {
    let response;
    try {
      response = await fetchImpl(`${config.supabaseUrl}${path}`, {
        method: post ? 'POST' : 'GET',
        headers: { apikey: config.publishableKey, Accept: 'application/json',
          ...(post ? { 'Content-Type': 'application/json' } : {}) },
        ...(post ? { body: '{}' } : {}),
        credentials: 'omit', redirect: 'error', signal,
      });
    } catch { throw failed('BACKEND_NETWORK'); }
    return processResponse(response);
  });

  const checks = await Promise.allSettled([
    request('/rest/v1/site_catalogues?select=id,config', async response => {
      if (response.status !== 200) throw failed('CATALOGUE_UNAVAILABLE', response.status);
      const rows = await bodyJson(response, 'CATALOGUE_INVALID');
      if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0]) || rows[0].id !== 'published'
        || Object.keys(rows[0]).some(key => !['id', 'config'].includes(key))) throw failed('CATALOGUE_INVALID', response.status);
      const result = validatePublicConfig(rows[0].config);
      if (!result.valid || JSON.stringify(result.config).length > 2_000_000) throw failed('CATALOGUE_INVALID', response.status);
    }),
    request('/rest/v1/site_admins?select=user_id&limit=1', async response => {
      if ([401, 403].includes(response.status)) return;
      if (response.status !== 200) throw failed('MEMBERSHIP_CHECK_FAILED', response.status);
      const rows = await bodyJson(response, 'MEMBERSHIP_CHECK_FAILED');
      if (!Array.isArray(rows) || rows.length !== 0) throw failed('MEMBERSHIP_EXPOSED', response.status);
    }),
    request('/rest/v1/rpc/site_catalogue_state', async response => {
      if ([401, 403].includes(response.status)) return;
      if (response.status >= 200 && response.status < 300) throw failed('ADMIN_STATE_EXPOSED', response.status);
      throw failed('ADMIN_STATE_CHECK_FAILED', response.status);
    }, true),
  ]);
  const rejection = checks.find(check => check.status === 'rejected');
  if (rejection) throw rejection.reason;

  // Also use the actual production service/SDK, so a key or SDK incompatibility
  // cannot pass the raw HTTP checks and then leave the published website empty.
  await withinDeadline(async signal => {
    let responseStatus;
    const reader = createPublicCatalogueService(config, {
      createClientImpl: (url, key, options) => createClient(url, key, { ...options,
        global: { fetch: async (target, init) => {
          const response = await fetchImpl(target, { ...init, credentials: 'omit', redirect: 'error', signal });
          responseStatus = response.status;
          return response;
        } },
      }),
    });
    try {
      if (await reader.readPublished() === null) throw failed('SDK_PUBLIC_READ_FAILED', responseStatus);
    } catch { throw failed('SDK_PUBLIC_READ_FAILED', responseStatus); }
  });
  return { configured: true, status: 'ready' };
}

async function main() {
  try {
    const contents = await readFile(new URL('../public/admin-config.json', import.meta.url), 'utf8');
    let input;
    try { input = JSON.parse(contents); } catch { throw failed('CONFIG'); }
    const result = await checkBackend(input);
    console.log(result.configured
      ? 'Backend readiness confirmed: public catalogue is available and private access is blocked.'
      : 'Cloud backend is disabled; no remote checks are needed.');
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[A-Z_]{1,40}$/.test(error.code) ? error.code : 'CONFIG';
    const status = Number.isInteger(error?.status) ? ` (HTTP ${error.status})` : '';
    console.error(`Backend readiness check failed: ${code}${status}. Deployment must stop.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadCatalogueSource } from '../src/catalogue-source.js';

const catalogue = JSON.parse(await readFile(new URL('../public/site-config.json', import.meta.url), 'utf8'));
const disabled = async () => ({ configured: false });

test('an unconnected website reads its existing static catalogue at the correct base', async () => {
  const requests = [];
  const result = await loadCatalogueSource({
    loadBackendConfig: disabled, base: '/webseite/',
    createCloudReader: () => { throw new Error('Cloud reader must not be created.'); },
    fetchImpl: async (url, options) => { requests.push({ url, options }); return { ok: true, text: async () => JSON.stringify(catalogue) }; },
  });
  assert.equal(result.source, 'static');
  assert.equal(result.config.properties.length, 8);
  assert.equal(requests[0].url, '/webseite/site-config.json');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.cache, 'no-store');
});

test('a connected website uses only the public cloud snapshot, including a deliberately empty collection', async () => {
  const live = { ...catalogue, properties: [] };
  const result = await loadCatalogueSource({
    loadBackendConfig: async () => ({ configured: true }),
    createCloudReader: () => ({ readPublished: async () => live }),
    fetchImpl: () => { throw new Error('Static offers must not be fetched.'); },
  });
  assert.equal(result.source, 'cloud');
  assert.deepEqual(result.config.properties, []);
});

test('cloud failures and a missing first publication cannot resurrect static offers', async () => {
  for (const readPublished of [async () => null, async () => { throw new Error('Offline'); }]) {
    let staticCalls = 0;
    await assert.rejects(loadCatalogueSource({
      loadBackendConfig: async () => ({ configured: true }),
      createCloudReader: () => ({ readPublished }),
      fetchImpl: async () => { staticCalls += 1; return { ok: true, text: async () => JSON.stringify(catalogue) }; },
    }));
    assert.equal(staticCalls, 0);
  }
});

test('invalid connection configuration does not silently enable the old catalogue', async () => {
  let readerCreated = false;
  let staticFetched = false;
  await assert.rejects(loadCatalogueSource({
    loadBackendConfig: async () => { throw new Error('A secret key is not a browser key.'); },
    createCloudReader: () => { readerCreated = true; },
    fetchImpl: () => { staticFetched = true; },
  }));
  assert.equal(readerCreated, false);
  assert.equal(staticFetched, false);
});

test('malformed public cloud responses are rejected before they reach visitors', async () => {
  await assert.rejects(loadCatalogueSource({
    loadBackendConfig: async () => ({ configured: true }),
    createCloudReader: () => ({ readPublished: async () => ({ ...catalogue, enquiries: [{ name: 'Private contact' }] }) }),
  }), /not valid/);
});

test('an aborted page load does not accept a late cloud response', async () => {
  const controller = new AbortController();
  await assert.rejects(loadCatalogueSource({
    signal: controller.signal,
    loadBackendConfig: async () => ({ configured: true }),
    createCloudReader: () => ({ readPublished: async () => { controller.abort(); return catalogue; } }),
  }), error => error.name === 'AbortError');
});

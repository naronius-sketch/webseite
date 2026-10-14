import { parsePublicConfig, validatePublicConfig } from './broker-model.js';

/** A connected catalogue must never silently fall back to old static offers. */
export async function loadCatalogueSource({
  loadBackendConfig, createCloudReader, fetchImpl = globalThis.fetch, base = '/', signal,
}) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const backend = await loadBackendConfig({ fetchImpl, url: `${base}admin-config.json`, signal });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (backend.configured) {
    const reader = await createCloudReader(backend);
    const published = await reader.readPublished();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!published) throw new Error('The live catalogue has not been published yet.');
    const result = validatePublicConfig(published);
    if (!result.valid) throw new Error('The live catalogue is not valid.');
    return { config: result.config, source: 'cloud' };
  }
  const response = await fetchImpl(`${base}site-config.json`, {
    cache: 'no-store', credentials: 'omit', signal,
  });
  if (!response.ok) throw new Error('The published catalogue could not be loaded.');
  const config = parsePublicConfig(await response.text());
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return { config, source: 'static' };
}

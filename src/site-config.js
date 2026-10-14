import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_BUSINESS, validatePublicConfig } from './broker-model.js';
import { loadBackendConfig } from './admin-config.js';
import { loadCatalogueSource } from './catalogue-source.js';

const fallbackConfig = {
  schemaVersion: 1,
  business: {
    ...DEFAULT_BUSINESS,
    name: 'Wangechi Realty',
    whatsapp: '+254142406452',
    email: 'wangechirealty@gmail.com',
    viewingPolicy: {
      ...DEFAULT_BUSINESS.viewingPolicy,
      enabled: false,
      mode: 'quote',
      fixedAmount: 1000,
    },
  },
  properties: [],
};

function resolveImage(path) {
  if (/^https:\/\//i.test(path)) return path;
  const base = import.meta.env.BASE_URL;
  if (base !== '/' && path.startsWith(base)) return path;
  return `${base}${path.replace(/^\//, '')}`;
}

export function useSiteConfig() {
  const [published, setPublished] = useState(fallbackConfig);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const { config } = await loadCatalogueSource({
          loadBackendConfig,
          createCloudReader: async backend => {
            const { createPublicCatalogueService } = await import('./admin-service.js');
            return createPublicCatalogueService(backend);
          },
          base: import.meta.env.BASE_URL, signal: controller.signal,
        });
        if (!controller.signal.aborted) { setPublished(config); setError(''); }
      } catch (problem) {
        if (!controller.signal.aborted && problem.name !== 'AbortError') {
          setPublished(fallbackConfig);
          setError('We could not load the current property collection. Please try again later or contact us for available homes.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, []);

  const rawConfig = preview || published;
  const properties = useMemo(() => rawConfig.properties.map(property => ({
    ...property,
    status: property.status || 'available',
    image: resolveImage(property.image),
    photos: (property.photos || []).map(resolveImage),
  })), [rawConfig]);

  function previewConfig(value) {
    const result = validatePublicConfig(value);
    if (!result.valid) throw new Error(result.errors.join(' '));
    setPreview(result.config);
  }

  function acceptPublished(value) {
    const result = validatePublicConfig(value);
    if (!result.valid) throw new Error(result.errors.join(' '));
    setPublished(result.config);
    setPreview(null);
    setError('');
  }

  return {
    business: rawConfig.business, properties, rawConfig,
    loading, error, previewing: Boolean(preview), previewConfig, acceptPublished,
    restorePublished: () => setPreview(null),
  };
}

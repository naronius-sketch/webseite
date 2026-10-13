import { useEffect, useMemo, useState } from 'react';
import { properties as sampleProperties } from './data.js';
import { DEFAULT_BUSINESS, parsePublicConfig, validatePublicConfig } from './broker-model.js';

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
  properties: sampleProperties.map(property => ({ ...property, status: 'available' })),
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
        const response = await fetch(`${import.meta.env.BASE_URL}site-config.json`, {
          cache: 'no-store', credentials: 'omit', signal: controller.signal,
        });
        if (!response.ok) throw new Error('The published catalogue could not be loaded.');
        const text = await response.text();
        if (text.length > 2_000_000) throw new Error('The catalogue file is too large.');
        const config = parsePublicConfig(text);
        if (!controller.signal.aborted) { setPublished(config); setError(''); }
      } catch (problem) {
        if (problem.name !== 'AbortError') setError('We could not refresh the catalogue. The sample collection is displayed.');
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

  return {
    business: rawConfig.business, properties, rawConfig,
    loading, error, previewing: Boolean(preview), previewConfig,
    restorePublished: () => setPreview(null),
  };
}

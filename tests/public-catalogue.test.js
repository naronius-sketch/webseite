import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePublicConfig, contactLinks } from '../src/broker-model.js';
import { getBackendConfig } from '../src/admin-config.js';

test('the deployed connection file contains validated public settings only', async () => {
  const input = JSON.parse(await readFile(new URL('../public/admin-config.json', import.meta.url), 'utf8'));
  assert.equal(input.schemaVersion, 1);
  for (const key of Object.keys(input)) assert.ok(['schemaVersion', 'supabaseUrl', 'publishableKey'].includes(key), 'Do not publish credentials or private fields.');
  const config = getBackendConfig(input);
  assert.equal(typeof config.configured, 'boolean');
});

test('the actual published catalogue is valid and supplies a usable contact destination', async () => {
  const config = parsePublicConfig(await readFile(new URL('../public/site-config.json', import.meta.url), 'utf8'));
  assert.ok(config.business.name.trim());
  const contacts = contactLinks(config.business);
  assert.ok(contacts.whatsapp || contacts.email, 'Provide WhatsApp or email before publishing enquiries.');
});

test('repository photographs referenced by the published catalogue actually exist', async () => {
  const config = parsePublicConfig(await readFile(new URL('../public/site-config.json', import.meta.url), 'utf8'));
  const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
  for (const property of config.properties) {
    for (const image of [property.image, ...(property.photos || [])]) {
      if (/^https:\/\//i.test(image)) continue;
      const pathname = new URL(image, 'https://naronius-sketch.github.io').pathname;
      const relative = decodeURIComponent(pathname).replace(/^\/webseite\//, '/').replace(/^\//, '');
      const path = resolve(publicRoot, relative);
      assert.ok(path.startsWith(publicRoot.endsWith(sep) ? publicRoot : publicRoot + sep), 'Image must stay inside public/.');
      await access(path).catch(() => assert.fail(`Missing public photo: ${image}`));
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BUSINESS, STATUS_OPTIONS, LEAD_STATUSES, normalizePhone, safeContactEmail,
  contactLinks, isPublicImageUrl, validatePublicConfig, parsePublicConfig,
  getViewingFeeQuote, buildViewingMessage } from '../src/broker-model.js';

const listing = (extra = {}) => ({ id: 1, title: 'Nairobi apartment', location: 'Westlands, Nairobi',
  city: 'Nairobi', category: 'Apartment', purpose: 'rent', price: 80000, beds: 2, baths: 1,
  area: 90, image: '/webseite/images/property-1.jpg', tag: 'Featured', description: 'Bright apartment.',
  amenities: ['Parking'], demo: true, ...extra });
const config = (extra = {}) => ({ schemaVersion: 1, business: {}, properties: [listing()], ...extra });

test('defaults do not invent contacts or a zero viewing fee', () => {
  assert.equal(DEFAULT_BUSINESS.whatsapp, '');
  assert.equal(DEFAULT_BUSINESS.viewingPolicy.enabled, false);
  assert.equal(getViewingFeeQuote().amount, null);
  assert.deepEqual(STATUS_OPTIONS, ['available', 'reserved', 'sold', 'let']);
  assert.deepEqual(LEAD_STATUSES, ['new', 'contacted', 'viewing', 'closed']);
});

test('phone normalization requires an international destination and rejects injection', () => {
  assert.equal(normalizePhone('+254 (712) 345-678'), '254712345678');
  for (const value of ['0712345678', '254712345678', '+012345678', '+1234567', '+1234567890123456', '+254712345678?text=evil', 'javascript:alert(1)', null]) {
    assert.equal(normalizePhone(value), '');
  }
});

test('email validation rejects headers, unsafe schemes and malformed addresses', () => {
  assert.equal(safeContactEmail(' agent@EXAMPLE.com '), 'agent@example.com');
  for (const value of ['agent@example.com\r\nBcc:evil@example.com', 'mailto:agent@example.com', 'a@@example.com', '.a@example.com', 'a..b@example.com', 'a@localhost']) assert.equal(safeContactEmail(value), '');
});

test('contact links encode messages and never create missing destinations', () => {
  const message = 'Hello & where?\nCost + timing';
  const links = contactLinks({ whatsapp: '+254712345678', email: 'agent@example.com' }, message);
  assert.equal(new URL(links.whatsapp).searchParams.get('text'), message);
  assert.equal(new URL(links.email).searchParams.get('body'), message);
  assert.equal(links.tel, 'tel:+254712345678');
  assert.deepEqual(contactLinks({ whatsapp: 'https://evil.test', email: 'bad' }), { whatsapp: '', email: '', tel: '' });
});

test('public configuration preserves fields, licensing and demo provenance without mutation', () => {
  const source = config({ properties: [listing({ photoCredit: 'Photographer', photoLicense: 'Licensed for marketing',
    photoSource: 'https://example.com/photo', photoRightsConfirmed: false })] });
  const before = JSON.stringify(source);
  const normalized = parsePublicConfig(before);
  assert.equal(normalized.properties[0].status, 'available');
  assert.equal(normalized.properties[0].demo, true);
  assert.equal(normalized.properties[0].photoRightsConfirmed, false);
  assert.equal(normalized.properties[0].photoCredit, 'Photographer');
  assert.equal(normalized.properties[0].price, 80000);
  assert.equal(JSON.stringify(source), before);
  assert.notEqual(normalized.properties[0].amenities, source.properties[0].amenities);
});

test('string IDs work and string/number duplicates cannot refer to different listings', () => {
  assert.equal(validatePublicConfig(config({ properties: [listing({ id: 'westlands-01' })] })).valid, true);
  assert.equal(validatePublicConfig(config({ properties: [listing(), listing({ id: '1' })] })).valid, false);
});

test('malformed prices, measures, statuses and schemas are rejected', () => {
  for (const patch of [{ price: -1 }, { price: 0 }, { price: Infinity }, { price: '80000' }, { beds: 1.5 },
    { baths: 101 }, { area: 0 }, { status: 'hidden' }, { purpose: 'auction' }, { id: '' }]) {
    const result = validatePublicConfig(config({ properties: [listing(patch)] }));
    assert.equal(result.valid, false, JSON.stringify(patch));
    assert.equal(result.config, null);
    assert.ok(result.errors.length);
  }
  assert.equal(validatePublicConfig(config({ schemaVersion: 2 })).valid, false);
});

test('completed status matches the transaction while reserved works for sale and rent', () => {
  for (const patch of [{ purpose: 'rent', status: 'sold' }, { purpose: 'buy', status: 'let' }]) {
    assert.equal(validatePublicConfig(config({ properties: [listing(patch)] })).valid, false);
  }
  for (const patch of [{ purpose: 'buy', status: 'sold' }, { purpose: 'rent', status: 'let' },
    { purpose: 'buy', status: 'reserved' }, { purpose: 'rent', status: 'reserved' }]) {
    assert.equal(validatePublicConfig(config({ properties: [listing(patch)] })).valid, true);
  }
});

test('real listings require an explicit acknowledgement of photo publishing permission', () => {
  for (const patch of [{ demo: false }, { demo: false, photoRightsConfirmed: false },
    { demo: false, photoRightsConfirmed: 'true' }]) {
    assert.equal(validatePublicConfig(config({ properties: [listing(patch)] })).valid, false);
  }
  assert.equal(validatePublicConfig(config({ properties: [listing({ demo: false, photoRightsConfirmed: true })] })).valid, true);
  assert.equal(validatePublicConfig(config({ properties: [listing({ demo: true, photoRightsConfirmed: false })] })).valid, true);
});

test('private leads, account credentials and prototype pollution cannot enter a public export', () => {
  for (const source of [config({ leads: [{ email: 'private@example.com' }] }),
    config({ business: { apiKey: 'not-a-real-key' } }),
    config({ properties: [listing({ ownerPhone: '+254712345678' })] }),
    JSON.parse('{"properties":[],"business":{"__proto__":{"polluted":true}}}')]) {
    assert.equal(validatePublicConfig(source).valid, false);
  }
  assert.equal({}.polluted, undefined);
  assert.throws(() => parsePublicConfig('{"properties":[],"constructor":{}}'), /unsafe field/);
  assert.throws(() => parsePublicConfig('{broken'), /not valid JSON/);
});

test('public image validation accepts durable HTTPS and repository assets only', () => {
  assert.equal(isPublicImageUrl('https://images.example.com/house.jpg'), true);
  assert.equal(isPublicImageUrl('/webseite/images/house.jpg'), true);
  for (const image of ['data:image/png;base64,AAA', 'blob:https://example.com/uuid', 'javascript:alert(1)',
    '//evil.test/photo.jpg', 'http://example.com/image.jpg', 'https://user:pass@example.com/a.jpg',
    'https://localhost/a.jpg', 'https://127.0.0.1/a.jpg', 'https://192.168.1.1/a.jpg', '/\\evil.test/a.jpg']) {
    assert.equal(isPublicImageUrl(image), false, image);
    assert.equal(validatePublicConfig(config({ properties: [listing({ image })] })).valid, false);
  }
});

test('unconfigured and unquoted costs never become a free or payable numeric quote', () => {
  const disabled = getViewingFeeQuote({ enabled: false, mode: 'fixed', fixedAmount: 500 });
  assert.equal(disabled.kind, 'disabled');
  assert.equal(disabled.amount, null);
  const quote = getViewingFeeQuote({ enabled: true, mode: 'quote' });
  assert.equal(quote.kind, 'quote');
  assert.equal(quote.amount, null);
  assert.equal(quote.requiresAcceptance, false);
  for (const amount of [undefined, null, 0, -100, NaN, Infinity, '500']) {
    assert.equal(getViewingFeeQuote({ enabled: true, mode: 'fixed', fixedAmount: amount }).kind, 'quote');
  }
});

test('an enabled fixed policy must contain a positive quote; valid quotes require acceptance', () => {
  assert.equal(validatePublicConfig(config({ business: { viewingPolicy: { enabled: true, mode: 'fixed' } } })).valid, false);
  const fee = getViewingFeeQuote({ enabled: true, mode: 'fixed', fixedAmount: 750, creditOnCompletion: true });
  assert.equal(fee.amount, 750);
  assert.equal(fee.currency, 'KES');
  assert.equal(fee.requiresAcceptance, true);
  assert.match(fee.detail, /Only pay after the agent confirms availability/);
  assert.match(fee.detail, /Credited/);
  assert.match(fee.detail, /refunded to you if you owe no agency fee/);
  assert.match(buildViewingMessage({ property: listing(), feeQuote: fee, form: { feeAccepted: true } }), /refunded to you if you owe no agency fee/);
});

test('viewing message names Kenya time, currency and pending status without claiming payment or booking', () => {
  const fee = getViewingFeeQuote({ enabled: true, mode: 'fixed', fixedAmount: 500 });
  const message = buildViewingMessage({ property: listing(), feeQuote: fee,
    form: { name: 'Grace', date: '2026-10-20', time: '10:00', feeAccepted: true } });
  assert.match(message, /Africa\/Nairobi \(EAT, UTC\+03:00\)/);
  assert.match(message, /KSh 500 \(KES\)/);
  assert.match(message, /awaiting agent confirmation/);
  assert.match(message, /I agree to the displayed transport contribution/);
  assert.match(message, /not a confirmed appointment/);
  assert.match(buildViewingMessage({ property: listing(), feeQuote: fee, form: { feeAccepted: 'true' } }), /not yet accepted/);
});

test('unquoted message requests costs and never falsely displays KSh 0', () => {
  const message = buildViewingMessage({ property: listing(), feeQuote: getViewingFeeQuote({ enabled: true, mode: 'quote' }) });
  assert.match(message, /Please quote any transport contribution/);
  assert.doesNotMatch(message, /KSh 0|free viewing|booking confirmed/i);
});

test('disabled policy still asks the agent to agree transport costs without implying a free viewing', () => {
  const message = buildViewingMessage({ property: listing(), feeQuote: getViewingFeeQuote({ enabled: false, fixedAmount: 1000 }) });
  assert.match(message, /Please agree any transport contribution before confirming the appointment/);
  assert.doesNotMatch(message, /KSh 0|free viewing|KSh 1,000/);
});

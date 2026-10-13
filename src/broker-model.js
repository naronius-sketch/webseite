/** Public, portable brokerage configuration. Private enquiry data is never part of it. */
export const STATUS_OPTIONS = Object.freeze(['available', 'reserved', 'sold', 'let']);
export const LEAD_STATUSES = Object.freeze(['new', 'contacted', 'viewing', 'closed']);
export const DEFAULT_BUSINESS = Object.freeze({
  name: 'Makao', agentName: '', whatsapp: '', email: '', serviceArea: 'Kenya',
  viewingPolicy: Object.freeze({
    mode: 'quote', fixedAmount: null, creditOnCompletion: true,
    cancellationHours: 24, enabled: false,
  }),
});

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

/** Require an explicit international prefix; return digits suitable for wa.me, or ''. */
export function normalizePhone(value) {
  if (typeof value !== 'string') return '';
  const phone = value.trim();
  if (!/^\+[1-9][\d\s()-]*$/.test(phone)) return '';
  const digits = phone.replace(/\D/g, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
}

/** Conservative email validation: rejects injected headers, URLs and display names. */
export function safeContactEmail(value) {
  if (typeof value !== 'string') return '';
  const email = value.trim();
  if (email.length > 254 || /[\s\r\n\u0000-\u001f\u007f]/.test(email)) return '';
  const parts = email.split('@');
  if (parts.length !== 2 || parts[0].length > 64) return '';
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0])
    || parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..')) return '';
  if (!/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(parts[1])) return '';
  return `${parts[0]}@${parts[1].toLowerCase()}`;
}

/** Invalid or missing destinations remain empty; every message is URL encoded. */
export function contactLinks(business = {}, message = '') {
  const phone = normalizePhone(business?.whatsapp);
  const email = safeContactEmail(business?.email);
  const body = encodeURIComponent(String(message ?? ''));
  return {
    whatsapp: phone ? `https://wa.me/${phone}?text=${body}` : '',
    tel: phone ? `tel:+${phone}` : '',
    email: email ? `mailto:${encodeURIComponent(email)}?subject=Property%20enquiry&body=${body}` : '',
  };
}

function rejectUnsafeData(value, errors, path = 'config', depth = 0) {
  if (depth > 20) { errors.push(`${path}: nested data is too deep.`); return; }
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!Array.isArray(value) && !isRecord(value)) { errors.push(`${path}: use plain JSON values.`); return; }
  for (const key of Object.keys(value)) {
    if (forbidden.has(key)) errors.push(`${path}: unsafe field ${key}.`);
    else rejectUnsafeData(value[key], errors, `${path}.${key}`, depth + 1);
  }
}

function allowFields(object, fields, errors, path) {
  for (const key of Object.keys(object)) {
    if (!fields.includes(key)) errors.push(`${path}.${key}: not a public configuration field.`);
  }
}

function textField(object, key, fallback, max, errors, path, required = false) {
  const value = has(object, key) ? object[key] : fallback;
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    errors.push(`${path}.${key}: expected text of at most ${max} characters.`);
    return fallback;
  }
  if (required && !value.trim()) errors.push(`${path}.${key}: is required.`);
  return value.trim();
}

function numericField(object, key, fallback, max, errors, path, integer = false, minimum = 0) {
  const value = has(object, key) ? object[key] : fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > max
    || (integer && !Number.isSafeInteger(value))) {
    errors.push(`${path}.${key}: expected ${integer ? 'an integer' : 'a number'} from ${minimum} to ${max}.`);
    return fallback;
  }
  return value;
}

function booleanField(object, key, fallback, errors, path) {
  const value = has(object, key) ? object[key] : fallback;
  if (typeof value !== 'boolean') { errors.push(`${path}.${key}: expected true or false.`); return fallback; }
  return value;
}

/** Public image addresses only; temporary blob/data URLs cannot survive publication. */
export function isPublicImageUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
      || host.endsWith('.internal') || host.startsWith('[')) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
    }
    return host.includes('.');
  } catch { return false; }
}

function normalizeBusiness(input, errors) {
  const path = 'business';
  const business = isRecord(input) ? input : {};
  if (input !== undefined && !isRecord(input)) errors.push('business: expected an object.');
  allowFields(business, Object.keys(DEFAULT_BUSINESS), errors, path);
  const normalized = {};
  for (const [key, max] of [['name', 100], ['agentName', 100], ['whatsapp', 50], ['email', 254], ['serviceArea', 200]]) {
    normalized[key] = textField(business, key, DEFAULT_BUSINESS[key], max, errors, path, key === 'name');
  }
  if (normalized.whatsapp && !normalizePhone(normalized.whatsapp)) errors.push('business.whatsapp: use + followed by an international phone number (8–15 digits).');
  if (normalized.email && !safeContactEmail(normalized.email)) errors.push('business.email: use a valid email address.');
  const supplied = business.viewingPolicy;
  const policy = isRecord(supplied) ? supplied : {};
  if (supplied !== undefined && !isRecord(supplied)) errors.push('business.viewingPolicy: expected an object.');
  allowFields(policy, Object.keys(DEFAULT_BUSINESS.viewingPolicy), errors, 'business.viewingPolicy');
  const mode = policy.mode ?? 'quote';
  if (!['quote', 'fixed'].includes(mode)) errors.push('business.viewingPolicy.mode: choose quote or fixed.');
  const enabled = booleanField(policy, 'enabled', false, errors, 'business.viewingPolicy');
  const fixedAmount = policy.fixedAmount == null ? null
    : numericField(policy, 'fixedAmount', null, 1000000, errors, 'business.viewingPolicy', false, 1);
  if (enabled && mode === 'fixed' && fixedAmount === null) errors.push('business.viewingPolicy.fixedAmount: a positive quoted cost is required for a fixed policy.');
  normalized.viewingPolicy = {
    mode, fixedAmount, enabled,
    creditOnCompletion: booleanField(policy, 'creditOnCompletion', true, errors, 'business.viewingPolicy'),
    cancellationHours: numericField(policy, 'cancellationHours', 24, 168, errors, 'business.viewingPolicy', true),
  };
  return normalized;
}

const propertyFields = ['id', 'title', 'location', 'city', 'category', 'purpose', 'price', 'beds', 'baths', 'area',
  'image', 'tag', 'description', 'amenities', 'demo', 'status', 'photos',
  'photoCredit', 'photoLicense', 'photoSource', 'photoRightsConfirmed'];

function normalizeProperty(input, errors, index) {
  const path = `properties[${index}]`;
  if (!isRecord(input)) { errors.push(`${path}: expected an object.`); return null; }
  allowFields(input, propertyFields, errors, path);
  const property = {};
  property.id = input.id;
  if (!(typeof input.id === 'string' && input.id.trim() && input.id.length <= 100)
    && !(Number.isSafeInteger(input.id) && input.id >= 0)) errors.push(`${path}.id: expected a nonempty string or a nonnegative safe integer.`);
  for (const [key, max] of [['title', 200], ['location', 200], ['city', 100], ['category', 100], ['description', 10000]]) {
    property[key] = textField(input, key, '', max, errors, path, true);
  }
  if (!['buy', 'rent'].includes(input.purpose)) errors.push(`${path}.purpose: choose buy or rent.`);
  property.purpose = input.purpose;
  property.price = numericField(input, 'price', 0, 1000000000000, errors, path, false, 1);
  property.beds = numericField(input, 'beds', 0, 100, errors, path, true);
  property.baths = numericField(input, 'baths', 0, 100, errors, path, true);
  property.area = numericField(input, 'area', 0, 100000000, errors, path, false, 1);
  property.image = input.image;
  if (!isPublicImageUrl(input.image)) errors.push(`${path}.image: use a public HTTPS URL or a root-relative asset path.`);
  property.status = input.status ?? 'available';
  if (!STATUS_OPTIONS.includes(property.status)) errors.push(`${path}.status: choose ${STATUS_OPTIONS.join(', ')}.`);
  if (property.status === 'sold' && property.purpose !== 'buy') errors.push(`${path}.status: sold applies only to properties offered for sale.`);
  if (property.status === 'let' && property.purpose !== 'rent') errors.push(`${path}.status: let applies only to properties offered for rent.`);
  property.tag = textField(input, 'tag', '', 100, errors, path);
  property.demo = booleanField(input, 'demo', false, errors, path);
  property.amenities = input.amenities ?? [];
  if (!Array.isArray(property.amenities) || property.amenities.length > 100
    || property.amenities.some(item => typeof item !== 'string' || !item.trim() || item.length > 200)) errors.push(`${path}.amenities: expected up to 100 short text values.`);
  else property.amenities = property.amenities.map(item => item.trim());
  if (has(input, 'photos')) {
    property.photos = input.photos;
    if (!Array.isArray(input.photos) || input.photos.length > 50 || input.photos.some(item => !isPublicImageUrl(item))) errors.push(`${path}.photos: expected up to 50 public image addresses.`);
    else property.photos = [...input.photos];
  }
  for (const key of ['photoCredit', 'photoLicense', 'photoSource']) {
    if (has(input, key)) property[key] = textField(input, key, '', 2000, errors, path);
  }
  if (has(input, 'photoRightsConfirmed')) property.photoRightsConfirmed = booleanField(input, 'photoRightsConfirmed', false, errors, path);
  if (!property.demo && property.photoRightsConfirmed !== true) errors.push(`${path}.photoRightsConfirmed: confirm permission to publish the photos before publishing a real listing.`);
  return property;
}

/**
 * Never throws for ordinary invalid input. Returns {valid, errors, config}; config is
 * null on failure and a fresh normalized schemaVersion:1 object on success. Unknown
 * fields are rejected so exporting public configuration cannot silently publish leads.
 */
export function validatePublicConfig(input) {
  const errors = [];
  if (!isRecord(input)) return { valid: false, errors: ['config: expected an object.'], config: null };
  rejectUnsafeData(input, errors);
  if (errors.length) return { valid: false, errors, config: null };
  allowFields(input, ['schemaVersion', 'business', 'properties'], errors, 'config');
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) errors.push('schemaVersion: only version 1 is supported.');
  const business = normalizeBusiness(input.business, errors);
  let properties = [];
  if (!Array.isArray(input.properties) || input.properties.length > 2000) errors.push('properties: expected an array of at most 2000 listings.');
  else {
    properties = input.properties.map((property, index) => normalizeProperty(property, errors, index));
    const identifiers = properties.filter(Boolean).map(property => String(property.id));
    if (new Set(identifiers).size !== identifiers.length) errors.push('properties: listing IDs must be unique, including string/number equivalents.');
  }
  return { valid: errors.length === 0, errors, config: errors.length ? null : { schemaVersion: 1, business, properties } };
}

/** Parse a public JSON file; throw TypeError with diagnostics rather than accepting partial data. */
export function parsePublicConfig(json) {
  if (typeof json !== 'string' || json.length > 2000000) throw new TypeError('Public configuration must be JSON text of at most 2 MB.');
  let input;
  try { input = JSON.parse(json); } catch { throw new TypeError('Public configuration is not valid JSON.'); }
  const result = validatePublicConfig(input);
  if (!result.valid) throw new TypeError(result.errors.join('\n'));
  return result.config;
}

/** Does not create a charge or a booking. Unknown quotes deliberately have no numeric amount. */
export function getViewingFeeQuote(policy = {}) {
  if (!isRecord(policy)) policy = {};
  const common = { currency: 'KES', creditOnCompletion: policy.creditOnCompletion === true,
    cancellationHours: Number.isInteger(policy.cancellationHours) ? policy.cancellationHours : 24 };
  if (policy.enabled !== true) return { ...common, kind: 'disabled', mode: 'disabled', amount: null,
    requiresAcceptance: false, label: 'Transport contribution agreed in advance',
    detail: 'The agent will agree any transport contribution with you before confirming the appointment. No payment is collected through this website. This is a request; availability and the appointment must be confirmed by the agent.' };
  if (policy.mode !== 'fixed' || typeof policy.fixedAmount !== 'number' || !Number.isFinite(policy.fixedAmount) || policy.fixedAmount <= 0) {
    return { ...common, kind: 'quote', mode: 'quote', amount: null, requiresAcceptance: false,
      label: 'Transport contribution quoted in advance',
      detail: 'The agent will quote any transport contribution before you agree to a viewing. Only pay after the agent confirms availability and you agree to the terms. A request or payment alone does not confirm a booking.' };
  }
  const amount = policy.fixedAmount;
  const credit = common.creditOnCompletion ? ' Credited against your agreed agency fee, or refunded to you if you owe no agency fee, when this transaction completes.' : '';
  return { ...common, kind: 'fixed', mode: 'fixed', amount, requiresAcceptance: true,
    label: `KSh ${new Intl.NumberFormat('en-KE', { maximumFractionDigits: 2 }).format(amount)} transport contribution`,
    detail: `Agree to this cost before the appointment is confirmed. Only pay after the agent confirms availability.${credit} Ask the agent about cancellation and refund terms before paying. A request or payment alone does not confirm a booking.` };
}

const lineText = value => String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim();

/** Plain-text enquiry for WhatsApp/email; a preferred time is never represented as booked. */
export function buildViewingMessage({ property = {}, form = {}, feeQuote = getViewingFeeQuote() } = {}) {
  const date = lineText(form.date ?? form.preferredDate);
  const time = lineText(form.time ?? form.preferredTime);
  const lines = [
    'Viewing request — awaiting agent confirmation',
    `Property: ${lineText(property.title)} (reference ${lineText(property.id)})`,
    `Location: ${lineText(property.location)}`,
    `Name: ${lineText(form.name)}`,
  ];
  if (form.email) lines.push(`Email: ${lineText(form.email)}`);
  if (form.phone) lines.push(`Phone: ${lineText(form.phone)}`);
  if (form.purpose) lines.push(`Looking to: ${lineText(form.purpose)}`);
  if (form.budget) lines.push(`Budget: ${lineText(form.budget)} (KES)`);
  if (form.moveInDate) lines.push(`Preferred move-in date: ${lineText(form.moveInDate)}`);
  if (date || time) lines.push(`Preferred appointment: ${date || 'date to agree'} ${time || '(time to agree)'} — Africa/Nairobi (EAT, UTC+03:00)`);
  else lines.push('Preferred appointment: to agree — Africa/Nairobi (EAT, UTC+03:00)');
  if (feeQuote.kind === 'fixed' && Number.isFinite(feeQuote.amount) && feeQuote.amount > 0) {
    lines.push(`Quoted transport contribution: KSh ${new Intl.NumberFormat('en-KE', { maximumFractionDigits: 2 }).format(feeQuote.amount)} (KES).`);
    lines.push(form.feeAccepted === true
      ? 'Cost acceptance: I agree to the displayed transport contribution and terms, subject to availability confirmation.'
      : 'Cost acceptance: not yet accepted; please agree the cost before confirming.');
    if (feeQuote.creditOnCompletion) lines.push('Credited against your agreed agency fee, or refunded to you if you owe no agency fee, when this transaction completes.');
  } else if (feeQuote.kind === 'quote') lines.push('Please quote any transport contribution and cancellation/refund terms before I agree to an appointment.');
  else lines.push('Please agree any transport contribution before confirming the appointment.');
  if (form.message) lines.push(`Message: ${String(form.message).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()}`);
  lines.push('This is a viewing request, not a confirmed appointment. Only pay after availability is confirmed and the terms are agreed.');
  return lines.join('\n');
}

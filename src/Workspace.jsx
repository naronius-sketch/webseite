import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronRight, ClipboardList, Home, Plus, Save, Settings, Trash2, X } from 'lucide-react';
import { DEFAULT_BUSINESS, validatePublicConfig, parsePublicConfig, isPublicImageUrl } from './broker-model.js';
import './workspace.css';

export const PUBLIC_DRAFT_KEY = 'makao-broker-public-draft-v1';
export const PRIVATE_ENQUIRIES_KEY = 'makao-broker-private-enquiries-v1';
const copy = value => JSON.parse(JSON.stringify(value));
const amount = value => new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 }).format(Number(value) || 0);
const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const safeImage = isPublicImageUrl;
// Adapt portable public asset paths only for display; downloads retain their raw paths.
function workspaceImageUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return value;
  const base = import.meta.env.BASE_URL || '/';
  if (base === '/' || value.startsWith(base) || value === base.replace(/\/$/, '')) return value;
  return `${base}${value.slice(1)}`;
}
const emptyListing = () => ({ title: '', location: '', city: 'Nairobi', category: 'Apartment', purpose: 'rent', price: '', beds: 0, baths: 0, area: '', image: '', description: '', amenities: [], status: 'available', demo: false, photoRightsConfirmed: false });
const emptyLead = () => ({ name: '', email: '', phone: '', propertyId: '', status: 'new', budget: '', viewingDate: '', notes: '', uberCost: '', commission: '', viewingCount: 0 });

function download(value, filename) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function draftHasSafeShape(candidate) {
  if (!candidate || candidate.schemaVersion !== 1 || !candidate.business || Array.isArray(candidate.business) || !Array.isArray(candidate.properties) || candidate.properties.length > 2000) return false;
  if (Object.keys(candidate).some(key => !['schemaVersion', 'business', 'properties'].includes(key))) return false;
  for (const key of ['name', 'agentName', 'whatsapp', 'email', 'serviceArea']) if (candidate.business[key] != null && typeof candidate.business[key] !== 'string') return false;
  const policy = candidate.business.viewingPolicy;
  if (policy && (typeof policy !== 'object' || Array.isArray(policy))) return false;
  if (policy) {
    if (policy.mode != null && !['quote', 'fixed'].includes(policy.mode)) return false;
    for (const key of ['enabled', 'creditOnCompletion']) if (policy[key] != null && typeof policy[key] !== 'boolean') return false;
    if (policy.fixedAmount != null && (typeof policy.fixedAmount !== 'number' || !Number.isFinite(policy.fixedAmount))) return false;
    if (policy.cancellationHours != null && policy.cancellationHours !== '' && (typeof policy.cancellationHours !== 'number' || !Number.isFinite(policy.cancellationHours))) return false;
  }
  const stripped = candidate.properties.map(property => property && typeof property === 'object' ? { ...property, demo: true, photoRightsConfirmed: true } : property);
  return validatePublicConfig({ schemaVersion: 1, business: DEFAULT_BUSINESS, properties: stripped }).valid;
}
function publicationErrors(candidate) {
  return candidate.properties.flatMap(property => {
    const errors = [];
    if (!property.demo && property.photoRightsConfirmed !== true) errors.push(`“${property.title}”: confirm permission to publish the photograph before exporting or previewing this real listing.`);
    if (property.status === 'sold' && property.purpose !== 'buy') errors.push(`“${property.title}”: Sold is only available for sale listings.`);
    if (property.status === 'let' && property.purpose !== 'rent') errors.push(`“${property.title}”: Let is only available for rental listings.`);
    return errors;
  });
}
function initialDraft(initialConfig) {
  try {
    const saved = JSON.parse(localStorage.getItem(PUBLIC_DRAFT_KEY) || 'null');
    if (saved?.schemaVersion === 1 && draftHasSafeShape(saved.config)) {
      return { config: copy(saved.config), broken: false, message: 'Your saved local draft is open. It may differ from the published website.' };
    }
    return { config: copy(initialConfig), broken: Boolean(saved), message: saved ? 'The stored draft could not be read. It has been preserved; save a new draft only when ready.' : '' };
  } catch {
    return { config: copy(initialConfig), broken: true, message: 'Local draft storage is unavailable or unreadable. Your changes still work for this session.' };
  }
}
function validateLead(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Each enquiry must be an object.');
  const keys = ['id', 'name', 'email', 'phone', 'propertyId', 'status', 'budget', 'viewingDate', 'notes', 'uberCost', 'commission', 'viewingCount'];
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error('The private file contains unsupported enquiry fields.');
  if (typeof input.id !== 'string' || !input.id.trim() || input.id.length > 100) throw new Error('Each private enquiry needs a stable, nonempty ID. Use an original Makao backup.');
  const result = { id: input.id.trim() };
  for (const field of ['name', 'email', 'phone', 'propertyId', 'viewingDate', 'notes']) {
    if (input[field] != null && typeof input[field] !== 'string' && !(field === 'propertyId' && typeof input[field] === 'number')) throw new Error(`Invalid ${field} in an enquiry.`);
    result[field] = String(input[field] ?? '').trim();
  }
  if (!result.name || result.name.length > 150) throw new Error('Enter an enquiry name (up to 150 characters).');
  if (result.notes.length > 4000) throw new Error('Notes must be under 4,000 characters.');
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error('Enter a valid enquiry email address.');
  if (result.viewingDate && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(result.viewingDate)) throw new Error('Enter a valid viewing date and time.');
  if (!['new', 'contacted', 'viewing', 'closed'].includes(input.status)) throw new Error('Choose a supported enquiry status.');
  result.status = input.status;
  for (const field of ['budget', 'uberCost', 'commission']) {
    const value = input[field];
    if (value === '' || value == null) result[field] = null;
    else if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`Enter a valid ${field} amount.`);
    else if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error('Financial amounts must be zero or greater.');
    else result[field] = Number(value);
  }
  if (input.viewingCount != null && typeof input.viewingCount !== 'string' && typeof input.viewingCount !== 'number') throw new Error('Enter a valid completed viewing count.');
  const viewings = Number(input.viewingCount ?? 0);
  if (!Number.isInteger(viewings) || viewings < 0 || viewings > 10000) throw new Error('Completed viewings must be a whole number, zero or greater.');
  result.viewingCount = viewings;
  return result;
}
/** Atomically merge private backups without duplicating costs or overwriting records. */
export function mergePrivateEnquiries(existing, incoming) {
  if (!Array.isArray(existing) || !Array.isArray(incoming) || existing.length > 2000 || incoming.length > 2000) throw new Error('Private backups support at most 2,000 enquiries.');
  const previous = existing.map(validateLead);
  const records = incoming.map(validateLead);
  const byId = new Map(previous.map(record => [record.id, record]));
  if (byId.size !== previous.length) throw new Error('Existing private enquiries contain duplicate IDs. Review your local records before importing.');
  const additions = [];
  let skipped = 0;
  for (const record of records) {
    const current = byId.get(record.id);
    if (current) {
      if (JSON.stringify(current) !== JSON.stringify(record)) {
        throw new Error(`Import stopped: enquiry “${record.name}” has the same ID as an existing record but different details. Review the backup and current record before importing. No enquiries were changed.`);
      }
      skipped += 1;
    } else {
      additions.push(record);
      byId.set(record.id, record);
    }
  }
  if (previous.length + additions.length > 2000) throw new Error('Import would exceed the 2,000-enquiry limit. No enquiries were changed.');
  return { enquiries: [...previous, ...additions], inserted: additions.length, skipped };
}
function initialLeads() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRIVATE_ENQUIRIES_KEY) || 'null');
    if (!saved) return { leads: [], message: '' };
    if (saved.kind !== 'makao-private-enquiries' || saved.schemaVersion !== 1 || !Array.isArray(saved.enquiries) || saved.enquiries.length > 2000) throw new Error();
    const leads = saved.enquiries.map(validateLead);
    if (new Set(leads.map(lead => lead.id)).size !== leads.length) throw new Error();
    return { leads, message: '' };
  } catch {
    return { leads: [], message: 'Stored private enquiries could not be read. They have been preserved. Import a valid backup before saving replacements.' };
  }
}
function Field({ label, children, hint }) {
  return <label className="ws-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function Errors({ errors }) {
  if (!errors.length) return null;
  return <div className="ws-error" role="alert"><strong>Please check these details</strong><ul>{errors.map((error, index) => <li key={index}>{typeof error === 'string' ? error : error.message || JSON.stringify(error)}</li>)}</ul></div>;
}

export default function Workspace({ initialConfig, onPreview, onClose }) {
  const [loaded] = useState(() => initialDraft(initialConfig));
  const [config, setConfig] = useState(loaded.config);
  const unreadDraft = useRef(loaded.broken);
  const [loadedPrivate] = useState(initialLeads);
  const unreadPrivate = useRef(Boolean(loadedPrivate.message));
  const [leads, setLeads] = useState(loadedPrivate.leads);
  const leadsRef = useRef(leads);
  leadsRef.current = leads;
  const [tab, setTab] = useState('listings');
  const [message, setMessage] = useState(loaded.message);
  const [errors, setErrors] = useState([]);
  const [listing, setListing] = useState(null);
  const [lead, setLead] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [leadsDirty, setLeadsDirty] = useState(false);
  const dialog = useRef(null);
  const listingTitle = useRef(null);
  const leadName = useRef(null);
  const publicInput = useRef(null);
  const privateInput = useRef(null);
  const business = config.business || DEFAULT_BUSINESS;
  const policy = business.viewingPolicy || DEFAULT_BUSINESS.viewingPolicy;

  useEffect(() => {
    const before = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; before?.focus?.(); };
  }, []);
  useEffect(() => { if (listing) listingTitle.current?.focus(); }, [listing?.id, listing === null]);
  useEffect(() => { if (lead) leadName.current?.focus(); }, [lead?.id, lead === null]);

  function close() {
    if ((dirty || leadsDirty || listing || lead) && !window.confirm('Close the workspace with unsaved changes? Finish any open form, then save your local draft and private enquiries to keep them for another session.')) return;
    onClose();
  }
  function keydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const focusable = Array.from(dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(element => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  function changeConfig(next) { setConfig(next); setDirty(true); setErrors([]); setMessage(''); }
  function changeBusiness(field, value) { changeConfig({ ...config, business: { ...business, [field]: value } }); }
  function changePolicy(field, value) { changeBusiness('viewingPolicy', { ...policy, [field]: value }); }
  function validConfig() {
    const result = validatePublicConfig(config);
    if (!result.valid) { setErrors(result.errors || ['The website configuration is not valid.']); return null; }
    const publicationFailures = publicationErrors(result.config || config);
    if (publicationFailures.length) { setErrors(publicationFailures); return null; }
    setErrors([]);
    return result.config || config;
  }
  function saveDraft() {
    try {
      if (unreadDraft.current && !window.confirm('The previous local draft could not be read. Replace it with the listings and business settings currently shown? Keep any backup first.')) return;
      localStorage.setItem(PUBLIC_DRAFT_KEY, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), config }));
      unreadDraft.current = false;
      setDirty(false);
      setMessage('Draft saved on this device. The public website has not changed.');
    } catch { setErrors(['This browser could not save the draft. Download the public website file as a backup when all details are valid.']); }
  }
  function preview() {
    const validated = validConfig();
    if (!validated) return;
    onPreview(copy(validated));
    setMessage('Local preview updated on this device. To change the public website, download and publish the website file below.');
  }
  function exportPublic() {
    const validated = validConfig();
    if (!validated) return;
    download(validated, 'site-config.json');
    setMessage('Public website file downloaded. It contains listings and business settings only. Replace public/site-config.json in GitHub and commit to publish.');
  }
  async function importPublic(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose a website file smaller than 2 MB.');
      const imported = parsePublicConfig(await file.text());
      const failures = publicationErrors(imported);
      if (failures.length) throw new Error(failures.join('\n'));
      if (!window.confirm('Replace the current listings and business settings with this file? Private enquiries remain on this device. This does not publish anything.')) return;
      changeConfig(copy(imported));
      setListing(null);
      setMessage('Website file imported into your local draft. Review it, then save or preview.');
    } catch (error) { setErrors([error.message || 'This is not a valid public website configuration.']); }
  }
  function resetDraft() {
    if (!window.confirm('Restore the currently loaded website listings and business settings? This replaces your local draft. Private enquiries are kept.')) return;
    const next = copy(initialConfig);
    try { localStorage.setItem(PUBLIC_DRAFT_KEY, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), config: next })); }
    catch { setErrors(['Could not save the restored draft on this device.']); return; }
    unreadDraft.current = false;
    setConfig(next); setDirty(false); setListing(null); setErrors([]);
    setMessage('Draft restored from the website configuration. Use Preview to see it locally.');
  }
  function saveListing(event) {
    event.preventDefault();
    const failures = [];
    const next = { ...listing, id: listing.id ?? Date.now(), title: listing.title.trim(), location: listing.location.trim(), city: listing.city.trim(), image: listing.image.trim(), description: listing.description.trim() };
    for (const field of ['title', 'location', 'city', 'description']) if (!next[field]) failures.push(`Enter the listing ${field}.`);
    if (!safeImage(next.image)) failures.push('Use an HTTPS photo URL or a root-relative public image path.');
    for (const field of ['price', 'area']) {
      if (next[field] === '' || !Number.isFinite(Number(next[field])) || Number(next[field]) < 1) failures.push(`${field === 'price' ? 'Price' : 'Area'} must be at least one.`);
      next[field] = Number(next[field]);
    }
    for (const field of ['beds', 'baths']) {
      if (next[field] === '' || !Number.isInteger(Number(next[field])) || Number(next[field]) < 0) failures.push(`${field === 'beds' ? 'Bedrooms' : 'Bathrooms'} must be a whole number, zero or greater.`);
      next[field] = Number(next[field]);
    }
    if (next.status === 'sold' && next.purpose !== 'buy') failures.push('Sold is only available for sale listings.');
    if (next.status === 'let' && next.purpose !== 'rent') failures.push('Let is only available for rental listings.');
    if (failures.length) { setErrors(failures); return; }
    next.amenities = Array.isArray(next.amenities) ? next.amenities : next.amenities.split(',').map(value => value.trim()).filter(Boolean);
    changeConfig({ ...config, properties: config.properties.some(item => item.id === next.id) ? config.properties.map(item => item.id === next.id ? next : item) : [...config.properties, next] });
    setListing(null);
    setMessage('Listing saved to your current draft. Save draft to keep it on this device.');
  }
  function deleteListing(property) {
    if (!window.confirm(`Remove “${property.title}” from your draft? This does not change the public website until you publish.`)) return;
    changeConfig({ ...config, properties: config.properties.filter(item => item.id !== property.id) });
    if (listing?.id === property.id) setListing(null);
  }
  function saveLead(event) {
    event.preventDefault();
    try {
      const next = validateLead({ ...lead, id: lead.id || newId() });
      setLeads(current => current.some(item => item.id === next.id) ? current.map(item => item.id === next.id ? next : item) : [...current, next]);
      setLeadsDirty(true); setLead(null); setErrors([]);
      setMessage('Enquiry added to this session. Save private enquiries to keep it on this device.');
    } catch (error) { setErrors([error.message]); }
  }
  function privateFile(enquiries = leads) { return { kind: 'makao-private-enquiries', schemaVersion: 1, exportedAt: new Date().toISOString(), enquiries }; }
  function savePrivate() {
    try {
      if (unreadPrivate.current && !window.confirm('The previous stored private file could not be read. Replace it with the enquiries currently shown? Keep any backup first.')) return;
      localStorage.setItem(PRIVATE_ENQUIRIES_KEY, JSON.stringify(privateFile()));
      unreadPrivate.current = false;
      setLeadsDirty(false); setErrors([]); setMessage('Private enquiries saved on this device. They are never included in the public website file.');
    } catch { setErrors(['This browser could not save the private enquiries. Download a private backup to keep your work.']); }
  }
  async function importPrivate(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose a private file smaller than 2 MB.');
      const imported = JSON.parse(await file.text());
      if (imported.kind !== 'makao-private-enquiries' || imported.schemaVersion !== 1 || !Array.isArray(imported.enquiries) || imported.enquiries.length > 2000) throw new Error('Choose a Makao private enquiries backup. Public website files cannot be imported here.');
      const merged = mergePrivateEnquiries(leadsRef.current, imported.enquiries);
      if (!merged.inserted) {
        setErrors([]);
        setMessage(`Private backup checked: 0 inserted, ${merged.skipped} unchanged enquiries skipped. Existing records and totals are unchanged.`);
        return;
      }
      if (!window.confirm(`Add ${merged.inserted} new private enquiries to this device? ${merged.skipped} unchanged enquiries will be skipped. Existing enquiries will be kept. Keep this file private; do not upload it to GitHub.`)) return;
      setLeads(merged.enquiries); setLeadsDirty(true); setErrors([]);
      setMessage(`Private enquiries imported: ${merged.inserted} inserted, ${merged.skipped} unchanged enquiries skipped. Review and save them on this device.`);
    } catch (error) { setErrors([error.message || 'The private backup could not be read.']); }
  }
  function deleteLead(item) {
    if (!window.confirm(`Delete the private enquiry for ${item.name}?`)) return;
    setLeads(leads.filter(value => value.id !== item.id)); setLeadsDirty(true);
    if (lead?.id === item.id) setLead(null);
  }
  const listingChange = (field, value) => setListing(current => ({ ...current, [field]: value }));
  const leadChange = (field, value) => setLead(current => ({ ...current, [field]: value }));
  const travelTotal = leads.reduce((total, item) => total + (Number(item.uberCost) || 0), 0);
  const viewingTotal = leads.reduce((total, item) => total + (Number(item.viewingCount) || 0), 0);
  const closedCount = leads.filter(item => item.status === 'closed').length;
  const commissionTotal = leads.filter(item => item.status === 'closed').reduce((total, item) => total + (Number(item.commission) || 0), 0);

  return <div className="ws-backdrop"><section className="ws-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="ws-title" tabIndex={-1} onKeyDown={keydown}>
    <header className="ws-header"><div><span className="ws-eyebrow">{business.name || 'MAKAO'} · LOCAL WORKSPACE</span><h2 id="ws-title">Make room for your next sale.</h2><p>Manage your listings, follow up with people, and plan your viewing costs.</p></div><button className="ws-icon-button" aria-label="Close workspace" onClick={close}><X size={22} /></button></header>
    <div className="ws-local-note"><span className="ws-local-dot" />Saved on this device · No shared account or inbox<p>This is a local working copy. Visitors’ website enquiries do not appear here automatically. Anyone using this browser can access saved data.</p></div>
    <nav className="ws-tabs" aria-label="Workspace sections">{[['listings', Home, 'Listings'], ['enquiries', ClipboardList, 'Enquiries'], ['business', Settings, 'Business settings']].map(([key, Icon, label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'active' : ''} onClick={() => { setTab(key); setErrors([]); setMessage(''); }}><Icon size={18} />{label}<span>{key === 'listings' ? config.properties.length : key === 'enquiries' ? leads.length : ''}</span></button>)}</nav>
    <div className="ws-body">
      {message && <div className="ws-success" role="status"><Check size={18} /><span>{message}</span></div>}
      <Errors errors={errors} />
      {tab === 'listings' && <>
        <div className="ws-section-title"><div><h3>Your property collection</h3><p>Keep availability current. Real listings need permission to use their photographs before publication.</p></div><button className="ws-primary" onClick={() => { setListing(emptyListing()); setErrors([]); }}><Plus size={17} />Add listing</button></div>
        <div className={`ws-listing-layout ${listing ? 'has-editor' : ''}`}><div className="ws-listing-grid">{config.properties.map(property => <article className="ws-property" key={property.id}><div className="ws-property-photo">{safeImage(property.image) ? <img src={workspaceImageUrl(property.image)} alt="" /> : <Home size={32} />}<span className={`ws-status ws-status-${property.status || 'available'}`}>{property.status || 'available'}</span></div><div className="ws-property-content"><span className="ws-property-location">{property.location}</span><h4>{property.title}</h4><p>KSh {amount(property.price)}{property.purpose === 'rent' ? ' / month' : ''}</p><div className="ws-property-actions"><span>{property.demo ? 'Demo listing' : 'Real listing'}</span><button onClick={() => { setListing(copy(property)); setErrors([]); }}>Edit<ChevronRight size={15} /></button><button className="ws-icon-button" aria-label={`Delete ${property.title}`} onClick={() => deleteListing(property)}><Trash2 size={16} /></button></div></div></article>)}{!config.properties.length && <div className="ws-empty"><Home size={28} /><h4>A fresh start.</h4><p>Add your first property to create your collection.</p></div>}</div>
        {listing && <form className="ws-editor" onSubmit={saveListing}><div className="ws-editor-heading"><h4>{listing.id ? 'Edit listing' : 'New listing'}</h4><button type="button" className="ws-icon-button" aria-label="Cancel listing editing" onClick={() => setListing(null)}><X size={18} /></button></div>
          <Field label="Property title"><input ref={listingTitle} value={listing.title} maxLength={160} onChange={event => listingChange('title', event.target.value)} required /></Field>
          <div className="ws-form-grid"><Field label="Location / neighbourhood"><input value={listing.location} maxLength={160} onChange={event => listingChange('location', event.target.value)} required /></Field><Field label="City / county"><input value={listing.city} maxLength={100} onChange={event => listingChange('city', event.target.value)} required /></Field></div>
          <div className="ws-form-grid"><Field label="Property type"><select value={listing.category} onChange={event => listingChange('category', event.target.value)}>{['Apartment', 'Villa', 'House', 'Land'].map(value => <option key={value}>{value}</option>)}</select></Field><Field label="Offer"><select value={listing.purpose} onChange={event => setListing({ ...listing, purpose: event.target.value, status: ['sold', 'let'].includes(listing.status) ? 'available' : listing.status })}><option value="buy">For sale</option><option value="rent">For rent</option></select></Field></div>
          <div className="ws-form-grid"><Field label={listing.purpose === 'rent' ? 'Monthly rent / KSh' : 'Sale price / KSh'}><input type="number" min="1" value={listing.price} onChange={event => listingChange('price', event.target.value)} required /></Field><Field label="Area / m²"><input type="number" min="1" step="any" value={listing.area} onChange={event => listingChange('area', event.target.value)} required /></Field><Field label="Bedrooms"><input type="number" min="0" step="1" value={listing.beds} onChange={event => listingChange('beds', event.target.value)} required /></Field><Field label="Bathrooms"><input type="number" min="0" step="1" value={listing.baths} onChange={event => listingChange('baths', event.target.value)} required /></Field></div>
          <Field label="Availability"><select value={listing.status || 'available'} onChange={event => listingChange('status', event.target.value)}><option value="available">Available</option><option value="reserved">Reserved</option>{listing.purpose === 'buy' ? <option value="sold">Sold</option> : <option value="let">Let</option>}</select></Field>
          <Field label="Public photo URL" hint="Use an HTTPS image URL or an existing public image path. Upload your photos to your own image host first."><input value={listing.image} placeholder="https://… or /webseite/images/photo.jpg" onChange={event => listingChange('image', event.target.value)} required /></Field>
          {safeImage(listing.image) && <img className="ws-image-preview" src={workspaceImageUrl(listing.image)} alt="Property photo preview" />}
          <Field label="Description"><textarea rows={4} value={listing.description} maxLength={4000} onChange={event => listingChange('description', event.target.value)} required /></Field>
          <Field label="Amenities" hint="Separate each amenity with a comma."><input value={Array.isArray(listing.amenities) ? listing.amenities.join(', ') : listing.amenities} onChange={event => listingChange('amenities', event.target.value)} /></Field>
          <label className="ws-check"><input type="checkbox" checked={Boolean(listing.demo)} onChange={event => listingChange('demo', event.target.checked)} /><span>This is an illustrative demo listing.</span></label>
          {!listing.demo && <label className="ws-check"><input type="checkbox" checked={Boolean(listing.photoRightsConfirmed)} onChange={event => listingChange('photoRightsConfirmed', event.target.checked)} /><span>I have permission to publish this property’s photograph.</span></label>}
          <button className="ws-primary ws-full" type="submit"><Save size={16} />Save listing to draft</button>
        </form>}</div>
      </>}
      {tab === 'enquiries' && <>
        <div className="ws-section-title"><div><h3>People, viewings & follow-ups</h3><p>Add enquiries received by WhatsApp, phone or email manually, or import a private backup. This is a private record on this device.</p></div><button className="ws-primary" onClick={() => { setLead(emptyLead()); setErrors([]); }}><Plus size={17} />Add enquiry</button></div>
        {loadedPrivate.message && <div className="ws-error">{loadedPrivate.message}</div>}
        <div className="ws-metrics"><div><span>Open enquiries</span><strong>{leads.filter(item => item.status !== 'closed').length}</strong></div><div><span>Logged Uber spend</span><strong>KSh {amount(travelTotal)}</strong></div><div><span>Received commission · {closedCount} closed</span><strong>KSh {amount(commissionTotal)}</strong></div><div><span>Completed viewings</span><strong>{viewingTotal}</strong></div></div>
        <div className="ws-private-actions"><button className="ws-secondary" onClick={savePrivate}><Save size={16} />Save private enquiries{leadsDirty && <span className="ws-unsaved-dot" />}</button><button className="ws-secondary" onClick={() => { download(privateFile(), 'makao-private-enquiries.json'); setMessage('Private backup downloaded. It contains personal information. Keep it private and never upload it to your public repository.'); }}><ArrowDownToLine size={16} />Private backup</button><button className="ws-text-button" onClick={() => privateInput.current.click()}><ArrowUpFromLine size={16} />Import private backup</button><input ref={privateInput} type="file" accept="application/json,.json" hidden onChange={importPrivate} /></div>
        <div className={`ws-enquiry-layout ${lead ? 'has-editor' : ''}`}><div className="ws-enquiry-list">{leads.map(item => <article className="ws-enquiry" key={item.id}><div className="ws-enquiry-top"><div><h4>{item.name}</h4><span>{item.email || item.phone || 'Contact details not recorded'}</span></div><span className={`ws-status ws-status-${item.status}`}>{item.status}</span></div><p>{config.properties.find(property => String(property.id) === String(item.propertyId))?.title || 'Property not assigned'}</p>{item.viewingDate && <small>Viewing: {item.viewingDate.replace('T', ' at ')} · local time</small>}<div className="ws-enquiry-bottom"><span>Uber KSh {amount(item.uberCost)}</span><button onClick={() => { setLead(copy(item)); setErrors([]); }}>Edit<ChevronRight size={15} /></button><button className="ws-icon-button" aria-label={`Delete enquiry for ${item.name}`} onClick={() => deleteLead(item)}><Trash2 size={16} /></button></div></article>)}{!leads.length && <div className="ws-empty"><ClipboardList size={28} /><h4>Your next client starts here.</h4><p>Record a conversation, arrange a viewing, then keep track of the follow-up.</p></div>}</div>
        {lead && <form className="ws-editor" onSubmit={saveLead}><div className="ws-editor-heading"><h4>{lead.id ? 'Edit enquiry' : 'New enquiry'}</h4><button type="button" className="ws-icon-button" aria-label="Cancel enquiry editing" onClick={() => setLead(null)}><X size={18} /></button></div>
          <Field label="Client name"><input ref={leadName} value={lead.name} maxLength={150} onChange={event => leadChange('name', event.target.value)} required autoComplete="off" /></Field>
          <div className="ws-form-grid"><Field label="Email"><input type="email" value={lead.email} maxLength={200} onChange={event => leadChange('email', event.target.value)} autoComplete="off" /></Field><Field label="Phone"><input type="tel" value={lead.phone} maxLength={60} onChange={event => leadChange('phone', event.target.value)} autoComplete="off" /></Field></div>
          <Field label="Property"><select value={lead.propertyId} onChange={event => leadChange('propertyId', event.target.value)}><option value="">Not assigned</option>{config.properties.map(property => <option key={property.id} value={property.id}>{property.title}</option>)}</select></Field>
          <div className="ws-form-grid"><Field label="Follow-up status"><select value={lead.status} onChange={event => leadChange('status', event.target.value)}><option value="new">New</option><option value="contacted">Contacted</option><option value="viewing">Viewing arranged</option><option value="closed">Closed</option></select></Field><Field label="Budget / KSh"><input type="number" min="0" step="any" value={lead.budget ?? ''} onChange={event => leadChange('budget', event.target.value)} /></Field></div>
          <Field label="Viewing date & time" hint="Recorded in your local time; no calendar invitation is sent."><input type="datetime-local" value={lead.viewingDate} onChange={event => leadChange('viewingDate', event.target.value)} /></Field>
          <div className="ws-form-grid"><Field label="Total Uber spend / KSh" hint="Plan around KSh 1,000 per return trip. Record only transport you have actually paid for."><input type="number" min="0" step="any" placeholder="1,000 per return trip (estimate)" value={lead.uberCost ?? ''} onChange={event => leadChange('uberCost', event.target.value)} /></Field><Field label="Received commission / KSh" hint="Record money received. Included in the total when status is Closed."><input type="number" min="0" step="any" value={lead.commission ?? ''} onChange={event => leadChange('commission', event.target.value)} /></Field></div>
          <Field label="Completed viewings"><input type="number" min="0" step="1" value={lead.viewingCount ?? 0} onChange={event => leadChange('viewingCount', event.target.value)} /></Field>
          <Field label="Private notes"><textarea rows={4} value={lead.notes} maxLength={4000} onChange={event => leadChange('notes', event.target.value)} /></Field>
          <button className="ws-primary ws-full" type="submit"><Save size={16} />Save enquiry to session</button>
        </form>}</div>
        <p className="ws-privacy-note">Private backups contain client contact details and notes. Store them securely. Clearing this browser’s storage removes locally saved records. Nothing in this tab is included in the public website download.</p>
      </>}
      {tab === 'business' && <>
        <div className="ws-section-title"><div><h3>A business with your name on it.</h3><p>These details appear on your website when you publish its configuration.</p></div></div>
        <div className="ws-settings-layout"><div className="ws-settings-card"><h4>Your public contact details</h4><Field label="Business name"><input value={business.name || ''} maxLength={100} onChange={event => changeBusiness('name', event.target.value)} /></Field><Field label="Agent name"><input value={business.agentName || ''} maxLength={100} onChange={event => changeBusiness('agentName', event.target.value)} /></Field><Field label="WhatsApp number" hint="Include the international country code, e.g. +254… Leave blank to hide WhatsApp."><input type="tel" value={business.whatsapp || ''} maxLength={30} onChange={event => changeBusiness('whatsapp', event.target.value)} /></Field><Field label="Public email address" hint="Use a business address you are comfortable publishing."><input type="email" value={business.email || ''} maxLength={200} onChange={event => changeBusiness('email', event.target.value)} /></Field><Field label="Service area"><input value={business.serviceArea || ''} maxLength={200} onChange={event => changeBusiness('serviceArea', event.target.value)} /></Field></div>
        <div className="ws-settings-card"><span className="ws-eyebrow">VIEWING ARRANGEMENTS</span><h4>A clear agreement before the trip.</h4><p>Publish a travel contribution only after checking your terms and agreeing it with the client. This website does not collect payments.</p><label className="ws-check"><input type="checkbox" checked={Boolean(policy.enabled)} onChange={event => changePolicy('enabled', event.target.checked)} /><span>Display a viewing travel contribution policy.</span></label>
          {policy.enabled && <div className="ws-policy-fields"><Field label="How is the contribution agreed?"><select value={policy.mode || 'quote'} onChange={event => changePolicy('mode', event.target.value)}><option value="quote">Quote and agree before each viewing</option><option value="fixed">Fixed contribution</option></select></Field>{policy.mode === 'fixed' && <Field label="Fixed contribution / KSh"><input type="number" min="1" step="any" value={policy.fixedAmount ?? ''} onChange={event => changePolicy('fixedAmount', event.target.value === '' ? null : Number(event.target.value))} /></Field>}<label className="ws-check"><input type="checkbox" checked={Boolean(policy.creditOnCompletion)} onChange={event => changePolicy('creditOnCompletion', event.target.checked)} /><span>Credit or refund the contribution to the viewing customer when this transaction completes.</span></label><Field label="Cancellation notice / hours" hint="State the notice period in the agreed terms before confirming a viewing."><input type="number" min="0" max="168" step="1" value={policy.cancellationHours ?? 24} onChange={event => changePolicy('cancellationHours', event.target.value === '' ? '' : Number(event.target.value))} /></Field></div>}
          <div className="ws-policy-note">Planning example: a return Uber trip may cost around KSh 1,000. No contribution is shown publicly until you enable and publish this policy. A contribution covers travel; it does not guarantee a property or an accepted offer. Share the amount and cancellation terms before the client confirms.</div>
        </div></div>
      </>}
    </div>
    <footer className="ws-footer"><div className="ws-footer-actions"><button className="ws-secondary" onClick={saveDraft}><Save size={16} />Save local draft{dirty && <span className="ws-unsaved-dot" />}</button><button className="ws-primary" onClick={preview}>Preview on this device<ChevronRight size={17} /></button><button className="ws-secondary" onClick={exportPublic}><ArrowDownToLine size={16} />Download public website file</button></div><div className="ws-publication"><p>To publish, <a href="https://github.com/naronius-sketch/webseite/edit/main/public/site-config.json" target="_blank" rel="noreferrer">replace site-config.json in GitHub</a> with your downloaded file and commit. Preview here updates only this device.</p><div><button className="ws-text-button" onClick={() => publicInput.current.click()}><ArrowUpFromLine size={14} />Import website file</button><button className="ws-text-button" onClick={resetDraft}>Restore website draft</button></div><input ref={publicInput} type="file" accept="application/json,.json" hidden onChange={importPublic} /></div></footer>
  </section></div>;
}

import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Check, ChevronRight, Cloud, Eye, Home, ImagePlus, LoaderCircle, LockKeyhole, LogOut, Plus, RefreshCw, Save, Settings, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { DEFAULT_BUSINESS, isPublicImageUrl, parsePublicConfig, validatePublicConfig } from './broker-model.js';
import { loadBackendConfig } from './admin-config.js';
import { createAdminService } from './admin-service.js';
import './admin.css';

const clone = value => JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const amount = value => new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 }).format(Number(value) || 0);
const newId = () => globalThis.crypto?.randomUUID?.() || `property-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const blankListing = () => ({ id: newId(), title: '', location: '', city: 'Nairobi', category: 'Apartment', purpose: 'rent', price: '', beds: 0, baths: 0, area: '', image: '', photos: [], tag: '', description: '', amenities: [], status: 'available', demo: false, photoRightsConfirmed: false });
const imageUrl = value => {
  if (!isPublicImageUrl(value)) return '';
  const base = import.meta.env.BASE_URL || '/';
  return value.startsWith('/') && base !== '/' && !value.startsWith(base) ? `${base}${value.slice(1)}` : value;
};

function download(config, filename = 'wangechi-website-backup.json') {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(config, null, 2)}\n`], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function errorMessage(problem, action = 'complete this request') {
  if (problem?.code === 'REVISION_CONFLICT') return 'Another agent has saved changes since you opened this draft. Your changes are still here. Download a backup, then reload the shared draft before saving again.';
  if (problem?.code === 'ADMIN_REQUIRED') return 'Your account no longer has agent access. Please contact the site owner.';
  if (problem?.code === 'AUTH_REQUIRED') return 'Your session has expired. Please sign in again.';
  if (problem?.code === 'UPLOAD') return 'The photo could not be uploaded. Choose a JPEG, PNG or WebP image under 8 MB and try again.';
  if (problem?.code === 'VALIDATION') return 'Some website details could not be accepted. Check your entries before trying again.';
  return `We could not ${action}. Check your connection and try again. Your changes have not been published.`;
}

function Field({ label, hint, children }) {
  return <label className="admin-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Notice({ errors, message }) {
  return <>{errors.length > 0 && <div className="admin-notice admin-notice-error" role="alert"><strong>Please check these details</strong><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}{message && <div className="admin-notice admin-notice-success" role="status"><Check size={18} /><span>{message}</span></div>}</>;
}

/** The browser holds an editing session only. Membership and all writes are checked by the backend. */
export default function AdminPanel({ initialConfig, onPreview, onPublished, onClose, onOpenLocal }) {
  const [phase, setPhase] = useState('starting');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [working, setWorking] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [tab, setTab] = useState('listings');
  const [listing, setListing] = useState(null);
  const [listingDirty, setListingDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState([]);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const dialog = useRef(null);
  const emailInput = useRef(null);
  const titleInput = useRef(null);
  const importInput = useRef(null);
  const serviceRef = useRef(null);
  const mounted = useRef(false);
  const authEpoch = useRef(0);
  const userRef = useRef(null);
  const phaseRef = useRef('starting');
  const busyRef = useRef('');
  const authIntent = useRef(0);
  const signingOut = useRef(false);
  const preventSessionRestore = useRef(false);
  const editorEpoch = useRef(0);
  const sessionHandler = useRef(null);
  const dirty = Boolean(working && (!snapshot?.draftConfig || !same(working, snapshot.draftConfig)));
  const unpublished = Boolean(working && (!snapshot?.publishedConfig || !same(working, snapshot.publishedConfig)));
  const locked = Boolean(busy);

  function changePhase(value) { phaseRef.current = value; setPhase(value); }
  function setOperation(value) { busyRef.current = value; setBusy(value); }
  function clearPrivateState() {
    editorEpoch.current += 1;
    setWorking(null);
    setSnapshot(null);
    setListing(null);
    setListingDirty(false);
    setUserEmail('');
    setConflict(false);
    setPassword('');
    setMessage('');
    setErrors([]);
    setOperation('');
  }
  function current(ticket) { return mounted.current && ticket === authEpoch.current; }
  function normalizeState(state) {
    if (!state || !Number.isSafeInteger(state.draftRevision) || state.draftRevision < 0 || !Number.isSafeInteger(state.publishedRevision) || state.publishedRevision < 0) throw new Error('Invalid catalogue state');
    const result = { ...state };
    for (const field of ['draftConfig', 'publishedConfig']) {
      if (state[field] == null) result[field] = null;
      else {
        const validation = validatePublicConfig(state[field]);
        if (!validation.valid) throw new Error('Invalid shared catalogue');
        result[field] = validation.config;
      }
    }
    return result;
  }
  function acceptState(state) {
    const value = normalizeState(state);
    setSnapshot(value);
    setWorking(value.draftConfig ? clone(value.draftConfig) : null);
    setConflict(false);
    return value;
  }

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let unsubscribe;
    async function handleSession(session) {
      if (!active) return;
      const identity = session?.user?.id || null;
      if (identity && preventSessionRestore.current) return;
      if (!identity && !userRef.current && ['login', 'denied'].includes(phaseRef.current)) return;
      if (identity && userRef.current === identity && ['checking', 'ready'].includes(phaseRef.current)) return;
      const ticket = ++authEpoch.current;
      userRef.current = identity;
      clearPrivateState();
      if (!identity) { changePhase('login'); return; }
      changePhase('checking');
      try {
        const authorized = await serviceRef.current.checkAdmin();
        if (!active || !current(ticket)) return;
        if (!authorized) {
          userRef.current = null;
          changePhase('denied');
          preventSessionRestore.current = true;
          signingOut.current = true;
          try { await serviceRef.current.signOut(); if (active && current(ticket)) setLogoutFailed(false); }
          catch { if (active && current(ticket)) setLogoutFailed(true); }
          finally { signingOut.current = false; }
          if (active && current(ticket)) { changePhase('denied'); setErrors(['This account has not been given agent access. Contact the site owner.']); }
          return;
        }
        const state = await serviceRef.current.loadCatalogue();
        if (!active || !current(ticket)) return;
        acceptState(state);
        setUserEmail(session.user.email || 'Agent');
        changePhase('ready');
      } catch (problem) {
        if (!active || !current(ticket)) return;
        setErrors([errorMessage(problem, 'open the shared workspace')]);
        changePhase('access-error');
      }
    }
    sessionHandler.current = handleSession;
    async function start() {
      try {
        const config = await loadBackendConfig();
        if (!active) return;
        if (!config.configured) { changePhase('unconfigured'); return; }
        const service = createAdminService(config);
        serviceRef.current = service;
        unsubscribe = service.onAuthStateChange((event, session) => {
          if (signingOut.current) return;
          if (preventSessionRestore.current && session?.user?.id) return;
          const intent = authIntent.current;
          // Supabase auth callbacks must finish before another authenticated request starts.
          setTimeout(() => { if (active && intent === authIntent.current && !signingOut.current) handleSession(session); }, 0);
        });
        const session = await service.getSession();
        if (active) await handleSession(session);
      } catch {
        if (active) { changePhase('config-error'); setErrors(['Agent access is temporarily unavailable. Contact the site owner, or try again later.']); }
      }
    }
    start();
    return () => { active = false; mounted.current = false; authEpoch.current += 1; unsubscribe?.(); sessionHandler.current = null; };
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; previousFocus?.focus?.(); };
  }, []);
  useEffect(() => {
    if (phase === 'login' && !busy) emailInput.current?.focus();
    else if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus();
  }, [phase, busy]);
  useEffect(() => { if (listing) titleInput.current?.focus(); }, [listing?.id]);
  useEffect(() => {
    function beforeUnload(event) { if (dirty || listingDirty || busyRef.current) { event.preventDefault(); event.returnValue = ''; } }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, listingDirty]);

  function close() {
    if (locked) { setErrors(['Please wait for the current request to finish before closing the workspace.']); return; }
    if ((dirty || listingDirty) && !window.confirm('Close with unsaved changes? Changes not saved to the shared draft will be lost.')) return;
    onClose();
  }
  function keydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter(element => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    else if (!event.shiftKey && document.activeElement === dialog.current) { event.preventDefault(); first?.focus(); }
  }
  async function login(event) {
    event.preventDefault();
    if (busyRef.current || !serviceRef.current) return;
    const intent = ++authIntent.current;
    const ticket = authEpoch.current;
    setErrors([]);
    setOperation('login');
    try {
      const session = await serviceRef.current.signIn(email.trim(), password);
      if (mounted.current && intent === authIntent.current) { preventSessionRestore.current = false; setLogoutFailed(false); setPassword(''); await sessionHandler.current?.(session); }
    } catch {
      if (current(ticket)) setErrors(['Sign-in failed. Check your email and password, then try again.']);
    } finally { if (mounted.current && ['login', 'denied'].includes(phaseRef.current)) setOperation(''); }
  }
  async function signOut() {
    if (busyRef.current && busyRef.current !== 'reload') return;
    if ((dirty || listingDirty) && !window.confirm('Sign out with unsaved changes? Changes not saved to the shared draft will be lost.')) return;
    authIntent.current += 1;
    preventSessionRestore.current = true;
    signingOut.current = true;
    authEpoch.current += 1;
    userRef.current = null;
    clearPrivateState();
    changePhase('login');
    setOperation('signout');
    try { await serviceRef.current?.signOut(); if (mounted.current) { setLogoutFailed(false); setErrors([]); } }
    catch { if (mounted.current) { setLogoutFailed(true); setErrors(['Your workspace has been cleared, but sign-out could not be confirmed. Retry sign out before leaving a shared device.']); } }
    finally { signingOut.current = false; if (mounted.current) setOperation(''); }
  }
  async function retryAccess() {
    if (busyRef.current) return;
    userRef.current = null;
    try { const session = await serviceRef.current.getSession(); if (mounted.current) sessionHandler.current?.(session); }
    catch { if (mounted.current) setErrors(['We could not verify your session. Try again when your connection is available.']); }
  }
  function operationError(problem, action) {
    if (['AUTH_REQUIRED', 'ADMIN_REQUIRED'].includes(problem?.code)) {
      authIntent.current += 1;
      preventSessionRestore.current = true;
      authEpoch.current += 1;
      userRef.current = null;
      clearPrivateState();
      changePhase(problem.code === 'ADMIN_REQUIRED' ? 'denied' : 'login');
      setErrors([errorMessage(problem, action)]);
      signingOut.current = true;
      setOperation('signout');
      const ticket = authEpoch.current;
      serviceRef.current?.signOut().then(() => { if (current(ticket)) setLogoutFailed(false); }).catch(() => { if (current(ticket)) setLogoutFailed(true); }).finally(() => {
        signingOut.current = false;
        if (current(ticket)) setOperation('');
      });
      return;
    }
    if (problem?.code === 'REVISION_CONFLICT') setConflict(true);
    setErrors([errorMessage(problem, action)]);
  }
  function editConfig(next) { setWorking(next); setMessage(''); setErrors([]); }
  async function openLocal() {
    if (busyRef.current || !onOpenLocal) return;
    if ((dirty || listingDirty) && !window.confirm('Open the local workspace with unsaved changes? Save your shared draft first to keep them.')) return;
    const ticket = authEpoch.current;
    setOperation('local');
    setErrors([]);
    try { await onOpenLocal(); }
    catch { if (current(ticket)) setErrors(['The local workspace could not be opened. Check your connection and try again.']); }
    finally { if (current(ticket)) setOperation(''); }
  }
  function changeBusiness(field, value) { editConfig({ ...working, business: { ...working.business, [field]: value } }); }
  function changePolicy(field, value) { changeBusiness('viewingPolicy', { ...DEFAULT_BUSINESS.viewingPolicy, ...working.business.viewingPolicy, [field]: value }); }
  function validConfig() {
    if (listing) { setErrors(['Finish or cancel the open property form before saving, previewing or publishing the website.']); return null; }
    const result = validatePublicConfig(working);
    if (!result.valid) { setErrors(result.errors); return null; }
    setErrors([]);
    return result.config;
  }
  async function writeCatalogue(kind) {
    if (phaseRef.current !== 'ready' || busyRef.current || conflict) return;
    const config = validConfig();
    if (!config) return;
    const ticket = authEpoch.current;
    setOperation(kind);
    setMessage('');
    try {
      const service = serviceRef.current;
      const response = kind === 'publish'
        ? await service.publish(config, { draftRevision: snapshot.draftRevision, publishedRevision: snapshot.publishedRevision })
        : await service.saveDraft(config, { draftRevision: snapshot.draftRevision });
      if (!current(ticket)) return;
      const state = normalizeState(response);
      if (kind === 'publish' && !state.publishedConfig) throw new Error('Missing published catalogue');
      acceptState(state);
      if (kind === 'publish') {
        try {
          onPublished(state.publishedConfig);
          setMessage('Your website has been published. Visitors will see the updated catalogue when they load the website.');
        } catch {
          setMessage('Your website has been published. Reload the website to see the updated catalogue on this device.');
        }
      } else setMessage('Shared draft saved. It is available to your agent account on other devices. The published website has not changed.');
    } catch (problem) { if (current(ticket)) operationError(problem, kind === 'publish' ? 'publish the website' : 'save the shared draft'); }
    finally { if (current(ticket)) setOperation(''); }
  }
  async function reloadDraft() {
    if (phaseRef.current !== 'ready' || busyRef.current) return;
    if ((dirty || listingDirty) && !window.confirm('Reload the shared draft and discard your unsaved changes? Download a backup first if you want to keep them.')) return;
    const ticket = authEpoch.current;
    setOperation('reload');
    setMessage('');
    try {
      const response = await serviceRef.current.loadCatalogue();
      if (!current(ticket)) return;
      acceptState(response);
      setListing(null);
      setListingDirty(false);
      editorEpoch.current += 1;
      setErrors([]);
      setMessage('The latest shared draft is open.');
    } catch (problem) { if (current(ticket)) operationError(problem, 'reload the shared draft'); }
    finally { if (current(ticket)) setOperation(''); }
  }
  function startDraft(useWebsite) {
    const validation = validatePublicConfig(useWebsite ? initialConfig : { schemaVersion: 1, business: initialConfig?.business || { ...DEFAULT_BUSINESS, name: 'Wangechi Realty' }, properties: [] });
    if (!validation.valid) { setErrors(['The starting catalogue could not be read. Contact the site owner.']); return; }
    editConfig(validation.config);
    setMessage('Your first draft is ready to edit. Save it to share it across devices, or publish it when you are ready.');
  }
  function preview() {
    if (busyRef.current || phaseRef.current !== 'ready') return;
    const config = validConfig();
    if (!config) return;
    try { onPreview(config); setMessage('Preview updated on this device. Close the workspace to view it. The public website changes only after you publish.'); }
    catch { setErrors(['The preview could not be opened. Your draft is unchanged.']); }
  }
  function openListing(property) {
    if (locked) return;
    if (listingDirty && !window.confirm('Discard the changes in the current property form?')) return;
    editorEpoch.current += 1;
    setListing(property ? clone(property) : blankListing());
    setListingDirty(false);
    setErrors([]);
    setMessage('');
    setTab('listings');
  }
  function cancelListing() {
    if (locked || (listingDirty && !window.confirm('Discard changes in this property form?'))) return;
    editorEpoch.current += 1;
    setListing(null);
    setListingDirty(false);
    setErrors([]);
  }
  function changeListing(field, value) { setListing(currentListing => ({ ...currentListing, [field]: value })); setListingDirty(true); setErrors([]); setMessage(''); }
  function saveListing(event) {
    event.preventDefault();
    if (locked) return;
    const property = { ...listing, price: Number(listing.price), beds: Number(listing.beds), baths: Number(listing.baths), area: Number(listing.area), amenities: Array.isArray(listing.amenities) ? listing.amenities : listing.amenities.split(',').map(item => item.trim()).filter(Boolean) };
    const validation = validatePublicConfig({ schemaVersion: 1, business: working.business, properties: [property] });
    if (!validation.valid) { setErrors(validation.errors); return; }
    const exists = working.properties.some(item => String(item.id) === String(property.id));
    const properties = exists ? working.properties.map(item => String(item.id) === String(property.id) ? validation.config.properties[0] : item) : [...working.properties, validation.config.properties[0]];
    editConfig({ ...working, properties });
    setListing(null);
    setListingDirty(false);
    editorEpoch.current += 1;
    setMessage('Property added to your working draft. Save the shared draft or publish to keep this change.');
  }
  function removeListing(property) {
    if (locked || !window.confirm(`Remove “${property.title}” from the draft? It remains on the public website until you publish.`)) return;
    if (listing && String(listing.id) === String(property.id)) { setListing(null); setListingDirty(false); editorEpoch.current += 1; }
    editConfig({ ...working, properties: working.properties.filter(item => String(item.id) !== String(property.id)) });
  }
  async function uploadPhotos(event, gallery = false) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length || !listing || busyRef.current || phaseRef.current !== 'ready') return;
    if (!listing.photoRightsConfirmed) { setErrors(['Confirm that you have permission to publish these photos before uploading.']); return; }
    if (files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 8 * 1024 * 1024)) { setErrors(['Choose JPEG, PNG or WebP photos no larger than 8 MB each.']); return; }
    if (gallery && (listing.photos?.length || 0) + files.length > 50) { setErrors(['A property can have up to 50 gallery photos.']); return; }
    const ticket = authEpoch.current;
    const editorTicket = editorEpoch.current;
    const urls = [];
    setOperation('upload');
    setErrors([]);
    setMessage('');
    try {
      for (const file of gallery ? files : files.slice(0, 1)) {
        const url = await serviceRef.current.uploadPhoto(file);
        if (!current(ticket) || editorTicket !== editorEpoch.current) return;
        if (!isPublicImageUrl(url)) throw new Error('Invalid uploaded photo URL');
        urls.push(url);
      }
      if (!current(ticket) || editorTicket !== editorEpoch.current) return;
      setListing(value => gallery ? { ...value, photos: [...(value.photos || []), ...urls] } : { ...value, image: urls[0] });
      setListingDirty(true);
      setMessage(`${urls.length === 1 ? 'Photo' : `${urls.length} photos`} uploaded. Finish the property form, then save or publish your catalogue.`);
    } catch (problem) {
      if (current(ticket) && editorTicket === editorEpoch.current) {
        if (gallery && urls.length) { setListing(value => ({ ...value, photos: [...(value.photos || []), ...urls] })); setListingDirty(true); }
        operationError(problem, 'upload the photo');
      }
    } finally { if (current(ticket)) setOperation(''); }
  }
  async function importCatalogue(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busyRef.current || phaseRef.current !== 'ready') return;
    if (file.size > 2_000_000) { setErrors(['Choose a public website JSON file under 2 MB.']); return; }
    if ((dirty || listingDirty) && !window.confirm('Replace the working draft with this website file? Unsaved changes will be discarded.')) return;
    const ticket = authEpoch.current;
    setOperation('import');
    setErrors([]);
    setMessage('');
    try {
      const config = parsePublicConfig(await file.text());
      if (!current(ticket)) return;
      editConfig(config);
      setListing(null);
      setListingDirty(false);
      editorEpoch.current += 1;
      setMessage('Website file imported into your working draft. Nothing is published until you choose Publish website.');
    } catch { if (current(ticket)) setErrors(['This file is not a valid public website catalogue. Choose site-config.json or a website backup. Private customer backups cannot be imported here.']); }
    finally { if (current(ticket)) setOperation(''); }
  }

  const business = working?.business;
  const policy = { ...DEFAULT_BUSINESS.viewingPolicy, ...business?.viewingPolicy };
  const editingExists = Boolean(listing && working?.properties.some(item => String(item.id) === String(listing.id)));
  const status = locked ? (busy === 'upload' ? 'Uploading photo…' : busy === 'publish' ? 'Publishing website…' : busy === 'save' ? 'Saving shared draft…' : 'Please wait…') : dirty ? 'Changes to save' : unpublished ? 'Draft saved · not published' : 'Up to date';

  return <div className="admin-overlay"><section className="admin-shell" role="dialog" aria-modal="true" aria-labelledby="admin-title" tabIndex={-1} ref={dialog} onKeyDown={keydown}>
    <header className="admin-header"><div className="admin-heading"><span className="admin-brand-icon"><Home size={23} /></span><div><span className="admin-eyebrow">WANGECHI REALTY</span><h2 id="admin-title">Agent workspace</h2></div></div><div className="admin-header-actions">{phase === 'ready' && <button className="admin-icon-button" onClick={reloadDraft} disabled={locked} aria-label="Refresh shared draft" title="Reload shared draft"><RefreshCw size={18} /></button>}{['ready', 'checking', 'access-error'].includes(phase) && <button className="admin-icon-button" onClick={signOut} disabled={locked && busy !== 'reload'} aria-label="Sign out" title="Sign out"><LogOut size={19} /></button>}<button className="admin-icon-button" onClick={close} disabled={locked} aria-label="Close agent workspace"><X size={23} /></button></div></header>
    {phase !== 'ready' ? <div className="admin-entry"><div className="admin-entry-illustration"><span><ShieldCheck size={43} strokeWidth={1.3} /></span><p className="admin-eyebrow">YOUR BUSINESS, TOGETHER</p><h3>A home for your<br />property collection.</h3><p>Manage listings, upload property photos and keep your website current from any device.</p><div className="admin-entry-feature"><Cloud size={17} /><span>A shared draft. A clear publish step.</span></div></div><div className="admin-entry-content">
      {['starting', 'checking'].includes(phase) ? <div className="admin-entry-state" role="status"><LoaderCircle className="admin-spin" size={30} /><h3>{phase === 'checking' ? 'Checking agent access' : 'Opening your workspace'}</h3><p>Please wait a moment.</p></div> : <>
        <Notice errors={errors} message={message} />
        {logoutFailed && <div className="admin-logout-retry"><p>Sign-out has not been confirmed. Please retry before leaving a shared device.</p><button className="admin-secondary" disabled={locked} onClick={signOut}><LogOut size={17} />{busy === 'signout' ? 'Signing out…' : 'Retry sign out'}</button></div>}
        {phase === 'login' && <form className="admin-login" onSubmit={login}><span className="admin-small-icon"><LockKeyhole size={24} /></span><h3>Welcome back.</h3><p>Sign in with the agent account provided by the site owner.</p><fieldset disabled={locked}><Field label="Email address"><input ref={emailInput} type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" maxLength={254} required /></Field><Field label="Password"><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" maxLength={200} required /></Field><button className="admin-primary admin-full" type="submit">{busy === 'login' ? <LoaderCircle size={18} className="admin-spin" /> : <LockKeyhole size={17} />}{busy === 'login' ? 'Signing in…' : 'Sign in'}</button></fieldset><small>Need access or a password reset? Contact the site owner.</small></form>}
        {phase === 'unconfigured' && <div className="admin-entry-state"><span className="admin-small-icon"><LockKeyhole size={26} /></span><h3>Agent access is coming soon.</h3><p>Agent accounts are being set up. Contact the site owner for access.</p>{onOpenLocal && <button className="admin-secondary" disabled={locked} onClick={openLocal}><ArrowLeft size={17} />Open local workspace</button>}<small>The website remains available while the shared workspace is being set up.</small></div>}
        {phase === 'denied' && <div className="admin-entry-state"><LockKeyhole size={30} /><h3>Agent access required.</h3><p>Only approved agent accounts can open this workspace.</p><button className="admin-secondary" onClick={() => { changePhase('login'); setErrors([]); }}>Use a different account</button></div>}
        {phase === 'access-error' && <div className="admin-entry-state"><Cloud size={30} /><h3>We could not open your workspace.</h3><p>Your shared draft has not been changed.</p><div className="admin-inline-actions"><button className="admin-primary" onClick={retryAccess}><RefreshCw size={17} />Try again</button><button className="admin-secondary" onClick={signOut}><LogOut size={17} />Sign out</button></div></div>}
        {phase === 'config-error' && <div className="admin-entry-state"><Cloud size={30} /><h3>Agent access is unavailable.</h3><p>Please contact the site owner. The public website remains available.</p><button className="admin-secondary" onClick={close}>Back to website</button></div>}
      </>}
    </div></div> : <>
      <div className="admin-account-bar"><span><ShieldCheck size={15} />{userEmail}</span><span className={`admin-save-state ${dirty ? 'admin-save-state-dirty' : ''}`}>{locked ? <LoaderCircle size={15} className="admin-spin" /> : <Cloud size={15} />}{status}</span></div>
      <nav className="admin-tabs" aria-label="Agent workspace sections"><button className={tab === 'listings' ? 'active' : ''} aria-current={tab === 'listings' ? 'page' : undefined} onClick={() => setTab('listings')} disabled={locked}><Home size={18} />Properties{working && <span>{working.properties.length}</span>}</button><button className={tab === 'business' ? 'active' : ''} aria-current={tab === 'business' ? 'page' : undefined} onClick={() => { if (listing) { setErrors(['Finish or cancel the property form before opening business settings.']); return; } setTab('business'); }} disabled={locked}><Settings size={18} />Business settings</button></nav>
      <main className="admin-body"><Notice errors={errors} message={message} />
        {conflict && <div className="admin-conflict"><div><strong>Keep your changes before reloading.</strong><p>Download your version if you want to compare or reapply it later.</p></div><div className="admin-inline-actions"><button className="admin-secondary" disabled={locked || !working} onClick={() => download(working)}><ArrowDownToLine size={17} />Download my changes</button><button className="admin-primary" disabled={locked} onClick={reloadDraft}><RefreshCw size={17} />Reload shared draft</button></div></div>}
        {!working ? <div className="admin-first-draft"><span className="admin-small-icon"><Home size={30} /></span><span className="admin-eyebrow">YOUR FIRST SHARED DRAFT</span><h3>Bring your properties together.</h3><p>Start with the catalogue currently on your website, or create a fresh collection. Nothing goes live until you publish.</p><div className="admin-inline-actions"><button className="admin-primary" disabled={locked} onClick={() => startDraft(true)}><ArrowUpFromLine size={17} />Start with current website</button><button className="admin-secondary" disabled={locked} onClick={() => startDraft(false)}><Plus size={17} />Start a fresh collection</button></div><button className="admin-text-button" disabled={locked} onClick={() => importInput.current?.click()}><ArrowUpFromLine size={15} />Import website backup</button></div> : <>
          {tab === 'listings' && <><div className="admin-section-heading"><div><span className="admin-eyebrow">YOUR PROPERTY COLLECTION</span><h3>Make room for the next move.</h3><p>Update your listings here, then publish when everything is ready.</p></div><button className="admin-primary" disabled={locked} onClick={() => openListing()}><Plus size={18} />Add property</button></div>
            <div className={`admin-listing-layout ${listing ? 'has-editor' : ''}`}><div className="admin-property-grid">{working.properties.map(property => <article className="admin-property" key={property.id}><div className="admin-property-photo">{imageUrl(property.image) ? <img src={imageUrl(property.image)} alt="" loading="lazy" /> : <Home size={34} />}<span className={`admin-badge admin-badge-${property.status}`}>{property.status || 'available'}</span>{property.demo && <span className="admin-demo-badge">Demo</span>}</div><div className="admin-property-content"><span>{property.location} · {property.city}</span><h4>{property.title}</h4><p>KSh {amount(property.price)}{property.purpose === 'rent' && <small> / month</small>}</p><div className="admin-property-actions"><span>{property.purpose === 'rent' ? 'For rent' : 'For sale'}</span><button disabled={locked} onClick={() => openListing(property)}>Edit<ChevronRight size={16} /></button><button className="admin-icon-button admin-delete" disabled={locked} aria-label={`Remove ${property.title}`} onClick={() => removeListing(property)}><Trash2 size={16} /></button></div></div></article>)}{working.properties.length === 0 && <div className="admin-empty"><Home size={36} strokeWidth={1.2} /><h4>Your next listing starts here.</h4><p>Add a property with its price, availability and your own photos.</p><button className="admin-secondary" disabled={locked} onClick={() => openListing()}><Plus size={17} />Add your first property</button></div>}</div>
              {listing && <form className="admin-editor" onSubmit={saveListing}><div className="admin-editor-heading"><div><span className="admin-eyebrow">PROPERTY DETAILS</span><h4>{editingExists ? 'Edit property' : 'New property'}</h4></div><button type="button" className="admin-icon-button" disabled={locked} aria-label="Cancel property editing" onClick={cancelListing}><X size={20} /></button></div><fieldset disabled={locked}>
                <Field label="Property title"><input ref={titleInput} value={listing.title} maxLength={200} onChange={event => changeListing('title', event.target.value)} placeholder="e.g. A bright two-bedroom apartment" required /></Field>
                <div className="admin-form-grid"><Field label="Neighbourhood / location"><input value={listing.location} maxLength={200} onChange={event => changeListing('location', event.target.value)} required /></Field><Field label="City / county"><input value={listing.city} maxLength={100} onChange={event => changeListing('city', event.target.value)} required /></Field></div>
                <div className="admin-form-grid"><Field label="Property type"><select value={listing.category} onChange={event => changeListing('category', event.target.value)}>{[...new Set(['Apartment', 'Villa', 'House', 'Land', listing.category])].filter(Boolean).map(value => <option key={value}>{value}</option>)}</select></Field><Field label="Offer"><select value={listing.purpose} onChange={event => { changeListing('purpose', event.target.value); if (['sold', 'let'].includes(listing.status)) changeListing('status', 'available'); }}><option value="rent">For rent</option><option value="buy">For sale</option></select></Field></div>
                <div className="admin-form-grid"><Field label={listing.purpose === 'rent' ? 'Monthly rent / KSh' : 'Sale price / KSh'}><input type="number" min="1" max="1000000000000" step="any" value={listing.price} onChange={event => changeListing('price', event.target.value)} required /></Field><Field label="Area / m²"><input type="number" min="1" max="100000000" step="any" value={listing.area} onChange={event => changeListing('area', event.target.value)} required /></Field><Field label="Bedrooms"><input type="number" min="0" max="100" step="1" value={listing.beds} onChange={event => changeListing('beds', event.target.value)} required /></Field><Field label="Bathrooms"><input type="number" min="0" max="100" step="1" value={listing.baths} onChange={event => changeListing('baths', event.target.value)} required /></Field></div>
                <Field label="Availability"><select value={listing.status || 'available'} onChange={event => changeListing('status', event.target.value)}><option value="available">Available</option><option value="reserved">Reserved</option>{listing.purpose === 'buy' ? <option value="sold">Sold</option> : <option value="let">Let</option>}</select></Field>
                <div className="admin-photo-section"><h5><ImagePlus size={18} />Property photographs</h5><label className="admin-check"><input type="checkbox" checked={Boolean(listing.photoRightsConfirmed)} onChange={event => changeListing('photoRightsConfirmed', event.target.checked)} /><span>I have permission to publish all photos of this property.</span></label><div className="admin-photo-upload"><label className={`admin-secondary ${!listing.photoRightsConfirmed ? 'admin-disabled-label' : ''}`}><Upload size={17} />{busy === 'upload' ? 'Uploading…' : 'Upload cover photo'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={locked || !listing.photoRightsConfirmed} onChange={event => uploadPhotos(event)} /></label><small>JPEG, PNG or WebP · up to 8 MB each. Uploaded photos are stored publicly; use only property photos you may publish.</small></div>
                  <Field label="Cover photo URL" hint="An uploaded photo fills this automatically. You may also use a public HTTPS image address."><input value={listing.image} maxLength={2048} onChange={event => changeListing('image', event.target.value)} placeholder="https://…" required /></Field>{imageUrl(listing.image) && <img className="admin-cover-preview" src={imageUrl(listing.image)} alt="Cover photo preview" />}
                  <div className="admin-gallery">{(listing.photos || []).map((photo, index) => <div key={`${photo}-${index}`}><img src={imageUrl(photo)} alt={`Gallery photo ${index + 1}`} /><button type="button" disabled={locked} aria-label={`Remove gallery photo ${index + 1}`} onClick={() => changeListing('photos', listing.photos.filter((_, photoIndex) => index !== photoIndex))}><X size={16} /></button></div>)}</div><label className={`admin-text-button admin-upload-label ${!listing.photoRightsConfirmed ? 'admin-disabled-label' : ''}`}><Plus size={16} />Add gallery photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={locked || !listing.photoRightsConfirmed} onChange={event => uploadPhotos(event, true)} /></label>
                </div>
                <Field label="Description"><textarea rows={4} value={listing.description} maxLength={10000} onChange={event => changeListing('description', event.target.value)} required /></Field><Field label="Amenities" hint="Separate each amenity with a comma."><input value={Array.isArray(listing.amenities) ? listing.amenities.join(', ') : listing.amenities} onChange={event => changeListing('amenities', event.target.value)} placeholder="Parking, balcony, security" /></Field><Field label="Highlight label (optional)"><input value={listing.tag || ''} maxLength={100} onChange={event => changeListing('tag', event.target.value)} placeholder="e.g. New listing" /></Field><label className="admin-check"><input type="checkbox" checked={Boolean(listing.demo)} onChange={event => changeListing('demo', event.target.checked)} /><span>This is an illustrative demo property.</span></label><button className="admin-primary admin-full" type="submit"><Check size={17} />Keep property changes</button><p className="admin-editor-note">This updates your working draft. Save or publish the catalogue below to keep the changes.</p>
              </fieldset></form>}
            </div></>}
          {tab === 'business' && <><div className="admin-section-heading"><div><span className="admin-eyebrow">BUSINESS SETTINGS</span><h3>A business with your name on it.</h3><p>These details appear publicly after you publish your website.</p></div></div><fieldset disabled={locked} className="admin-settings-grid"><div className="admin-settings-card"><h4>Your public contact details</h4><Field label="Business name"><input value={business.name || ''} maxLength={100} onChange={event => changeBusiness('name', event.target.value)} required /></Field><Field label="Agent name"><input value={business.agentName || ''} maxLength={100} onChange={event => changeBusiness('agentName', event.target.value)} /></Field><Field label="WhatsApp number" hint="Include the country code, e.g. +254… Leave blank to hide WhatsApp."><input type="tel" value={business.whatsapp || ''} maxLength={50} onChange={event => changeBusiness('whatsapp', event.target.value)} /></Field><Field label="Public email address"><input type="email" value={business.email || ''} maxLength={254} onChange={event => changeBusiness('email', event.target.value)} /></Field><Field label="Service area"><input value={business.serviceArea || ''} maxLength={200} onChange={event => changeBusiness('serviceArea', event.target.value)} /></Field></div><div className="admin-settings-card"><span className="admin-eyebrow">VIEWING ARRANGEMENTS</span><h4>A clear agreement before the trip.</h4><p>Share the transport contribution and cancellation terms before a client agrees to a viewing. Payments are handled directly by the agent.</p><label className="admin-check"><input type="checkbox" checked={Boolean(policy.enabled)} onChange={event => changePolicy('enabled', event.target.checked)} /><span>Display a viewing transport contribution policy.</span></label>{policy.enabled && <><Field label="How is the contribution agreed?"><select value={policy.mode} onChange={event => changePolicy('mode', event.target.value)}><option value="quote">Quote and agree before each viewing</option><option value="fixed">Fixed contribution</option></select></Field>{policy.mode === 'fixed' && <Field label="Fixed contribution / KSh"><input type="number" min="1" max="1000000" step="any" value={policy.fixedAmount ?? ''} onChange={event => changePolicy('fixedAmount', event.target.value === '' ? null : Number(event.target.value))} /></Field>}<label className="admin-check"><input type="checkbox" checked={Boolean(policy.creditOnCompletion)} onChange={event => changePolicy('creditOnCompletion', event.target.checked)} /><span>Credit or refund the contribution to the viewing customer when the transaction completes.</span></label><Field label="Cancellation notice / hours"><input type="number" min="0" max="168" step="1" value={policy.cancellationHours} onChange={event => changePolicy('cancellationHours', event.target.value === '' ? '' : Number(event.target.value))} /></Field></>}<p className="admin-policy-note">A return Uber trip may cost around KSh 1,000. Check your business terms before enabling a contribution. A viewing request or payment does not guarantee a property.</p></div></fieldset>
            <div className="admin-backups"><div><h4>Website backups</h4><p>Import an existing public catalogue, or download a copy of your working draft.</p></div><div className="admin-inline-actions"><button className="admin-secondary" disabled={locked || Boolean(listing)} onClick={() => importInput.current?.click()}><ArrowUpFromLine size={17} />Import website file</button><button className="admin-secondary" disabled={locked} onClick={() => download(working)}><ArrowDownToLine size={17} />Download website backup</button></div>{onOpenLocal && <div className="admin-local-backup"><p>Older customer notes and backups remain on the device where they were entered. They are not included in your shared website catalogue.</p><button className="admin-text-button" disabled={locked} onClick={openLocal}>Open local workspace<ChevronRight size={16} /></button></div>}</div>
          </>}
        </>}
        <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={importCatalogue} />
      </main>
      {working && <footer className="admin-footer"><div className="admin-footer-note"><Cloud size={18} /><div><strong>{status}</strong><span>Saving keeps a shared draft. Publishing updates the public website.</span></div></div><div className="admin-footer-actions"><button className="admin-secondary" onClick={preview} disabled={locked || Boolean(listing)}><Eye size={17} />Preview</button><button className="admin-secondary" onClick={() => writeCatalogue('save')} disabled={locked || Boolean(listing) || conflict || !dirty}>{busy === 'save' ? <LoaderCircle className="admin-spin" size={17} /> : <Save size={17} />}Save draft</button><button className="admin-primary" onClick={() => writeCatalogue('publish')} disabled={locked || Boolean(listing) || conflict || !unpublished}>{busy === 'publish' ? <LoaderCircle className="admin-spin" size={17} /> : <Upload size={17} />}Publish website</button></div></footer>}
    </>}
  </section></div>;
}

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Bath, BedDouble, Check, ChevronDown, Heart, House, Leaf, MapPin, Menu, MoveUpRight, Search, ShieldCheck, SlidersHorizontal, Square, UsersRound, X } from 'lucide-react';
import { locations as defaultLocations, categories, formatPrice, publicAsset } from './data.js';
import { useSiteConfig } from './site-config.js';
import { loadBackendConfig } from './admin-config.js';
import ViewingRequest, { ContactSection } from './ViewingRequest.jsx';
import OwnerEnquiry from './OwnerEnquiry.jsx';
import './broker.css';

const AdminPanel = lazy(() => import('./AdminPanel.jsx'));
const Workspace = lazy(() => import('./Workspace.jsx'));
const isAdminLocation = () => window.location.hash === '#admin' || /\/admin\/?$/.test(window.location.pathname);

const initialFilters = { purpose: 'all', city: '', category: '', budget: '' };
const readSaved = () => {
  try {
    const value = JSON.parse(localStorage.getItem('makao-saved') || '[]');
    return Array.isArray(value) ? value.filter(id => typeof id === 'string' || Number.isSafeInteger(id)) : [];
  } catch { return []; }
};

function Logo({ name = 'Wangechi Realty' }) {
  const [first, ...rest] = name.split(' ');
  return <a className="logo brokerage-logo" href="#" aria-label={`${name} home`}><span className="logo-mark"><House size={23} strokeWidth={1.7} /></span><span className="brokerage-wordmark"><strong>{first}</strong>{rest.length > 0 && <span>{rest.join(' ')}</span>}</span></a>;
}

function Modal({ title, onClose, children, className = '' }) {
  const panel = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const nodes = panel.current?.querySelectorAll('button:not([disabled]), a[href], input, select, textarea, [tabindex="0"]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKey); previousFocus?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}><button className="modal-close icon-button" aria-label="Close dialog" onClick={onClose}><X size={21} /></button>{children}</section></div>;
}

function PropertyCard({ property, saved, onSave, onOpen }) {
  return <article className="property-card">
    <div className="property-image-wrap"><button className="property-image-button" onClick={() => onOpen(property)} aria-label={`View ${property.title}`}><img src={property.image} alt={property.demo ? `Sample ${property.category.toLowerCase()} photograph` : `${property.title}, ${property.location}`} loading="lazy" /></button><span className={`property-tag ${property.tag === 'Featured' ? 'tag-green' : ''}`}>{property.tag === 'Featured' && <span className="tag-dot" />}{property.tag}</span><button className={`save-button ${saved ? 'is-saved' : ''}`} onClick={() => onSave(property.id)} aria-label={`${saved ? 'Unsave' : 'Save'} ${property.title}`} aria-pressed={saved}><Heart size={19} fill={saved ? 'currentColor' : 'none'} strokeWidth={1.7} /></button><span className="purpose-tag">{property.status === 'available' ? `For ${property.purpose === 'buy' ? 'sale' : 'rent'}` : ({ reserved: 'Reserved', sold: 'Sold', let: 'Let' }[property.status] || 'Available')}</span>{property.demo && <span className="sample-property-tag">Sample listing</span>}</div>
    <div className="property-content"><div className="property-price">KSh {new Intl.NumberFormat('en-KE').format(property.price)}{property.purpose === 'rent' && <span> / month</span>}</div><button className="property-title" onClick={() => onOpen(property)}>{property.title}</button><p className="property-location"><MapPin size={14} /> {property.location}</p><div className="property-bottom"><div className="property-specs">{property.category !== 'Land' && <><span><BedDouble size={17} /> {property.beds} beds</span><span><Bath size={17} /> {property.baths} baths</span></>}<span><Square size={15} /> {property.area.toLocaleString()} m²</span></div><button className="property-arrow" aria-label={`Open details for ${property.title}`} onClick={() => onOpen(property)}><ArrowUpRight size={19} /></button></div></div>
  </article>;
}

function PropertyDetails({ property, business, onClose, saved, onSave }) {
  const [selectedPhoto, setSelectedPhoto] = useState(property.image);
  const photos = [...new Set([property.image, ...(property.photos || [])])];
  useEffect(() => setSelectedPhoto(property.image), [property.id, property.image]);
  return <Modal title={property.title} onClose={onClose} className="property-modal"><img className="detail-image" src={selectedPhoto} alt={property.demo ? `Sample ${property.category.toLowerCase()} photograph` : property.title} />{photos.length > 1 && <div className="detail-gallery" role="group" aria-label="Property photographs">{photos.map((photo, index) => <button key={photo} onClick={() => setSelectedPhoto(photo)} aria-label={`View photograph ${index + 1}`} aria-pressed={selectedPhoto === photo}><img src={photo} alt="" /></button>)}</div>}<div className="detail-content">{property.demo && <p className="sample-listing-notice">Sample listing · Photos and prices are illustrative. Contact the agent for current real offers.</p>}<div className="detail-heading"><div><span className="eyebrow">{property.category} · FOR {property.purpose === 'buy' ? 'SALE' : 'RENT'}</span><h2>{property.title}</h2><p className="property-location"><MapPin size={16} />{property.location}</p></div><button className={`save-button detail-save ${saved ? 'is-saved' : ''}`} aria-label={saved ? 'Unsave property' : 'Save property'} onClick={() => onSave(property.id)} aria-pressed={saved}><Heart size={20} fill={saved ? 'currentColor' : 'none'} /></button></div><p className="detail-price">{formatPrice(property)}</p><div className="detail-specs">{property.beds > 0 && <><span><BedDouble />{property.beds} bedrooms</span><span><Bath />{property.baths} bathrooms</span></>}<span><Square />{property.area.toLocaleString()} m²</span></div><p>{property.description}</p><div className="amenities">{property.amenities.map(amenity => <span key={amenity}><Check size={15} />{amenity}</span>)}</div><ViewingRequest property={property} business={business} /></div></Modal>;
}

export default function App() {
  const { business, properties, rawConfig, loading, error: catalogueError, previewing, previewConfig, restorePublished, acceptPublished } = useSiteConfig();
  const locations = [...new Set([...defaultLocations, ...properties.map(property => property.city)])];
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(isAdminLocation);
  useEffect(() => {
    const changed = () => setAdminOpen(isAdminLocation());
    window.addEventListener('hashchange', changed);
    window.addEventListener('popstate', changed);
    return () => { window.removeEventListener('hashchange', changed); window.removeEventListener('popstate', changed); };
  }, []);
  function openAdmin() { setAdminOpen(true); window.location.hash = 'admin'; }
  function closeAdmin() {
    setAdminOpen(false);
    if (isAdminLocation()) {
      const path = /\/admin\/?$/.test(window.location.pathname) ? import.meta.env.BASE_URL : window.location.pathname;
      window.history.replaceState(null, '', path + window.location.search);
    }
  }
  async function openLocalWorkspace() {
    const backend = await loadBackendConfig();
    if (backend.configured) {
      const { createAdminService } = await import('./admin-service.js');
      const service = createAdminService(backend);
      if (!(await service.checkAdmin())) throw new Error('Sign in with an approved agent account to open local backups.');
    }
    setAdminOpen(false);
    setWorkspaceOpen(true);
  }
  const [includeUnavailable, setIncludeUnavailable] = useState(false);
  const savedCount = saved => saved.filter(id => properties.some(property => property.id === id)).length;
  useEffect(() => { document.title = `${business.name} — Homes for sale and rent in Kenya`; }, [business.name]);
  const [saved, setSaved] = useState(readSaved);
  const [draft, setDraft] = useState({ ...initialFilters, purpose: 'buy' });
  const [filters, setFilters] = useState(initialFilters);
  const [showAll, setShowAll] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [activeProperty, setActiveProperty] = useState(null);
  const [listProperty, setListProperty] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [storageMessage, setStorageMessage] = useState('');
  const listingsRef = useRef(null);
  const closeProperty = useRef(() => setActiveProperty(null)).current;
  const closeListing = useRef(() => setListProperty(false)).current;
  const isFiltered = filters.purpose !== 'all' || filters.city || filters.category || filters.budget;
  const matches = properties.filter(property => (includeUnavailable || !['sold', 'let'].includes(property.status)) && (!savedOnly || saved.includes(property.id)) && (filters.purpose === 'all' || filters.purpose === property.purpose) && (!filters.city || filters.city === property.city) && (!filters.category || filters.category === property.category) && (!filters.budget || property.price <= Number(filters.budget)));
  const visibleProperties = showAll || isFiltered || savedOnly ? matches : matches.slice(0, 3);
  function scrollToListings() { setTimeout(() => listingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20); }
  function toggleSaved(id) {
    const next = saved.includes(id) ? saved.filter(value => value !== id) : [...saved, id];
    setSaved(next);
    try { localStorage.setItem('makao-saved', JSON.stringify(next)); }
    catch { setStorageMessage('Saved for this visit. Your browser did not allow permanent storage.'); }
  }
  function search(event) { event?.preventDefault(); setFilters(draft); setSavedOnly(false); setShowAll(true); scrollToListings(); }
  function browse(purpose = 'all', city = '') { setFilters({ ...initialFilters, purpose, city }); setDraft({ ...initialFilters, purpose: purpose === 'all' ? 'buy' : purpose, city }); setSavedOnly(false); setShowAll(true); setMenuOpen(false); setExploreOpen(false); scrollToListings(); }
  function showSaved() { setSavedOnly(true); setFilters(initialFilters); setShowAll(true); setMenuOpen(false); scrollToListings(); }
  function reset() { setFilters(initialFilters); setDraft({ ...initialFilters, purpose: 'buy' }); setSavedOnly(false); setShowAll(false); setIncludeUnavailable(false); }
  const budgets = draft.purpose === 'buy' ? [[10000000, 'Up to KSh 10M'], [25000000, 'Up to KSh 25M'], [50000000, 'Up to KSh 50M'], [100000000, 'Up to KSh 100M']] : [[50000, 'Up to KSh 50,000'], [100000, 'Up to KSh 100,000'], [200000, 'Up to KSh 200,000'], [300000, 'Up to KSh 300,000']];

  return <>
    <div className="announcement"><span>A place to belong. A life to love.</span><span className="announcement-right"><span className="kenya-dot" />Rooted in Kenya</span></div>
    <header className="header"><div className="nav-container"><Logo name={business.name} /><nav className={menuOpen ? 'nav-links nav-open' : 'nav-links'} aria-label="Main navigation"><button onClick={() => browse('buy')}>Buy a home</button><button onClick={() => browse('rent')}>Rent a home</button><div className="explore-wrap"><button onClick={() => setExploreOpen(!exploreOpen)} aria-expanded={exploreOpen}>Explore locations<ChevronDown size={13} /></button>{exploreOpen && <div className="explore-menu">{locations.map(city => <button key={city} onClick={() => browse('all', city)}><MapPin size={14} />{city}</button>)}</div>}</div><a href="#about" onClick={() => setMenuOpen(false)}>About us</a></nav><div className="nav-actions"><button className="saved-nav" onClick={showSaved} aria-label={`Saved properties, ${savedCount(saved)}`}><Heart size={19} strokeWidth={1.6} /><span>Saved{savedCount(saved) > 0 && <span className="saved-count">{savedCount(saved)}</span>}</span></button><button className="button button-outline list-button" onClick={() => setListProperty(true)}>Sell or let with us<ArrowUpRight size={16} /></button><button className="mobile-menu icon-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button></div></div></header>
    <main>
      {previewing && <div className="workspace-preview-banner" role="status"><span>Workspace preview · These changes are visible only on this device.</span><button onClick={() => { restorePublished(); setActiveProperty(null); }}>Return to published website</button></div>}
      <section className="hero" aria-labelledby="hero-title"><div className="hero-image" /><div className="hero-overlay" /><div className="hero-content"><span className="hero-eyebrow"><span />{business.name.toUpperCase()} · HOMES IN KENYA</span><h1 id="hero-title">Somewhere new.<br /><em>Somewhere yours.</em></h1><p>From the energy of Nairobi to the calm of the coast,<br className="desktop-br" /> find a place that feels a little more like you.</p><a className="hero-discover" href="#properties">Discover your next home<ArrowDown size={16} /></a></div><div className="hero-note"><span className="hero-note-icon"><MapPin size={16} /></span><div><strong>A different kind of everyday.</strong><span>Find it here in Kenya.</span></div></div><span className="hero-counter">KENYA <span>· EAST AFRICA</span><span className="hero-counter-line" /></span></section>

      <section className="search-section" aria-label="Find a property"><div className="search-card"><div className="search-tabs" role="group" aria-label="Property purpose"><button className={draft.purpose === 'buy' ? 'active' : ''} aria-pressed={draft.purpose === 'buy'} onClick={() => setDraft({ ...draft, purpose: 'buy', budget: '' })}>Buy a property</button><button className={draft.purpose === 'rent' ? 'active' : ''} aria-pressed={draft.purpose === 'rent'} onClick={() => setDraft({ ...draft, purpose: 'rent', budget: '' })}>Rent a property</button><span className="search-tab-note"><ShieldCheck size={14} />A thoughtful way to find home</span></div><form className="search-form" onSubmit={search}><label className="search-field"><span><MapPin size={17} />Location</span><select aria-label="Location" value={draft.city} onChange={event => setDraft({ ...draft, city: event.target.value })}><option value="">Where do you want to live?</option>{locations.map(city => <option key={city}>{city}</option>)}</select><ChevronDown className="select-chevron" size={15} /></label><label className="search-field"><span><House size={17} />Property type</span><select aria-label="Property type" value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}><option value="">Any property type</option>{categories.map(type => <option key={type}>{type}</option>)}</select><ChevronDown className="select-chevron" size={15} /></label><label className="search-field"><span><SlidersHorizontal size={17} />Price range</span><select aria-label="Price range" value={draft.budget} onChange={event => setDraft({ ...draft, budget: event.target.value })}><option value="">Choose your budget</option>{budgets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown className="select-chevron" size={15} /></label><button className="button button-green search-button" type="submit"><Search size={18} />Find a property</button></form></div></section>

      <section className="intro-strip"><p>Great places.<br /><strong>Even better possibilities.</strong></p><div className="intro-divider" /><span><ShieldCheck size={21} />Thoughtfully selected homes</span><span><MapPin size={21} />Local knowledge, real connection</span><span><Leaf size={22} />A place for every chapter</span></section>

      <section className="properties-section container" id="properties" ref={listingsRef}><div className="section-header"><div><span className="eyebrow">{savedOnly ? 'YOUR PERSONAL SHORTLIST' : isFiltered ? 'A PLACE THAT FITS YOUR LIFE' : 'HANDPICKED FOR YOUR NEXT CHAPTER'}</span><h2>{savedOnly ? 'A few places to come back to.' : isFiltered ? 'Find your kind of place.' : 'A few places you might love.'}</h2><p>{savedOnly ? `${matches.length} ${matches.length === 1 ? 'saved property' : 'saved properties'} to explore at your own pace.` : isFiltered ? `${matches.length} ${matches.length === 1 ? 'property matches' : 'properties match'} your search${filters.city ? ` in ${filters.city}` : ''}.` : 'Distinctive homes. Desirable locations. Something that feels right.'}</p></div><button className="text-link" onClick={() => browse()}>Explore all properties<ArrowUpRight size={17} /></button></div>
        <div className="property-toolbar"><div className="category-tabs"><button className={!filters.category ? 'active' : ''} onClick={() => setFilters({ ...filters, category: '' })}>All properties</button>{[['Apartment', 'Apartments'], ['House', 'Houses'], ['Villa', 'Villas'], ['Land', 'Land']].map(([value, label]) => <button key={value} className={filters.category === value ? 'active' : ''} onClick={() => { setFilters({ ...filters, category: value }); setShowAll(true); }}>{label}</button>)}</div><span className="demo-chip">{properties.every(property => property.demo) ? 'Sample collection' : 'Our property collection'}</span></div>
        <label className="availability-toggle"><input type="checkbox" checked={includeUnavailable} onChange={event => { setIncludeUnavailable(event.target.checked); setShowAll(true); }} />Include sold and let properties</label>
        {loading && <p className="catalogue-status" role="status">Refreshing the property collection…</p>}
        {catalogueError && <p className="catalogue-status" role="status">{catalogueError}</p>}
        {(isFiltered || savedOnly) && <div className="filter-summary"><span>{savedOnly ? 'Saved properties' : [filters.purpose === 'all' ? 'Buy & rent' : filters.purpose === 'buy' ? 'For sale' : 'For rent', filters.city, filters.category, filters.budget && `Up to KSh ${Number(filters.budget).toLocaleString()}`].filter(Boolean).join(' · ')}</span><button onClick={reset}>Clear filters<X size={13} /></button></div>}
        {storageMessage && <p role="status" className="storage-message">{storageMessage}</p>}
        {visibleProperties.length ? <div className="property-grid">{visibleProperties.map(property => <PropertyCard key={property.id} property={property} saved={saved.includes(property.id)} onSave={toggleSaved} onOpen={setActiveProperty} />)}</div> : <div className="empty-state"><span><House size={32} /></span><h3>{savedOnly ? 'Your next home is waiting to be discovered.' : 'A little more room in your search?'}</h3><p>{savedOnly ? 'Tap the heart on a property to keep it in your shortlist.' : 'Try another location, property type or price range.'}</p><button className="button button-green" onClick={() => browse()}>{savedOnly ? 'Explore properties' : 'View all properties'}<ArrowRight size={16} /></button></div>}
        {!showAll && !isFiltered && !savedOnly && <div className="collection-note"><span>There's more to discover.</span><button onClick={() => setShowAll(true)}>View all {properties.length} properties<ArrowRight size={15} /></button></div>}
      </section>

      <section className="places-section"><div className="container"><div className="section-header"><div><span className="eyebrow">FIND YOUR CORNER OF KENYA</span><h2>Different places. Endless possibility.</h2><p>A city heartbeat or an ocean breeze. Where will you feel at home?</p></div><span className="places-label">ONE COUNTRY. SO MANY WAYS TO LIVE.</span></div><div className="places-grid">{[{ city: 'Nairobi', subtitle: 'The energy of the city', image: publicAsset('images/property-1.jpg'), number: '01' }, { city: 'Mombasa', subtitle: 'Life on the sunny side', image: publicAsset('images/property-4.jpg'), number: '02' }, { city: 'Kilifi', subtitle: 'A slower kind of beautiful', image: publicAsset('images/property-2.jpg'), number: '03' }, { city: 'Kisumu', subtitle: 'A fresh perspective', image: publicAsset('images/property-7.jpg'), number: '04' }].map(place => <button className="place-card" key={place.city} onClick={() => browse('all', place.city)}><img src={place.image} alt="" loading="lazy" /><span className="place-number">{place.number}</span><div><span>{place.subtitle}</span><h3>{place.city}<ArrowUpRight size={25} /></h3></div></button>)}</div></div></section>

      <section className="about-section container" id="about"><div className="about-intro"><span className="eyebrow">A LITTLE MORE PERSONAL</span><h2>Home is more<br />than an address.</h2><p>It's where your mornings begin, where your people gather, and where the next chapter takes shape. We believe finding it should feel just as considered.</p><a className="text-link" href="#properties">Let's find your place<ArrowUpRight size={17} /></a></div><div className="about-features"><div><span className="feature-icon"><MapPin size={24} /></span><section><h3>Kenya, close to heart.</h3><p>Explore neighbourhoods and lifestyles across the country, from busy city streets to quiet coastal corners.</p></section></div><div><span className="feature-icon"><UsersRound size={24} /></span><section><h3>Your next chapter, your way.</h3><p>A first apartment, room for a growing family, or a little space to start again. Find what works for you.</p></section></div><div><span className="feature-icon"><ShieldCheck size={24} /></span><section><h3>A clearer way forward.</h3><p>Simple search, useful details, and a shortlist you can come back to. Take your time, feel at home.</p></section></div></div></section>

      <section className="listing-banner container"><div><span className="eyebrow">HAVE A PLACE SOMEONE WILL LOVE?</span><h2>Open the door to new possibilities.</h2><p>Talk to us about a marketing plan for your property.</p></div><button className="button button-light" onClick={() => setListProperty(true)}>Sell or let with us<ArrowUpRight size={18} /></button><House className="banner-house" strokeWidth={0.65} /></section>
      <ContactSection business={business} />
    </main>
    <footer className="footer container"><div className="footer-top"><div><Logo name={business.name} /><p>Find your place.<br />Feel at home.</p></div><nav aria-label="Footer properties"><h3>Find a property</h3><button onClick={() => browse('buy')}>Homes for sale</button><button onClick={() => browse('rent')}>Homes for rent</button><button onClick={showSaved}>Your saved properties</button></nav><nav aria-label="Footer locations"><h3>Explore Kenya</h3>{locations.map(city => <button key={city} onClick={() => browse('all', city)}>{city}</button>)}</nav><div className="footer-note"><span className="kenya-dot" /><p>Made for life's<br />next adventure.</p><span>Karibu nyumbani. Welcome home.</span></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} {business.name}. A little closer to home.</span><span>Sample properties are clearly marked</span><button className="workspace-footer-link" onClick={openAdmin}>Agent login</button><a href="#">Back to top<MoveUpRight size={13} /></a></div></footer>
    {activeProperty && <PropertyDetails property={activeProperty} business={business} onClose={closeProperty} saved={saved.includes(activeProperty.id)} onSave={toggleSaved} />}
    {listProperty && <Modal title="Property owner enquiry" onClose={closeListing}><OwnerEnquiry business={business} /></Modal>}
    {(adminOpen || workspaceOpen) && <Suspense fallback={<Modal title="Agent workspace" onClose={closeAdmin}><div className="detail-content"><p role="status">Opening the agent workspace…</p></div></Modal>}>
      {adminOpen && <AdminPanel initialConfig={rawConfig} onPreview={value => { previewConfig(value); setActiveProperty(null); }} onPublished={value => { acceptPublished(value); setActiveProperty(null); }} onOpenLocal={openLocalWorkspace} onClose={closeAdmin} />}
      {workspaceOpen && <Workspace initialConfig={rawConfig} onPreview={value => { previewConfig(value); setActiveProperty(null); }} onClose={() => { setWorkspaceOpen(false); openAdmin(); }} />}
    </Suspense>}
  </>;
}

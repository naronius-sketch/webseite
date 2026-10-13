import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Bath, BedDouble, Check, CheckCheck, ChevronDown, Heart, House, Leaf, MapPin, Menu, MoveUpRight, Search, ShieldCheck, SlidersHorizontal, Square, UsersRound, X } from 'lucide-react';
import { properties, locations, categories, formatPrice, publicAsset } from './data.js';

const initialFilters = { purpose: 'all', city: '', category: '', budget: '' };
const readSaved = () => {
  try {
    const value = JSON.parse(localStorage.getItem('makao-saved') || '[]');
    return Array.isArray(value) ? value.filter(id => properties.some(p => p.id === id)) : [];
  } catch { return []; }
};

function Logo({ light = false }) {
  return <a className={`logo ${light ? 'logo-light' : ''}`} href="#" aria-label="Makao home"><span className="logo-mark"><House size={23} strokeWidth={1.7} /></span>makao<span className="logo-dot">.</span></a>;
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
    <div className="property-image-wrap"><button className="property-image-button" onClick={() => onOpen(property)} aria-label={`View ${property.title}`}><img src={property.image} alt={`${property.category} illustration for ${property.location}`} loading="lazy" /></button><span className={`property-tag ${property.tag === 'Featured' ? 'tag-green' : ''}`}>{property.tag === 'Featured' && <span className="tag-dot" />}{property.tag}</span><button className={`save-button ${saved ? 'is-saved' : ''}`} onClick={() => onSave(property.id)} aria-label={`${saved ? 'Unsave' : 'Save'} ${property.title}`} aria-pressed={saved}><Heart size={19} fill={saved ? 'currentColor' : 'none'} strokeWidth={1.7} /></button><span className="purpose-tag">For {property.purpose === 'buy' ? 'sale' : 'rent'}</span></div>
    <div className="property-content"><div className="property-price">KSh {new Intl.NumberFormat('en-KE').format(property.price)}{property.purpose === 'rent' && <span> / month</span>}</div><button className="property-title" onClick={() => onOpen(property)}>{property.title}</button><p className="property-location"><MapPin size={14} /> {property.location}</p><div className="property-bottom"><div className="property-specs">{property.category !== 'Land' && <><span><BedDouble size={17} /> {property.beds} beds</span><span><Bath size={17} /> {property.baths} baths</span></>}<span><Square size={15} /> {property.area.toLocaleString()} m²</span></div><button className="property-arrow" aria-label={`Open details for ${property.title}`} onClick={() => onOpen(property)}><ArrowUpRight size={19} /></button></div></div>
  </article>;
}

function DownloadButton({ data, name, children }) {
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <button className="button button-green" onClick={download}>{children}<ArrowDown size={17} /></button>;
}

function ListingForm({ onClose }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const draft = { ...values, createdAt: new Date().toISOString(), status: 'draft' };
    try { localStorage.setItem('makao-listing-draft', JSON.stringify(draft)); setResult(draft); }
    catch { setError('Your browser could not save this draft. Please allow local storage and try again.'); }
  }
  return <Modal title="List your property" onClose={onClose}><div className="modal-form-content">{result ? <><div className="success-icon"><CheckCheck /></div><span className="eyebrow">A GOOD FIRST STEP</span><h2>Your listing draft is ready.</h2><p>We've saved your draft on this device. Download a copy to keep or share with your property advisor.</p><p className="form-note">This demo does not publish listings or send your details.</p><DownloadButton data={result} name="makao-property-draft.json">Download your draft</DownloadButton></> : <><span className="eyebrow">OPEN THE DOOR TO WHAT'S NEXT</span><h2>Give your property<br />a new beginning.</h2><p>Tell us a little about your place and create a listing draft.</p><form className="contact-form" onSubmit={submit}><label>Property title<input name="title" placeholder="e.g. A leafy family home in Karen" required maxLength={120} /></label><div className="form-row"><label>Location<select name="city" required><option value="">Choose a location</option>{locations.map(city => <option key={city}>{city}</option>)}</select></label><label>Property type<select name="category">{categories.map(type => <option key={type}>{type}</option>)}</select></label></div><div className="form-row"><label>Offer type<select name="purpose"><option value="buy">For sale</option><option value="rent">For rent</option></select></label><label>Price in KSh<input type="number" name="price" placeholder="e.g. 25000000" min="1" required /></label></div><label>Your email<input type="email" name="email" placeholder="you@example.com" required /></label><label>A few details<textarea name="description" placeholder="What makes this place special?" rows={3} maxLength={1000} /></label><p className="form-note">Demo listing: saved as a draft, never published automatically.</p>{error && <p role="alert" className="form-error">{error}</p>}<button className="button button-green" type="submit">Create listing draft<ArrowRight size={17} /></button></form></>}</div></Modal>;
}

function PropertyDetails({ property, onClose, saved, onSave }) {
  const [request, setRequest] = useState(null);
  const [requestError, setRequestError] = useState('');
  function submit(event) {
    event.preventDefault();
    const details = { ...Object.fromEntries(new FormData(event.currentTarget)), property: property.title, location: property.location, price: formatPrice(property), status: 'draft', createdAt: new Date().toISOString() };
    try { localStorage.setItem('makao-viewing-draft', JSON.stringify(details)); setRequest(details); }
    catch { setRequestError('This browser could not save your request. Please allow local storage and try again.'); }
  }
  return <Modal title={property.title} onClose={onClose} className="property-modal"><img className="detail-image" src={property.image} alt={`Illustrative ${property.category.toLowerCase()}`} /><div className="detail-content"><div className="detail-heading"><div><span className="eyebrow">{property.category} · FOR {property.purpose === 'buy' ? 'SALE' : 'RENT'}</span><h2>{property.title}</h2><p className="property-location"><MapPin size={16} />{property.location}</p></div><button className={`save-button detail-save ${saved ? 'is-saved' : ''}`} aria-label={saved ? 'Unsave property' : 'Save property'} onClick={() => onSave(property.id)} aria-pressed={saved}><Heart size={20} fill={saved ? 'currentColor' : 'none'} /></button></div><p className="detail-price">{formatPrice(property)}</p><div className="detail-specs">{property.beds > 0 && <><span><BedDouble />{property.beds} bedrooms</span><span><Bath />{property.baths} bathrooms</span></>}<span><Square />{property.area.toLocaleString()} m²</span></div><p>{property.description}</p><div className="amenities">{property.amenities.map(amenity => <span key={amenity}><Check size={15} />{amenity}</span>)}</div><div className="viewing-form">{request ? <><h3>Your viewing request is ready.</h3><p>Your draft is saved on this device. Download it to share with your advisor. Nothing has been sent.</p><DownloadButton data={request} name="makao-viewing-request.json">Download request</DownloadButton></> : <><h3>Picture yourself here?</h3><p>Prepare a viewing enquiry for this demonstration property.</p><form className="contact-form" onSubmit={submit}><div className="form-row"><label>Your name<input name="name" autoComplete="name" required placeholder="Full name" /></label><label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label></div><label>Message<textarea name="message" rows={2} defaultValue={`I'd like to arrange a viewing of this property.`} required /></label><p className="form-note">Illustrative listing. This demo saves an enquiry draft without sending it.</p>{requestError && <p role="alert" className="form-error">{requestError}</p>}<button className="button button-green">Save viewing request<ArrowRight size={17} /></button></form></>}</div></div></Modal>;
}

export default function App() {
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
  const matches = properties.filter(property => (!savedOnly || saved.includes(property.id)) && (filters.purpose === 'all' || filters.purpose === property.purpose) && (!filters.city || filters.city === property.city) && (!filters.category || filters.category === property.category) && (!filters.budget || property.price <= Number(filters.budget)));
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
  function reset() { setFilters(initialFilters); setDraft({ ...initialFilters, purpose: 'buy' }); setSavedOnly(false); setShowAll(false); }
  const budgets = draft.purpose === 'buy' ? [[10000000, 'Up to KSh 10M'], [25000000, 'Up to KSh 25M'], [50000000, 'Up to KSh 50M'], [100000000, 'Up to KSh 100M']] : [[50000, 'Up to KSh 50,000'], [100000, 'Up to KSh 100,000'], [200000, 'Up to KSh 200,000'], [300000, 'Up to KSh 300,000']];

  return <>
    <div className="announcement"><span>A place to belong. A life to love.</span><span className="announcement-right"><span className="kenya-dot" />Rooted in Kenya</span></div>
    <header className="header"><div className="nav-container"><Logo /><nav className={menuOpen ? 'nav-links nav-open' : 'nav-links'} aria-label="Main navigation"><button onClick={() => browse('buy')}>Buy a home</button><button onClick={() => browse('rent')}>Rent a home</button><div className="explore-wrap"><button onClick={() => setExploreOpen(!exploreOpen)} aria-expanded={exploreOpen}>Explore locations<ChevronDown size={13} /></button>{exploreOpen && <div className="explore-menu">{locations.map(city => <button key={city} onClick={() => browse('all', city)}><MapPin size={14} />{city}</button>)}</div>}</div><a href="#about" onClick={() => setMenuOpen(false)}>Why Makao</a></nav><div className="nav-actions"><button className="saved-nav" onClick={showSaved} aria-label={`Saved properties, ${saved.length}`}><Heart size={19} strokeWidth={1.6} /><span>Saved{saved.length > 0 && <span className="saved-count">{saved.length}</span>}</span></button><button className="button button-outline list-button" onClick={() => setListProperty(true)}>List your property<ArrowUpRight size={16} /></button><button className="mobile-menu icon-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button></div></div></header>
    <main>
      <section className="hero" aria-labelledby="hero-title"><div className="hero-image" /><div className="hero-overlay" /><div className="hero-content"><span className="hero-eyebrow"><span />YOUR NEXT CHAPTER STARTS HERE</span><h1 id="hero-title">Somewhere new.<br /><em>Somewhere yours.</em></h1><p>From the energy of Nairobi to the calm of the coast,<br className="desktop-br" /> find a place that feels a little more like you.</p><a className="hero-discover" href="#properties">Discover your next home<ArrowDown size={16} /></a></div><div className="hero-note"><span className="hero-note-icon"><MapPin size={16} /></span><div><strong>A different kind of everyday.</strong><span>Find it here in Kenya.</span></div></div><span className="hero-counter">KENYA <span>· EAST AFRICA</span><span className="hero-counter-line" /></span></section>

      <section className="search-section" aria-label="Find a property"><div className="search-card"><div className="search-tabs" role="group" aria-label="Property purpose"><button className={draft.purpose === 'buy' ? 'active' : ''} aria-pressed={draft.purpose === 'buy'} onClick={() => setDraft({ ...draft, purpose: 'buy', budget: '' })}>Buy a property</button><button className={draft.purpose === 'rent' ? 'active' : ''} aria-pressed={draft.purpose === 'rent'} onClick={() => setDraft({ ...draft, purpose: 'rent', budget: '' })}>Rent a property</button><span className="search-tab-note"><ShieldCheck size={14} />A thoughtful way to find home</span></div><form className="search-form" onSubmit={search}><label className="search-field"><span><MapPin size={17} />Location</span><select aria-label="Location" value={draft.city} onChange={event => setDraft({ ...draft, city: event.target.value })}><option value="">Where do you want to live?</option>{locations.map(city => <option key={city}>{city}</option>)}</select><ChevronDown className="select-chevron" size={15} /></label><label className="search-field"><span><House size={17} />Property type</span><select aria-label="Property type" value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}><option value="">Any property type</option>{categories.map(type => <option key={type}>{type}</option>)}</select><ChevronDown className="select-chevron" size={15} /></label><label className="search-field"><span><SlidersHorizontal size={17} />Price range</span><select aria-label="Price range" value={draft.budget} onChange={event => setDraft({ ...draft, budget: event.target.value })}><option value="">Choose your budget</option>{budgets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown className="select-chevron" size={15} /></label><button className="button button-green search-button" type="submit"><Search size={18} />Find a property</button></form></div></section>

      <section className="intro-strip"><p>Great places.<br /><strong>Even better possibilities.</strong></p><div className="intro-divider" /><span><ShieldCheck size={21} />Thoughtfully selected homes</span><span><MapPin size={21} />Local knowledge, real connection</span><span><Leaf size={22} />A place for every chapter</span></section>

      <section className="properties-section container" id="properties" ref={listingsRef}><div className="section-header"><div><span className="eyebrow">{savedOnly ? 'YOUR PERSONAL SHORTLIST' : isFiltered ? 'A PLACE THAT FITS YOUR LIFE' : 'HANDPICKED FOR YOUR NEXT CHAPTER'}</span><h2>{savedOnly ? 'A few places to come back to.' : isFiltered ? 'Find your kind of place.' : 'A few places you might love.'}</h2><p>{savedOnly ? `${matches.length} ${matches.length === 1 ? 'saved property' : 'saved properties'} to explore at your own pace.` : isFiltered ? `${matches.length} ${matches.length === 1 ? 'property matches' : 'properties match'} your search${filters.city ? ` in ${filters.city}` : ''}.` : 'Distinctive homes. Desirable locations. Something that feels right.'}</p></div><button className="text-link" onClick={() => browse()}>Explore all properties<ArrowUpRight size={17} /></button></div>
        <div className="property-toolbar"><div className="category-tabs"><button className={!filters.category ? 'active' : ''} onClick={() => setFilters({ ...filters, category: '' })}>All properties</button>{[['Apartment', 'Apartments'], ['House', 'Houses'], ['Villa', 'Villas'], ['Land', 'Land']].map(([value, label]) => <button key={value} className={filters.category === value ? 'active' : ''} onClick={() => { setFilters({ ...filters, category: value }); setShowAll(true); }}>{label}</button>)}</div><span className="demo-chip">Demo collection</span></div>
        {(isFiltered || savedOnly) && <div className="filter-summary"><span>{savedOnly ? 'Saved properties' : [filters.purpose === 'all' ? 'Buy & rent' : filters.purpose === 'buy' ? 'For sale' : 'For rent', filters.city, filters.category, filters.budget && `Up to KSh ${Number(filters.budget).toLocaleString()}`].filter(Boolean).join(' · ')}</span><button onClick={reset}>Clear filters<X size={13} /></button></div>}
        {storageMessage && <p role="status" className="storage-message">{storageMessage}</p>}
        {visibleProperties.length ? <div className="property-grid">{visibleProperties.map(property => <PropertyCard key={property.id} property={property} saved={saved.includes(property.id)} onSave={toggleSaved} onOpen={setActiveProperty} />)}</div> : <div className="empty-state"><span><House size={32} /></span><h3>{savedOnly ? 'Your next home is waiting to be discovered.' : 'A little more room in your search?'}</h3><p>{savedOnly ? 'Tap the heart on a property to keep it in your shortlist.' : 'Try another location, property type or price range.'}</p><button className="button button-green" onClick={() => browse()}>{savedOnly ? 'Explore properties' : 'View all properties'}<ArrowRight size={16} /></button></div>}
        {!showAll && !isFiltered && !savedOnly && <div className="collection-note"><span>There's more to discover.</span><button onClick={() => setShowAll(true)}>View all {properties.length} properties<ArrowRight size={15} /></button></div>}
      </section>

      <section className="places-section"><div className="container"><div className="section-header"><div><span className="eyebrow">FIND YOUR CORNER OF KENYA</span><h2>Different places. Endless possibility.</h2><p>A city heartbeat or an ocean breeze. Where will you feel at home?</p></div><span className="places-label">ONE COUNTRY. SO MANY WAYS TO LIVE.</span></div><div className="places-grid">{[{ city: 'Nairobi', subtitle: 'The energy of the city', image: publicAsset('images/property-1.jpg'), number: '01' }, { city: 'Mombasa', subtitle: 'Life on the sunny side', image: publicAsset('images/property-4.jpg'), number: '02' }, { city: 'Kilifi', subtitle: 'A slower kind of beautiful', image: publicAsset('images/property-2.jpg'), number: '03' }, { city: 'Kisumu', subtitle: 'A fresh perspective', image: publicAsset('images/property-7.jpg'), number: '04' }].map(place => <button className="place-card" key={place.city} onClick={() => browse('all', place.city)}><img src={place.image} alt="" loading="lazy" /><span className="place-number">{place.number}</span><div><span>{place.subtitle}</span><h3>{place.city}<ArrowUpRight size={25} /></h3></div></button>)}</div></div></section>

      <section className="about-section container" id="about"><div className="about-intro"><span className="eyebrow">A LITTLE MORE PERSONAL</span><h2>Home is more<br />than an address.</h2><p>It's where your mornings begin, where your people gather, and where the next chapter takes shape. We believe finding it should feel just as considered.</p><a className="text-link" href="#properties">Let's find your place<ArrowUpRight size={17} /></a></div><div className="about-features"><div><span className="feature-icon"><MapPin size={24} /></span><section><h3>Kenya, close to heart.</h3><p>Explore neighbourhoods and lifestyles across the country, from busy city streets to quiet coastal corners.</p></section></div><div><span className="feature-icon"><UsersRound size={24} /></span><section><h3>Your next chapter, your way.</h3><p>A first apartment, room for a growing family, or a little space to start again. Find what works for you.</p></section></div><div><span className="feature-icon"><ShieldCheck size={24} /></span><section><h3>A clearer way forward.</h3><p>Simple search, useful details, and a shortlist you can come back to. Take your time, feel at home.</p></section></div></div></section>

      <section className="listing-banner container"><div><span className="eyebrow">HAVE A PLACE SOMEONE WILL LOVE?</span><h2>Open the door to new possibilities.</h2><p>Your property's next chapter could start here.</p></div><button className="button button-light" onClick={() => setListProperty(true)}>List your property<ArrowUpRight size={18} /></button><House className="banner-house" strokeWidth={0.65} /></section>
    </main>
    <footer className="footer container"><div className="footer-top"><div><Logo /><p>Find your place.<br />Feel at home.</p></div><nav aria-label="Footer properties"><h3>Find a property</h3><button onClick={() => browse('buy')}>Homes for sale</button><button onClick={() => browse('rent')}>Homes for rent</button><button onClick={showSaved}>Your saved properties</button></nav><nav aria-label="Footer locations"><h3>Explore Kenya</h3>{locations.map(city => <button key={city} onClick={() => browse('all', city)}>{city}</button>)}</nav><div className="footer-note"><span className="kenya-dot" /><p>Made for life's<br />next adventure.</p><span>Karibu nyumbani. Welcome home.</span></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Makao. A little closer to home.</span><span>Demonstration website · Illustrative photos and listings</span><a href="#">Back to top<MoveUpRight size={13} /></a></div></footer>
    {activeProperty && <PropertyDetails property={activeProperty} onClose={closeProperty} saved={saved.includes(activeProperty.id)} onSave={toggleSaved} />}
    {listProperty && <ListingForm onClose={closeListing} />}
  </>;
}

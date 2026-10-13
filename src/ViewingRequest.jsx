import { useId, useRef, useState } from 'react';
import { ArrowUpRight, CalendarDays, Check, Mail, MessageCircle, Phone, ShieldCheck } from 'lucide-react';
import { buildViewingMessage, contactLinks, getViewingFeeQuote, safeContactEmail } from './broker-model.js';
import './viewing.css';

function nairobiToday() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function ContactButtons({ links, primaryLabel = 'Continue on WhatsApp', className = '' }) {
  return <div className={`viewing-contact-actions ${className}`}>
    {links.whatsapp && <a className="button button-green" href={links.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle size={17} />{primaryLabel}<ArrowUpRight size={16} /></a>}
    {links.email && <a className="button button-outline" href={links.email}><Mail size={17} />Open email draft</a>}
    {links.tel && <a className="viewing-call-link" href={links.tel}><Phone size={15} />Call the agent</a>}
  </div>;
}

function ViewingPolicy({ quote }) {
  return <aside className="viewing-policy" aria-label="Viewing and transport arrangements">
    <span className="viewing-policy-icon"><ShieldCheck size={19} /></span>
    <div><strong>{quote.label}</strong>
      <p>{quote.kind === 'disabled'
        ? 'Any transport contribution is agreed before the appointment. This website does not collect payments.'
        : quote.kind === 'fixed'
          ? 'Agree to this contribution before the appointment is confirmed. Only pay after the agent confirms availability and you agree to the arrangements. This website does not collect payments.'
          : quote.detail}</p>
      {quote.kind === 'fixed' && <div className="viewing-policy-terms">
        {quote.creditOnCompletion && <p>On completion, the contribution is credited against your agreed agency fee, or refunded to you if you owe no agency fee.</p>}
        <p>{quote.cancellationHours > 0
          ? `Cancel at least ${quote.cancellationHours} hours before the agreed visit for a refund of the transport contribution. Late cancellation or a missed visit may forfeit the contribution.`
          : 'Cancellation and refund arrangements must be confirmed with the agent before payment.'}</p>
        <p>If the agent cancels a paid visit, the transport contribution is refunded. The agent confirms availability and any payment instructions before travel.</p>
      </div>}
    </div>
  </aside>;
}

export default function ViewingRequest({ property, business = {} }) {
  const uid = useId();
  const formRef = useRef(null);
  const resultRef = useRef(null);
  const [errors, setErrors] = useState({});
  const [draft, setDraft] = useState({});
  const [prepared, setPrepared] = useState(null);
  const [copyStatus, setCopyStatus] = useState('');
  const quote = getViewingFeeQuote(business.viewingPolicy);
  const contact = contactLinks(business);
  const today = nairobiToday();
  const unavailable = ['sold', 'let'].includes(property?.status);
  const reserved = property?.status === 'reserved';
  const hasContact = Boolean(contact.whatsapp || contact.email);
  const id = name => `${uid}-${name}`;
  const fieldAttributes = name => ({
    id: id(name), 'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? id(`${name}-error`) : undefined,
  });
  const error = name => errors[name] && <span id={id(`${name}-error`)} className="viewing-field-error">{errors[name]}</span>;

  function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const form = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
    form.feeAccepted = values.feeAccepted === 'on';
    setDraft(form);
    const nextErrors = {};
    if (!form.name || form.name.length < 2) nextErrors.name = 'Please enter your name.';
    if (!form.email && !form.phone) nextErrors.email = 'Add an email address or a phone number so the agent can reply.';
    if (form.email && !safeContactEmail(form.email)) nextErrors.email = 'Please enter a valid email address.';
    if (form.phone && (!/^[+\d][\d\s()-]{6,24}$/.test(form.phone) || form.phone.replace(/\D/g, '').length < 7 || form.phone.replace(/\D/g, '').length > 15)) nextErrors.phone = 'Please enter a valid phone number, including your country code if outside Kenya.';
    if (!isCalendarDate(form.date) || form.date < today) nextErrors.date = 'Choose today or a future date in Kenya.';
    if (!['Morning', 'Afternoon', 'Flexible'].includes(form.time)) nextErrors.time = 'Choose your preferred time.';
    if (!['buy', 'rent'].includes(form.purpose)) nextErrors.purpose = 'Choose buying or renting.';
    if (form.budget && (!Number.isFinite(Number(form.budget)) || Number(form.budget) <= 0 || Number(form.budget) > 1000000000000)) nextErrors.budget = 'Enter a positive budget in KSh.';
    if (form.moveInDate && (!isCalendarDate(form.moveInDate) || form.moveInDate < today)) nextErrors.moveInDate = 'Choose today or a future move-in date.';
    if (form.moveInDate && form.date && form.moveInDate < form.date) nextErrors.moveInDate = 'Your preferred move-in date should be on or after the viewing date.';
    if (quote.requiresAcceptance && !form.feeAccepted) nextErrors.feeAccepted = 'Please agree to the disclosed contribution and cancellation terms to continue.';
    if (!hasContact) nextErrors.contact = 'Online enquiries are temporarily unavailable. Please check back for the agent’s contact details.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const first = Object.keys(nextErrors)[0];
      formRef.current?.elements.namedItem(first)?.focus();
      return;
    }
    const message = buildViewingMessage({ property, form, feeQuote: quote });
    setPrepared({ message, links: contactLinks(business, message) });
    setCopyStatus('');
    requestAnimationFrame(() => resultRef.current?.focus());
  }

  async function copyMessage() {
    try { await navigator.clipboard.writeText(prepared.message); setCopyStatus('Message copied. Paste it into your conversation with the agent.'); }
    catch { setCopyStatus('Select the message below and copy it to your conversation.'); }
  }

  if (unavailable) return <section className="viewing-request viewing-unavailable" aria-label="Viewing availability">
    <CalendarDays size={25} /><h3>This property has been {property.status === 'sold' ? 'sold' : 'let'}.</h3>
    <p>A viewing is no longer available. Contact {business.name || 'the agent'} about similar properties.</p>
    <ContactButtons links={contactLinks(business, `Hello ${business.name || ''}, I’m interested in alternatives to ${property.title} in ${property.location}. Please let me know what is currently available.`)} primaryLabel="Ask about similar homes" />
  </section>;

  return <section className="viewing-request" aria-labelledby={id('heading')}>
    <div className="viewing-request-heading"><span className="viewing-heading-icon"><CalendarDays size={23} /></span><div><span className="eyebrow">YOUR NEXT STEP</span><h3 id={id('heading')}>{reserved ? 'Ask about availability.' : 'See it for yourself.'}</h3></div></div>
    <p className="viewing-intro">{reserved ? 'This property is reserved. Ask the agent whether a viewing or a similar home is available.' : 'Share a little about your search. The agent will personally confirm availability and arrange your visit.'}</p>
    {property.demo && <p className="viewing-demo-notice">This is an illustrative listing. Your enquiry can start a conversation about real available properties.</p>}
    <ViewingPolicy quote={quote} />
    {prepared ? <div className="viewing-ready" ref={resultRef} tabIndex={-1} role="status">
      <span className="viewing-ready-icon"><Check size={24} /></span>
      <h4>Your viewing request is ready.</h4><p>Send it on WhatsApp or email. Your appointment is confirmed personally by the agent.</p>
      <ContactButtons links={prepared.links} />
      <details className="viewing-message"><summary>Review your message</summary><pre>{prepared.message}</pre></details>
      <div className="viewing-ready-tools"><button type="button" onClick={() => { setPrepared(null); setErrors({}); }}>Edit request</button><button type="button" onClick={copyMessage}>Copy message</button></div>
      {copyStatus && <p className="viewing-copy-status" role="status">{copyStatus}</p>}
      <p className="viewing-privacy">Sending via WhatsApp or email opens your chosen provider. Your request is not sent automatically.</p>
    </div> : <form className="viewing-request-form" ref={formRef} onSubmit={submit} noValidate>
      <label htmlFor={id('name')}><span>Your name <span className="viewing-required">*</span></span><input {...fieldAttributes('name')} name="name" autoComplete="name" defaultValue={draft.name || ''} placeholder="Your full name" maxLength={100} required />{error('name')}</label>
      <fieldset className="viewing-contact-fields"><legend>How can we reach you? <span>Add an email or phone number.</span></legend><div className="viewing-fields-row">
        <label htmlFor={id('email')}>Email<input {...fieldAttributes('email')} name="email" type="email" autoComplete="email" defaultValue={draft.email || ''} placeholder="you@example.com" maxLength={254} />{error('email')}</label>
        <label htmlFor={id('phone')}>Phone / WhatsApp<input {...fieldAttributes('phone')} name="phone" type="tel" autoComplete="tel" defaultValue={draft.phone || ''} placeholder="+254 …" maxLength={25} />{error('phone')}</label>
      </div></fieldset>
      <div className="viewing-fields-row"><label htmlFor={id('purpose')}>I’m looking to<select {...fieldAttributes('purpose')} name="purpose" defaultValue={draft.purpose || property.purpose}><option value="buy">Buy a property</option><option value="rent">Rent a property</option></select>{error('purpose')}</label><label htmlFor={id('budget')}><span>Maximum budget <span className="viewing-optional">(KSh, optional)</span></span><input {...fieldAttributes('budget')} type="number" name="budget" min="1" max="1000000000000" step="1" inputMode="numeric" defaultValue={draft.budget || ''} placeholder={property.purpose === 'rent' ? 'Monthly rent budget' : 'Purchase budget'} />{error('budget')}</label></div>
      <div className="viewing-fields-row"><label htmlFor={id('date')}><span>Preferred viewing date <span className="viewing-required">*</span></span><input {...fieldAttributes('date')} name="date" type="date" min={today} defaultValue={draft.date || ''} required />{error('date')}</label><label htmlFor={id('time')}>Preferred time<select {...fieldAttributes('time')} name="time" defaultValue={draft.time || 'Flexible'}><option value="Flexible">I’m flexible</option><option value="Morning">Morning · 9 am–12 pm</option><option value="Afternoon">Afternoon · 12 pm–5 pm</option></select>{error('time')}</label></div>
      <p className="viewing-timezone">All viewing times are in Kenya time (EAT · UTC+3). Preferred times are requests, subject to confirmation.</p>
      <label htmlFor={id('moveInDate')}><span>Preferred move-in date <span className="viewing-optional">(optional)</span></span><input {...fieldAttributes('moveInDate')} name="moveInDate" type="date" min={today} defaultValue={draft.moveInDate || ''} />{error('moveInDate')}</label>
      <label htmlFor={id('message')}><span>Anything else we should know? <span className="viewing-optional">(optional)</span></span><textarea {...fieldAttributes('message')} name="message" rows={3} maxLength={1500} defaultValue={draft.message || ''} placeholder="Your preferred neighbourhood, questions, or another time that suits you." /></label>
      {quote.requiresAcceptance && <label className="viewing-consent" htmlFor={id('feeAccepted')}><input {...fieldAttributes('feeAccepted')} type="checkbox" name="feeAccepted" defaultChecked={draft.feeAccepted === true} required /><span>I agree to the disclosed transport contribution of KSh {new Intl.NumberFormat('en-KE').format(quote.amount)} and cancellation terms, subject to the agent confirming the appointment.{error('feeAccepted')}</span></label>}
      <p className="viewing-privacy">We use your details to respond to this enquiry. Sending via WhatsApp or email opens your chosen provider. This form does not make a booking or collect a payment.</p>
      {errors.contact && <p className="viewing-field-error" role="alert">{errors.contact}</p>}
      {!hasContact && !errors.contact && <p className="viewing-field-error">Online enquiries are temporarily unavailable. Please check back for the agent’s contact details.</p>}
      <button className="button button-green viewing-prepare-button" type="submit" disabled={!hasContact}>{reserved ? 'Prepare availability enquiry' : 'Prepare viewing request'}<ArrowUpRight size={17} /></button>
      <span className="viewing-submit-note">Next, choose WhatsApp or email to send your request.</span>
    </form>}
  </section>;
}

export function ContactSection({ business = {} }) {
  const message = `Hello ${business.name || ''}, I’d like your help finding a property in ${business.serviceArea || 'Kenya'}.`;
  const links = contactLinks(business, message);
  return <section className="broker-contact-section container" id="contact" aria-labelledby="broker-contact-title">
    <div className="broker-contact-intro"><span className="eyebrow">A CONVERSATION AWAY</span><h2 id="broker-contact-title">Your search.<br /><em>A personal touch.</em></h2><p>Buying, renting, or finding the right person for your property? Speak directly with {business.name || 'your property agent'} and plan the next step together.</p><span className="broker-contact-region">{business.serviceArea || 'Kenya'} · Personal property guidance</span></div>
    <div className="broker-contact-card"><span className="broker-monogram" aria-hidden="true">{(business.name || 'Wangechi Realty').split(/\s+/).slice(0, 2).map(part => part[0]).join('')}</span><div><span className="broker-card-eyebrow">LET’S TALK PROPERTY</span><h3>{business.name || 'Your property agent'}</h3>{business.agentName && <p className="broker-agent-name">{business.agentName}</p>}</div>
      <p className="broker-card-description">Tell us what you have in mind. We’ll discuss suitable properties, availability, and viewing arrangements with you.</p>
      {links.whatsapp && <a className="button button-green broker-whatsapp" href={links.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} />Chat on WhatsApp<ArrowUpRight size={17} /></a>}
      <div className="broker-direct-contacts">{links.tel && <a href={links.tel}><Phone size={16} /><span>{business.whatsapp}</span></a>}{links.email && <a href={links.email}><Mail size={16} /><span>{safeContactEmail(business.email)}</span></a>}</div>
      {!links.whatsapp && !links.email && <p className="viewing-field-error">Contact details will be available soon.</p>}
      <span className="broker-card-note">Appointments and any transport contribution are agreed personally before a visit.</span>
    </div>
  </section>;
}

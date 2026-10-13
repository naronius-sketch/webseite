import { useState } from 'react';
import { ArrowRight, Mail, MessageCircle } from 'lucide-react';
import { contactLinks, safeContactEmail, normalizePhone } from './broker-model.js';

export default function OwnerEnquiry({ business }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const links = contactLinks(business, message);

  function prepare(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (!safeContactEmail(values.email) && !normalizePhone(values.phone)) {
      setError('Enter a valid email address or a phone number with its country code.');
      return;
    }
    setError('');
    setMessage([
      `Property owner enquiry for ${business.name}`,
      `Name: ${values.name}`,
      values.email && `Email: ${values.email}`,
      values.phone && `Phone: ${values.phone}`,
      `I would like help ${values.purpose === 'buy' ? 'selling' : 'letting'} my property.`,
      `Location: ${values.location}`,
      `Property type: ${values.category}`,
      values.price && `Expected price: KSh ${values.price}${values.purpose === 'rent' ? ' per month' : ''}`,
      values.description && `Details: ${values.description}`,
      'Please contact me to discuss a marketing plan and agree any fees before proceeding.',
    ].filter(Boolean).join('\n'));
  }

  return <div className="modal-form-content owner-enquiry">
    <span className="eyebrow">FOR PROPERTY OWNERS</span>
    <h2>Find the right buyer.<br />Welcome the right tenant.</h2>
    <p>Tell {business.name} about your property. We will discuss your goals and the next steps personally.</p>
    {message ? <div className="owner-message-ready">
      <h3>Your enquiry is ready to send.</h3>
      <p>Choose WhatsApp or email and send the prepared message. Opening a draft does not send it automatically.</p>
      <textarea aria-label="Prepared owner enquiry" readOnly rows={8} value={message} />
      <div className="contact-actions">
        {links.whatsapp && <a className="button button-green" href={links.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle size={17} />Send on WhatsApp</a>}
        {links.email && <a className="button button-outline" href={links.email}><Mail size={17} />Open email draft</a>}
      </div>
      <button className="text-link" onClick={() => setMessage('')}>Edit enquiry</button>
    </div> : <form className="contact-form" onSubmit={prepare}>
      <label>Your name<input name="name" autoComplete="name" required maxLength={100} /></label>
      <div className="form-row"><label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com" /></label><label>Phone with country code<input name="phone" type="tel" autoComplete="tel" placeholder="+254…" maxLength={50} /></label></div>
      <p className="form-note">Provide an email address or an international phone number so the agent can respond.</p>
      <div className="form-row"><label>I would like to<select name="purpose"><option value="buy">Sell my property</option><option value="rent">Let my property</option></select></label><label>Property type<select name="category"><option>Apartment</option><option>House</option><option>Villa</option><option>Land</option></select></label></div>
      <label>Property location<input name="location" placeholder="Neighbourhood and city" required maxLength={200} /></label>
      <label>Expected price in KSh (optional)<input name="price" type="number" min="1" max="1000000000000" /></label>
      <label>A few details<textarea name="description" rows={3} maxLength={2000} placeholder="Bedrooms, size, availability and anything that makes your property special." /></label>
      {error && <p role="alert" className="form-error">{error}</p>}
      <p className="form-note">Your details are used to respond to this enquiry. You choose when to send them through WhatsApp or your email provider.</p>
      <button className="button button-green" type="submit">Prepare owner enquiry<ArrowRight size={17} /></button>
    </form>}
  </div>;
}

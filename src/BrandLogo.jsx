import { publicAsset } from './data.js';
import './brand.css';

export const BRAND_TAGLINE = 'Because ordinary isn’t your style';

// Display the supplied artwork in a fitted frame; keep the original JPEG intact.
export function BrandMark({ className = '' }) {
  return <span className={`wangechi-art wangechi-art-mark ${className}`} aria-hidden="true"><img src={publicAsset('images/wangechi-realty-logo.jpg')} alt="" width={1280} height={1278} decoding="async" draggable={false} /></span>;
}

export default function BrandLogo({ name = 'Wangechi Realty', variant = 'compact' }) {
  const [first, ...rest] = name.split(' ');
  return <a className={`wangechi-brand wangechi-brand-${variant}`} href="#" aria-label={`${name} home`}>
    {variant === 'full' ? <span className="wangechi-art wangechi-art-full" aria-hidden="true"><img src={publicAsset('images/wangechi-realty-logo.jpg')} alt="" width={1280} height={1278} decoding="async" draggable={false} /></span> : <><BrandMark /><span className="wangechi-wordmark"><strong>{first}</strong>{rest.length > 0 && <span>{rest.join(' ')}</span>}</span></>}
  </a>;
}

import { Aperture } from 'lucide-react';
export function Brand() {
  return (
    <a className="brand" href="/" aria-label="Rewind home">
      <span className="brand-mark">
        <Aperture size={24} strokeWidth={1.7} />
      </span>
      <span>
        rewind<span className="brand-period">.</span>
      </span>
    </a>
  );
}

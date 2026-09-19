import type { Snapshot } from '@/lib/phone-capture';

// Only used when no camera is available at all (denied or missing): a plain
// generated card so the hand-off can still be shown.
export async function demoPhoto(): Promise<Snapshot & { blob: Blob }> {
  const w = 960;
  const h = 720;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#eef1f6');
  g.addColorStop(1, '#d9e0ea');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(255,255,255,0.75)';
  c.beginPath();
  c.roundRect(150, 190, 660, 340, 40);
  c.fill();
  c.fillStyle = '#4a4a50';
  c.font = '600 44px Inter, system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText('Scanned', w / 2, 350);
  c.font = '400 30px Inter, system-ui, sans-serif';
  c.fillStyle = '#86868b';
  c.fillText(
    new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    w / 2,
    405,
  );
  const blob = await new Promise<Blob>((res) =>
    canvas.toBlob((b) => res(b!), 'image/jpeg', 0.86),
  );
  return { blob, url: URL.createObjectURL(blob), width: w, height: h };
}

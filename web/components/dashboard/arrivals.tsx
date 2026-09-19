'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Recording } from '@/lib/api';
import { ReceiveLetter, type Receive } from './letter';

// Receiving half of the phone's Scan hand-off. One letter at a time drops out
// of the cloud onto the Moments card. While it is in flight, the card keeps
// the incoming photo's slot empty (see `arriving`).
export function Arrivals({
  items,
  onDone,
  onArriving,
}: {
  items: Recording[];
  onDone: (id: string) => void;
  onArriving: (id: string | null) => void;
}) {
  const current = items[0] ?? null;
  const [item, setItem] = useState<Receive | null>(null);
  useEffect(() => {
    if (!current) return;
    onArriving(current.id);
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      const card = document.querySelector<HTMLElement>('[data-card="moments"]');
      if (card) {
        const box = card.getBoundingClientRect();
        if (box.bottom > window.innerHeight || box.top < 0)
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      const place = () => {
        const slot =
          card?.querySelector<HTMLElement>(`[data-frame="${current.id}"]`) ??
          card?.querySelector<HTMLElement>('.board button, .photo');
        const box = card?.getBoundingClientRect();
        setItem({
          id: current.id,
          photo: current.media_url,
          to: slot?.getBoundingClientRect() ?? null,
          // The cloud hovers just above the card the letter is headed for.
          cloud: box
            ? { x: box.left + box.width / 2, y: Math.max(56, box.top - 34) }
            : undefined,
        });
      };
      setTimeout(place, 450);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [current, onArriving]);
  const landed = useCallback(() => onArriving(null), [onArriving]);
  const done = useCallback(
    (id: string) => {
      setItem(null);
      onDone(id);
    },
    [onDone],
  );
  return <ReceiveLetter item={item} onLanded={landed} onDone={done} />;
}

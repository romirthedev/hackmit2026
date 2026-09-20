'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanDocument } from '@/lib/api';
import { ReceiveLetter, type Receive } from './letter';
import { BillSlip, PostcardBack, isBill } from './mail-cards';

// Receiving half of the phone's Scan hand-off. Documents arrive one at a
// time: a postcard drops onto the Letters card and opens message side up; a
// bill drops onto the calendar and tucks itself into its due date. While a
// document is in flight the destination card keeps its slot empty (see
// `arriving`).
export function Arrivals({
  items,
  onDone,
  onArriving,
  onLanded,
}: {
  items: ScanDocument[];
  onDone: (id: string) => void;
  onArriving: (id: string | null) => void;
  onLanded: (id: string) => void;
}) {
  const currentId = items[0]?.id;
  const currentRef = useRef(items[0]);
  useEffect(() => {
    currentRef.current = items[0];
  }, [items]);
  const [item, setItem] = useState<Receive | null>(null);
  useEffect(() => {
    const current = currentRef.current;
    if (!current) return;
    onArriving(current.id);
    let cancelled = false;
    let placement: ReturnType<typeof setTimeout> | undefined;
    const bill = isBill(current);
    const t = setTimeout(() => {
      if (cancelled) return;
      const card = document.querySelector<HTMLElement>(
        bill ? '[data-card="calendar"]' : '[data-card="notes"]',
      );
      const bounds = card?.getBoundingClientRect();
      if (!bounds) {
        onArriving(null);
        onDone(current.id);
        return;
      }
      // Bring the destination into view before the cloud forms above it.
      if (bounds.bottom > window.innerHeight - 40 || bounds.top < 80)
        card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Measure only once the smooth scroll has settled, otherwise the letter
      // aims at where the card used to be.
      let lastTop = Number.POSITIVE_INFINITY;
      let settledAt = Date.now();
      const place = () => {
        if (cancelled) return;
        const top = card?.getBoundingClientRect().top ?? 0;
        if (Math.abs(top - lastTop) > 0.5 && Date.now() - settledAt < 1600) {
          lastTop = top;
          placement = setTimeout(place, 90);
          return;
        }
        const box = card?.getBoundingClientRect();
        const slot = bill
          ? (current.due_date &&
              card?.querySelector<HTMLElement>(
                `[data-day="${current.due_date}"]`,
              )) ||
            card?.querySelector<HTMLElement>('.cal-grid')
          : card?.querySelector<HTMLElement>('[data-slot="postcard"]');
        setItem({
          id: current.id,
          kind: bill ? 'bill' : 'postcard',
          render: bill ? (
            <BillSlip document={current} mini />
          ) : (
            <PostcardBack document={current} mini />
          ),
          to: slot?.getBoundingClientRect() ?? null,
          // The cloud hovers just above the card the letter is headed for.
          cloud: box
            ? { x: box.left + box.width / 2, y: Math.max(56, box.top - 34) }
            : undefined,
        });
      };
      settledAt = Date.now();
      placement = setTimeout(place, 350);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearTimeout(placement);
    };
  }, [currentId, onArriving, onDone]);
  const landed = useCallback(() => {
    if (currentId) onLanded(currentId);
    onArriving(null);
  }, [currentId, onArriving, onLanded]);
  const done = useCallback(
    (id: string) => {
      setItem(null);
      onDone(id);
    },
    [onDone],
  );
  return <ReceiveLetter item={item} onLanded={landed} onDone={done} />;
}

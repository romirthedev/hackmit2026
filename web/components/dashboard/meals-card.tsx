'use client';
/* oxlint-disable next/no-img-element -- bite photos are authenticated media */
import { useState } from 'react';
import { Trash2, Utensils } from 'lucide-react';
import type { Meal } from '@/lib/api';
import { Card, Cell, Row, hm } from './primitives';

// Food seen at the mouth in one photo and gone from the next ones. The list
// comes straight from /api/meals; nothing here is demo data.
export function MealsCard({
  meals,
  zone,
  index,
  disabled,
  onRemove,
}: {
  meals: Meal[];
  zone?: string;
  index: number;
  disabled: boolean;
  onRemove: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  async function remove(id: string) {
    setBusy(id);
    try {
      await onRemove(id);
    } finally {
      setBusy(null);
    }
  }
  const eating = meals.find((meal) => meal.status === 'open');
  return (
    <Cell label="Meals" index={index}>
      <Card data-card="meals">
        <Row>
          <span className="card-title">
            {eating ? `Eating ${eating.food} now` : 'What Rose ate'}
          </span>
          <Utensils className="icon-muted" />
        </Row>
        {meals.length ? (
          <ul className="inbox meals">
            {meals.slice(0, 5).map((meal) => (
              <li key={meal.id}>
                <div className="inbox-head">
                  <b>
                    {meal.image_url && (
                      <img
                        className="thumb"
                        src={meal.image_url}
                        alt=""
                        width={34}
                        height={34}
                        loading="lazy"
                      />
                    )}
                    {meal.status === 'eaten' ? 'Ate ' : 'Eating '}
                    {meal.food}
                  </b>
                  <span>{hm(meal.last_seen_at, zone)}</span>
                </div>
                <p className="muted xs">
                  {meal.bites} {meal.bites === 1 ? 'bite' : 'bites'} seen
                  {meal.status === 'eaten'
                    ? meal.gone_at
                      ? ` · gone by ${hm(meal.gone_at, zone)}`
                      : ' · no later photos'
                    : ' · still in view'}
                </p>
                <Row>
                  <span className="muted xs">{meal.summary}</span>
                  <button
                    type="button"
                    className="tbtn xs"
                    aria-label="Forget this meal"
                    disabled={disabled || busy === meal.id}
                    onClick={() => void remove(meal.id)}
                  >
                    <Trash2 />
                  </button>
                </Row>
              </li>
            ))}
          </ul>
        ) : (
          <p className="serif sm">
            Nothing eaten on camera yet. Hold a snack up to your mouth for a
            second and it shows up here once it is gone.
          </p>
        )}
      </Card>
    </Cell>
  );
}

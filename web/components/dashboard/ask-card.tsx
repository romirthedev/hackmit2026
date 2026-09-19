'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic } from 'lucide-react';
import { Card, Cell } from './primitives';
import { Orb, type OrbState } from './orb';
import type { Answer } from '@/lib/api';

const STATE_TEXT: Record<OrbState, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  answer: 'Rewind',
};
const HINT: Record<OrbState, string> = {
  idle: 'Tap the orb to talk, or type below.',
  listening: 'Go ahead, I\u2019m listening. Tap again when you\u2019re done.',
  thinking: 'One moment.',
  answer: '',
};

export function AskCard({
  ask,
  index,
  label = 'Ask Rewind',
  placeholder = 'Ask Rewind anything',
  title = 'Ask',
}: {
  ask: (q: string) => Promise<Answer>;
  index: number;
  label?: string;
  placeholder?: string;
  title?: string;
}) {
  const [state, setState] = useState<OrbState>('idle');
  const [answer, setAnswer] = useState('');
  const [text, setText] = useState('');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clear, []);

  const go = async (q: string) => {
    clear();
    setState('thinking');
    try {
      const a = await ask(q);
      setAnswer(
        a.answer.replace(/\[[0-9a-f-]{36}\]/g, '').trim() ||
          'I could not find that in your recordings.',
      );
      setState('answer');
      timers.current.push(setTimeout(() => setState('idle'), 14000));
    } catch (e) {
      setAnswer(String(e).replace(/^Error: /, ''));
      setState('answer');
    }
  };
  const toggleListen = () => {
    if (state === 'listening') return void go('What happened recently?');
    clear();
    setState('listening');
    timers.current.push(setTimeout(() => go('What happened recently?'), 6000));
  };

  return (
    <Cell label={label} link index={index}>
      <Card className="card-dark card-ask" data-state={state}>
        <div className="row">
          <span className="card-title">{title}</span>
          <span className="dim">
            <span className="live" />
            {STATE_TEXT[state]}
          </span>
        </div>
        <button
          type="button"
          className="orb-stage"
          onClick={toggleListen}
          aria-label="Tap to talk"
        >
          <Orb state={state} />
          <div className="waves" aria-hidden="true">
            {[3, 1, 4, 0, 2, 5, 3].map((n, i) => (
              <i key={i} style={{ '--n': n } as React.CSSProperties} />
            ))}
          </div>
        </button>
        <div className="ask-body">
          {state === 'answer' ? (
            <p className="answer">{answer}</p>
          ) : (
            <p className="hint">{HINT[state]}</p>
          )}
        </div>
        <form
          className="ask-bar"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            const q = text.trim();
            if (!q) return;
            setText('');
            void go(q);
          }}
        >
          <button
            type="button"
            className="gbtn gbtn-round"
            onClick={toggleListen}
            aria-label="Talk"
          >
            <Mic />
          </button>
          <label className={`ask-input ${text ? 'has-text' : ''}`}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
            />
            <button type="submit" className="send" aria-label="Send">
              <ArrowUp />
            </button>
          </label>
        </form>
      </Card>
    </Cell>
  );
}

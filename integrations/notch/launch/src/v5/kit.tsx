import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {loadFont} from '@remotion/google-fonts/CharisSIL';

const {fontFamily: CHARIS} = loadFont();

// ---- the entire palette: paper, ink, one blue. nothing else. ----
export const PAPER = '#F7F9FC';
export const INK = '#0D1117';
export const BLUE = '#5E9EFF'; // Notch's actual theme blue
export const BLUE_DEEP = '#2F6FE0'; // print-contrast blue for text on paper
export const GRAY = '#8A94A6';
export const HAIR = 'rgba(13,17,23,0.08)';
export const NIGHT = '#07090D';

export const F = `${CHARIS}, Charter, Georgia, serif`;

export const CARD_SHADOW = '0 24px 60px rgba(13,17,23,0.10), 0 2px 8px rgba(13,17,23,0.05)';

// soft agency spring: gentle overshoot
export const useRise = (at: number, dist = 64) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f - at, fps, config: {damping: 13, stiffness: 120, mass: 0.9}});
  return {
    opacity: Math.min(1, s * 1.4),
    transform: `translateY(${(1 - s) * dist}px) scale(${0.965 + 0.035 * s})`,
  };
};

// constant life: slow scene-length drift
export const useDrift = (dur: number, amt = 0.03) => {
  const f = useCurrentFrame();
  return 1 + (f / dur) * amt;
};

// ---- the brand shape: the notch pill, hanging from the top of the frame ----
export const Notch: React.FC<{
  at?: number;
  w?: number;
  h?: number;
  color?: string;
  glow?: boolean;
  pulseAt?: number; // emit one clean ring
  pulseColor?: string;
}> = ({at = 0, w = 320, h = 88, color = INK, glow = false, pulseAt, pulseColor = BLUE}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const drop = spring({frame: f - at, fps, config: {damping: 14, stiffness: 110, mass: 1}});
  const ring = pulseAt !== undefined ? interpolate(f, [pulseAt, pulseAt + 40], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) : 0;
  return (
    <div style={{position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none'}}>
      <div style={{position: 'relative'}}>
        <div
          style={{
            width: w,
            height: h,
            background: color,
            borderRadius: `0 0 ${h * 0.42}px ${h * 0.42}px`,
            transformOrigin: 'top center',
            transform: `scaleY(${drop})`,
            boxShadow: glow ? `0 6px 44px ${BLUE}55` : '0 10px 34px rgba(13,17,23,0.18)',
          }}
        />
        {ring > 0 && ring < 1 ? (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: h * 0.5,
              width: w * (1 + ring * 1.6),
              height: h * (1 + ring * 2.6),
              transform: 'translate(-50%, -50%)',
              border: `2.5px solid ${pulseColor}`,
              borderRadius: 999,
              opacity: (1 - ring) * 0.8,
            }}
          />
        ) : null}
      </div>
    </div>
  );
};

// ---- editorial line with one accent word ----
export const Editorial: React.FC<{
  parts: Array<{t: string; blue?: boolean}>;
  at: number;
  size?: number;
  weight?: number;
  ink?: string;
}> = ({parts, at, size = 96, weight = 700, ink = INK}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  let wi = 0;
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        columnGap: '0.27em',
        fontFamily: F,
        fontSize: size,
        fontWeight: weight,
        letterSpacing: '0em',
        lineHeight: 1.16,
        textAlign: 'center',
      }}
    >
      {parts.map((p, pi) =>
        p.t.split(' ').map((w, i) => {
          const s = spring({frame: f - at - wi * 3, fps, config: {damping: 14, stiffness: 140, mass: 0.8}});
          wi += 1;
          return (
            <span
              key={`${pi}-${i}`}
              style={{
                display: 'inline-block',
                color: p.blue ? BLUE_DEEP : ink,
                opacity: Math.min(1, s * 1.5),
                transform: `translateY(${(1 - s) * 34}px)`,
              }}
            >
              {w}
            </span>
          );
        })
      )}
    </div>
  );
};

// ---- clean white card ----
export const Card: React.FC<{
  w?: number;
  pad?: string | number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({w, pad = 36, style, children}) => (
  <div
    style={{
      width: w,
      padding: pad,
      background: '#FFFFFF',
      borderRadius: 28,
      boxShadow: CARD_SHADOW,
      border: `1px solid ${HAIR}`,
      fontFamily: F,
      position: 'relative',
      ...style,
    }}
  >
    {children}
  </div>
);

// ---- typing text, calm cursor ----
export const Typed: React.FC<{
  text: string;
  at: number;
  cps?: number;
  size?: number;
  color?: string;
  accentFrom?: number; // char index where accent color starts
}> = ({text, at, cps = 1.3, size = 76, color = INK, accentFrom}) => {
  const f = useCurrentFrame();
  const n = Math.max(0, Math.floor((f - at) * cps));
  const shown = text.slice(0, n);
  const head = accentFrom !== undefined ? shown.slice(0, accentFrom) : shown;
  const tail = accentFrom !== undefined ? shown.slice(accentFrom) : '';
  return (
    <span style={{fontFamily: F, fontSize: size, fontWeight: 400, letterSpacing: '0em', color, whiteSpace: 'pre-wrap'}}>
      {head}
      {tail ? <span style={{color: BLUE_DEEP}}>{tail}</span> : null}
      <span
        style={{
          display: 'inline-block',
          width: 4,
          height: size * 0.92,
          background: BLUE,
          verticalAlign: 'text-bottom',
          marginLeft: 6,
          opacity: Math.sin(f / 8) > -0.2 ? 1 : 0,
          borderRadius: 2,
        }}
      />
    </span>
  );
};

// ---- calm waveform (blue) ----
export const Wave: React.FC<{amp?: number; color?: string; n?: number}> = ({amp = 1, color = BLUE, n = 5}) => {
  const f = useCurrentFrame();
  return (
    <div style={{display: 'flex', gap: 7, alignItems: 'center', height: 44}}>
      {Array.from({length: n}, (_, i) => (
        <div
          key={i}
          style={{
            width: 8,
            height: 8 + amp * 26 * (0.5 + 0.5 * Math.sin(f / 3.2 + i * 1.1)),
            borderRadius: 4,
            background: color,
          }}
        />
      ))}
    </div>
  );
};

// ---- 2D canvas camera: glide-and-settle reframes across a big world ----
export type Key2 = {f: number; x: number; y: number; s: number};
const GLIDE = Easing.bezier(0.5, 0, 0.12, 1);

export const Cam2D: React.FC<{keys: Key2[]; w?: number; h?: number; children: React.ReactNode}> = ({
  keys,
  w = 3600,
  h = 2000,
  children,
}) => {
  const f = useCurrentFrame();
  const ch = (sel: (k: Key2) => number) =>
    keys.length === 1
      ? sel(keys[0])
      : interpolate(
          f,
          keys.map((k) => k.f),
          keys.map(sel),
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: GLIDE}
        );
  const x = ch((k) => k.x);
  const y = ch((k) => k.y);
  const s = ch((k) => k.s);
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden'}}>
      <div
        style={{
          position: 'absolute',
          width: w,
          height: h,
          transformOrigin: '0 0',
          transform: `translate(${960 - x * s}px, ${540 - y * s}px) scale(${s})`,
        }}
      >
        {children}
      </div>
    </div>
  );
};

// place inside a Cam2D canvas
export const P: React.FC<{x: number; y: number; r?: number; s?: number; o?: number; children: React.ReactNode}> = ({
  x,
  y,
  r = 0,
  s = 1,
  o = 1,
  children,
}) => (
  <div style={{position: 'absolute', left: x, top: y, transform: `translate(-50%,-50%) rotate(${r}deg) scale(${s})`, opacity: o}}>
    {children}
  </div>
);

// ---- the floating notch-pill mascot: alive, tumbling around compositions ----
export const Sprite: React.FC<{keys: Key2[]; dark?: boolean; size?: number}> = ({keys, dark = false, size = 150}) => {
  const f = useCurrentFrame();
  const ch = (sel: (k: Key2) => number) =>
    keys.length === 1
      ? sel(keys[0])
      : interpolate(
          f,
          keys.map((k) => k.f),
          keys.map(sel),
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: GLIDE}
        );
  const x = ch((k) => k.x);
  const y = ch((k) => k.y);
  const sc = ch((k) => k.s);
  const rot = Math.sin(f / 26) * 9;
  const bob = Math.sin(f / 19) * 8;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `translate(-50%,-50%) translateY(${bob}px) rotate(${rot}deg) scale(${sc})`,
      }}
    >
      <div
        style={{
          width: size,
          height: size * 0.42,
          background: dark ? BLUE : INK,
          borderRadius: `0 0 ${size * 0.19}px ${size * 0.19}px`,
          boxShadow: dark ? `0 8px 40px ${BLUE}66` : '0 14px 34px rgba(13,17,23,0.22)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '58%',
          top: '85%',
          width: size * 0.34,
          height: size * 0.145,
          background: dark ? '#FFFFFF' : BLUE,
          borderRadius: `0 0 ${size * 0.07}px ${size * 0.07}px`,
          boxShadow: '0 8px 20px rgba(13,17,23,0.16)',
        }}
      />
    </div>
  );
};

// ---- chapter reveal: the next scene expands out of the notch shape ----
export const NotchReveal: React.FC<{dur?: number; children: React.ReactNode}> = ({dur = 13, children}) => {
  const f = useCurrentFrame();
  const t = interpolate(f, [0, dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.35, 0, 0.2, 1),
  });
  if (t >= 1) return <AbsoluteFill>{children}</AbsoluteFill>;
  const inX = 810 * (1 - t);
  const inB = 996 * (1 - t);
  const r = 44 * (1 - t) + 2;
  return (
    <AbsoluteFill style={{clipPath: `inset(0px ${inX}px ${inB}px ${inX}px round 0 0 ${r}px ${r}px)`}}>
      {children}
    </AbsoluteFill>
  );
};

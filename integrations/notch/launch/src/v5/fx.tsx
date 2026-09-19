import React from 'react';
import {Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {BLUE, BLUE_DEEP, F, INK} from './kit';

// ---- focus-pull kinetic word: lands from out-of-focus, optionally racks out ----
export const Word: React.FC<{
  t: string;
  at: number;
  exitAt?: number;
  size?: number;
  blue?: boolean;
  weight?: number;
  color?: string;
  italic?: boolean;
}> = ({t, at, exitAt, size = 120, blue = false, weight = 400, color, italic = false}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f - at, fps, config: {damping: 15, stiffness: 110, mass: 0.9}});
  if (f < at - 2) return null;
  let blur = (1 - s) * 14;
  let scale = 1.22 - 0.22 * s;
  let o = Math.min(1, s * 1.6);
  if (exitAt !== undefined && f >= exitAt) {
    const e = interpolate(f, [exitAt, exitAt + 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad)});
    blur = e * 14;
    scale = 1 + e * 0.22;
    o = 1 - e;
  }
  if (o <= 0.01) return null;
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: F,
        fontSize: size,
        fontWeight: weight,
        fontStyle: italic ? 'italic' : 'normal',
        letterSpacing: '-0.005em',
        color: color ?? (blue ? BLUE_DEEP : INK),
        opacity: o,
        transform: `scale(${scale})`,
        filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
        whiteSpace: 'nowrap',
      }}
    >
      {t}
    </span>
  );
};

// ---- an editorial line: words flow inline, each focus-pulls in ----
export const Line: React.FC<{
  at: number;
  exitAt?: number;
  size?: number;
  words: Array<{t: string; blue?: boolean; weight?: number; italic?: boolean; color?: string}>;
  per?: number;
}> = ({at, exitAt, size = 110, words, per = 12}) => (
  <div style={{display: 'flex', alignItems: 'baseline', gap: '0.3em', whiteSpace: 'nowrap', fontSize: size}}>
    {words.map((w, i) => (
      <Word key={i} t={w.t} at={at + i * per} exitAt={exitAt} size={size} blue={w.blue} weight={w.weight} italic={w.italic} color={w.color} />
    ))}
  </div>
);

// ---- the glassy notch prop (their frosted folder, ours is the pill) ----
export const GlassPill: React.FC<{s?: number; squish?: number}> = ({s = 1, squish = 0}) => {
  const f = useCurrentFrame();
  return (
    <div style={{transform: `scale(${s * (1 - squish * 0.06)}, ${s * (1 + squish * 0.04)})`}}>
      <div
        style={{
          width: 300,
          height: 125,
          borderRadius: '0 0 52px 52px',
          background: 'linear-gradient(165deg, rgba(126,178,255,0.95) 0%, rgba(94,158,255,0.92) 45%, rgba(47,111,224,0.95) 100%)',
          boxShadow: `0 ${34 + Math.sin(f / 20) * 4}px 70px rgba(47,111,224,0.38), inset 0 2px 3px rgba(255,255,255,0.65), inset 0 -14px 30px rgba(255,255,255,0.18)`,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{position: 'absolute', top: -30, left: 20, width: 130, height: 90, borderRadius: 60, background: 'rgba(255,255,255,0.35)', filter: 'blur(16px)'}} />
        <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9}}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                width: 9,
                height: 16 + 26 * (0.5 + 0.5 * Math.sin(f / 3.4 + i * 1.2)),
                borderRadius: 5,
                background: 'rgba(255,255,255,0.95)',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

// ---- macOS arrow cursor ----
export const Cursor: React.FC<{s?: number; press?: boolean}> = ({s = 1, press = false}) => (
  <svg width={44 * s} height={62 * s} viewBox="0 0 22 31" style={{transform: press ? 'scale(0.88)' : undefined, filter: 'drop-shadow(0 3px 6px rgba(13,17,23,0.35))'}}>
    <path d="M1 1 L1 24 L7.2 18.6 L10.8 27.5 L15 25.7 L11.3 17 L19 17 Z" fill="#0D1117" stroke="#FFFFFF" strokeWidth={1.6} />
  </svg>
);

// ---- liquid gradient progress bar ----
export const LiquidBar: React.FC<{w: number; h?: number; p: number}> = ({w, h = 88, p}) => {
  const f = useCurrentFrame();
  const wob = 1 + Math.sin(f / 5) * 0.035;
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: h,
        background: '#FFFFFF',
        boxShadow: 'inset 0 3px 10px rgba(13,17,23,0.09), 0 16px 44px rgba(47,111,224,0.14)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 6,
          top: 6,
          bottom: 6,
          width: Math.max(h - 12, (w - 12) * p),
          borderRadius: h,
          transform: `scaleY(${wob})`,
          background: `linear-gradient(90deg, #6FB0FF 0%, #5E9EFF 30%, #6D7BFF ${65 + Math.sin(f / 9) * 10}%, #4FC3FF 100%)`,
          backgroundSize: '180% 100%',
          backgroundPosition: `${-(f * 1.6) % 180}% 0`,
          boxShadow: '0 6px 24px rgba(94,158,255,0.5)',
        }}
      />
    </div>
  );
};

// ---- confetti burst (blue family) ----
export const Confetti: React.FC<{at: number; n?: number}> = ({at, n = 46}) => {
  const f = useCurrentFrame();
  const t = f - at;
  if (t < 0 || t > 90) return null;
  const COLORS = ['#5E9EFF', '#2F6FE0', '#9CC4FF', '#6D7BFF', '#0D1117', '#FFFFFF'];
  return (
    <div style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
      {Array.from({length: n}, (_, i) => {
        const ang = random(`ca${i}`) * Math.PI - Math.PI; // upward fan
        const v = 16 + random(`cv${i}`) * 26;
        const g = 1.35;
        const x = 960 + Math.cos(ang) * v * t * 1.15;
        const y = 470 + Math.sin(ang) * v * t * 0.62 + g * t * t * 0.5;
        const rot = random(`cr${i}`) * 360 + t * (random(`cs${i}`) * 16 - 8);
        const w = 12 + random(`cw${i}`) * 16;
        const o = interpolate(t, [0, 8, 62, 88], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        if (y > 1220) return null;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: w,
              height: w * (0.5 + random(`ch${i}`) * 0.7),
              background: COLORS[i % COLORS.length],
              borderRadius: 3,
              transform: `rotate(${rot}deg)`,
              opacity: o,
              filter: t < 6 ? 'blur(1.5px)' : undefined,
            }}
          />
        );
      })}
    </div>
  );
};

// ---- glassy circular check ----
export const GlassCheck: React.FC<{at: number; size?: number}> = ({at, size = 190}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f - at, fps, config: {damping: 11, stiffness: 150, mass: 0.8}});
  const draw = interpolate(f, [at + 4, at + 22], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size,
        transform: `scale(${s})`,
        background: 'linear-gradient(150deg, #FFFFFF 0%, #EAF1FF 55%, #D7E6FF 100%)',
        boxShadow: '0 30px 70px rgba(47,111,224,0.25), inset 0 2px 3px rgba(255,255,255,0.9), inset 0 -10px 24px rgba(94,158,255,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={size * 0.52} height={size * 0.42} viewBox="0 0 52 42">
        <path
          d="M4 22 L19 36 L48 5"
          fill="none"
          stroke={BLUE}
          strokeWidth={7.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={80}
          strokeDashoffset={80 * (1 - draw)}
        />
      </svg>
    </div>
  );
};

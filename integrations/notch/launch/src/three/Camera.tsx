import React from 'react';
import {AbsoluteFill, Easing, interpolate} from 'remotion';

// ---------------- camera rig: keyframed dolly/orbit/zoom ----------------
export type Key = {
  f: number; // frame
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  s?: number;
};
export type Cam = {x: number; y: number; z: number; rx: number; ry: number; rz: number; s: number};

const CHANNELS = ['x', 'y', 'z', 'rx', 'ry', 'rz', 's'] as const;
const DEFAULTS: Cam = {x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1};
const EASE = Easing.bezier(0.33, 0, 0.18, 1);

export const rig = (frame: number, keys: Key[]): Cam => {
  const cam = {...DEFAULTS};
  for (const ch of CHANNELS) {
    const pts = keys.filter((k) => k[ch] !== undefined);
    if (pts.length === 0) continue;
    if (pts.length === 1) {
      cam[ch] = pts[0][ch]!;
      continue;
    }
    cam[ch] = interpolate(
      frame,
      pts.map((p) => p.f),
      pts.map((p) => p[ch]!),
      {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE}
    );
  }
  return cam;
};

// ---------------- the world: perspective container, camera-inverted ----------------
export const World: React.FC<{
  cam: Cam;
  perspective?: number;
  children: React.ReactNode;
}> = ({cam, perspective = 1500, children}) => (
  <AbsoluteFill style={{perspective, perspectiveOrigin: '50% 46%'}}>
    <AbsoluteFill
      style={{
        transformStyle: 'preserve-3d',
        transform: `scale(${cam.s}) rotateX(${-cam.rx}deg) rotateY(${-cam.ry}deg) rotateZ(${-cam.rz}deg) translate3d(${-cam.x}px, ${-cam.y}px, ${cam.z}px)`,
      }}
    >
      {children}
    </AbsoluteFill>
  </AbsoluteFill>
);

// ---------------- place an object in world space ----------------
export const At: React.FC<{
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  s?: number;
  w?: number;
  blur?: number; // fake depth-of-field on this plane
  o?: number;
  children: React.ReactNode;
}> = ({x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, w, blur = 0, o = 1, children}) => (
  <div
    style={{
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: w,
      transformStyle: 'preserve-3d',
      transform: `translate(-50%, -50%) translate3d(${x}px, ${y}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${s})`,
      filter: blur > 0.15 ? `blur(${blur}px)` : undefined,
      opacity: o,
    }}
  >
    {children}
  </div>
);

// ---------------- whip-pan scene transitions (L/R alternating) ----------------
// scenes overlap by OVERLAP frames: the outgoing scene keeps rendering (beneath)
// while the incoming one pushes in on top — a continuous whip-pan, no black gap.
export const OVERLAP = 13; // exactly one beat

export const Whip: React.FC<{
  f: number; // scene-local frame
  dur: number; // nominal scene length (sequence runs dur + OVERLAP when outTo)
  inFrom?: 'L' | 'R' | null;
  outTo?: 'L' | 'R' | null;
  children: React.ReactNode;
}> = ({f, dur, inFrom = null, outTo = null, children}) => {
  let x = 0;
  let b = 0;
  if (inFrom) {
    const t = interpolate(f, [0, 13], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    });
    x += (inFrom === 'L' ? -1 : 1) * 1980 * t;
    b += 15 * t;
  }
  if (outTo) {
    const t = interpolate(f, [dur, dur + OVERLAP], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.in(Easing.cubic),
    });
    x += (outTo === 'L' ? -1 : 1) * 1980 * t;
    b += 15 * t;
  }
  return (
    <AbsoluteFill
      style={{
        transform: `translateX(${x}px)`,
        filter: b > 0.2 ? `blur(${b}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {At, rig, World} from '../three/Camera';
import {BLUE, BLUE_DEEP, Cam2D, Card, CARD_SHADOW, F, GRAY, HAIR, INK, NIGHT, Notch, NotchReveal, PAPER, Typed, Wave} from './kit';
import {Confetti, Cursor, GlassCheck, GlassPill, Line, LiquidBar, Word} from './fx';

const Fix: React.FC<{x: number; y: number; children: React.ReactNode}> = ({x, y, children}) => (
  <div style={{position: 'absolute', left: x, top: y, transform: 'translate(-50%,-50%)'}}>{children}</div>
);

// ------------------------------------------------ 1. OPEN (250f) — focus-pull kinetic type + glass prop
export const Open: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pillY = spring({frame: f - 150, fps, config: {damping: 14, stiffness: 95, mass: 1}});
  const curIn = spring({frame: f - 168, fps, config: {damping: 15, stiffness: 120, mass: 0.9}});
  const grab = spring({frame: f - 195, fps, config: {damping: 12, stiffness: 200, mass: 0.6}});
  const away = spring({frame: f - 213, fps, config: {damping: 16, stiffness: 80, mass: 1}});
  const px = 1520 + away * 900;
  const py = -170 + pillY * 950 - away * 1100;
  const drift = 1 + Math.sin(f / 90) * 0.012 + (f / 250) * 0.03;
  return (
    <AbsoluteFill style={{background: PAPER}}>
      <div style={{position: 'absolute', inset: 0, transform: `scale(${drift})`}}>
        <Fix x={905} y={455}>
          <Line at={8} exitAt={60} size={126} words={[{t: 'Your', blue: true}, {t: 'Mac'}]} per={14} />
        </Fix>
        <Fix x={1010} y={555}>
          <Line at={68} exitAt={112} size={112} words={[{t: 'just'}, {t: 'became', italic: true, blue: true}]} per={12} />
        </Fix>
        <Fix x={960} y={520}>
          <Line at={118} exitAt={232} size={150} words={[{t: 'an'}, {t: 'assistant.', blue: true, weight: 700}]} per={10} />
        </Fix>
        {/* the glass notch prop, grabbed by the cursor */}
        <div style={{position: 'absolute', left: px, top: py, transform: 'translate(-50%,-50%)'}}>
          <GlassPill squish={grab * (1 - away)} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: px + 165 - curIn * 118,
            top: py + 175 - curIn * 158,
            opacity: Math.min(1, curIn * 1.6),
          }}
        >
          <Cursor press={grab > 0.4} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------ 1c. INTUITIVE (300f) — not a chatbot, not a tab: the notch
const Stamp: React.FC<{at: number}> = ({at}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f - at, fps, config: {damping: 11, stiffness: 220, mass: 0.6}});
  if (f < at) return null;
  return (
    <div
      style={{
        position: 'absolute',
        right: -26,
        top: -26,
        width: 74,
        height: 74,
        borderRadius: 40,
        background: INK,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${s}) rotate(-8deg)`,
        boxShadow: '0 14px 34px rgba(13,17,23,0.3)',
      }}
    >
      <svg width={30} height={30} viewBox="0 0 30 30">
        <path d="M7 7 L23 23 M23 7 L7 23" stroke="#FFF" strokeWidth={4.5} strokeLinecap="round" />
      </svg>
    </div>
  );
};

export const Intuitive: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const aIn = spring({frame: f - 10, fps, config: {damping: 14, stiffness: 100, mass: 0.9}});
  const bIn = spring({frame: f - 52, fps, config: {damping: 14, stiffness: 100, mass: 0.9}});
  const gone = interpolate(f, [104, 130], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad)});
  const struckA = f >= 38;
  const struckB = f >= 80;
  const panel = spring({frame: f - 148, fps, config: {damping: 14, stiffness: 95, mass: 1}});
  return (
    <AbsoluteFill style={{background: PAPER}}>
      {/* the old ways — stamped out */}
      <div style={{position: 'absolute', inset: 0, transform: `translateY(${gone * 320}px)`, opacity: 1 - gone, filter: gone > 0.05 ? `blur(${gone * 8}px)` : undefined}}>
        <div style={{position: 'absolute', left: 330, top: 330, opacity: Math.min(1, aIn * 1.4), transform: `translateY(${(1 - aIn) * 70}px) rotate(-2deg)`}}>
          <div style={{position: 'relative', width: 560, background: '#FFF', borderRadius: 22, border: `1px solid ${HAIR}`, boxShadow: CARD_SHADOW, padding: '24px 28px', filter: struckA ? 'grayscale(1)' : 'none', opacity: struckA ? 0.55 : 1}}>
            <div style={{fontFamily: F, fontSize: 24, fontWeight: 700, color: INK, marginBottom: 16}}>AI Chat</div>
            {[300, 420, 250].map((w, i) => (
              <div key={i} style={{width: w, height: 15, borderRadius: 8, background: 'rgba(13,17,23,0.09)', marginBottom: 12, marginLeft: i % 2 ? 90 : 0}} />
            ))}
            <div style={{height: 44, borderRadius: 999, border: `1.5px solid ${HAIR}`, marginTop: 16}} />
            <Stamp at={38} />
          </div>
          <div style={{marginTop: 24, textAlign: 'center'}}>
            <Word t="another chatbot?" at={16} size={44} color={GRAY} italic />
          </div>
        </div>
        <div style={{position: 'absolute', left: 1030, top: 370, opacity: Math.min(1, bIn * 1.4), transform: `translateY(${(1 - bIn) * 70}px) rotate(1.6deg)`}}>
          <div style={{position: 'relative', width: 600, background: '#FFF', borderRadius: 22, border: `1px solid ${HAIR}`, boxShadow: CARD_SHADOW, overflow: 'visible', filter: struckB ? 'grayscale(1)' : 'none', opacity: struckB ? 0.55 : 1}}>
            <div style={{display: 'flex', gap: 6, padding: '14px 16px 0'}}>
              {Array.from({length: 9}, (_, i) => (
                <div key={i} style={{flex: 1, height: 30, borderRadius: '9px 9px 0 0', background: i === 4 ? 'rgba(94,158,255,0.25)' : 'rgba(13,17,23,0.07)'}} />
              ))}
            </div>
            <div style={{height: 3, background: HAIR}} />
            <div style={{padding: '22px 26px'}}>
              {[430, 330].map((w, i) => (
                <div key={i} style={{width: w, height: 15, borderRadius: 8, background: 'rgba(13,17,23,0.08)', marginBottom: 12}} />
              ))}
            </div>
            <Stamp at={80} />
          </div>
          <div style={{marginTop: 24, textAlign: 'center'}}>
            <Word t="another tab?" at={58} size={44} color={GRAY} italic />
          </div>
        </div>
      </div>
      {/* the notch way — a panel folds out of the hardware you already look at */}
      <div style={{position: 'absolute', top: 88, left: 0, right: 0, display: 'flex', justifyContent: 'center'}}>
        <div
          style={{
            width: 560,
            transformOrigin: 'top center',
            transform: `scaleY(${panel})`,
            opacity: Math.min(1, panel * 1.5),
            background: 'linear-gradient(180deg, #000 0%, #0c0c10 30%, #15151c 100%)',
            borderRadius: '0 0 30px 30px',
            boxShadow: '0 34px 80px rgba(13,17,23,0.30)',
            padding: '34px 38px 30px',
          }}
        >
          <div style={{display: 'flex', alignItems: 'center', gap: 20}}>
            <Wave amp={panel} />
            <span style={{fontFamily: F, fontSize: 30, color: 'rgba(255,255,255,0.85)'}}>Ask anything.</span>
          </div>
        </div>
      </div>
      <Fix x={960} y={700}>
        <Line at={170} size={92} words={[{t: 'It lives where you'}, {t: 'already look.', blue: true, italic: true, weight: 700}]} per={18} />
      </Fix>
      <Fix x={960} y={850}>
        <Word t="right in the notch — on every Mac since 2021." at={226} size={38} color={GRAY} italic />
      </Fix>
      {/* connector from words up to the notch */}
      <div style={{position: 'absolute', left: 959, top: 250, width: 2.5, height: 370 * interpolate(f, [196, 224], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)}), background: `linear-gradient(180deg, ${BLUE}, transparent)`, borderRadius: 2, opacity: 0.6}} />
      <Notch at={-20} w={240} h={64} color={INK} glow={f > 140} pulseAt={150} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------ 2. PROMPT (200f) — the bar flies in, in 3D
export const Prompt8: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame: f - 6, fps, config: {damping: 15, stiffness: 85, mass: 1}});
  const exit = interpolate(f, [168, 196], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic)});
  const rx = 26 - enter * 22 - exit * 30;
  const ry = -18 + enter * 15;
  const y = 150 - enter * 150 - exit * 430;
  return (
    <AbsoluteFill style={{background: PAPER}}>
      <NotchReveal>
        <AbsoluteFill style={{background: PAPER, perspective: 1500, justifyContent: 'center', alignItems: 'center'}}>
          <div
            style={{
              transform: `translateY(${y}px) rotateX(${rx}deg) rotateY(${ry}deg)`,
              opacity: Math.min(1, enter * 1.5) * (1 - exit),
              filter: exit > 0.05 ? `blur(${exit * 9}px)` : undefined,
            }}
          >
            <div
              style={{
                width: 1560,
                display: 'flex',
                alignItems: 'center',
                gap: 40,
                padding: '42px 54px',
                background: '#FFFFFF',
                borderRadius: 999,
                boxShadow: CARD_SHADOW,
                border: `1px solid ${HAIR}`,
              }}
            >
              <Wave amp={f > 56 ? 1 : 0.3} />
              <Typed text="Fix the Q2 revenue discrepancy — loop the team in." at={64} cps={1.15} size={54} accentFrom={31} />
            </div>
            <div style={{display: 'flex', justifyContent: 'center', marginTop: 38, gap: 16, alignItems: 'center', fontFamily: F, fontSize: 30, color: GRAY, opacity: interpolate(f, [112, 128], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
              <span style={{padding: '8px 24px', borderRadius: 13, border: `1.5px solid ${HAIR}`, background: '#FFFFFF', boxShadow: '0 4px 12px rgba(13,17,23,0.07)', fontWeight: 700, color: INK}}>
                fn
              </span>
              hold it down · just talk
            </div>
          </div>
        </AbsoluteFill>
      </NotchReveal>
      <Notch at={-20} w={240} h={64} color={INK} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------ 3. TUNNEL (300f) — fly through the work
const MiniChat: React.FC = () => (
  <Card w={1050} pad={44} style={{borderRadius: 34}}>
    <div style={{display: 'flex', justifyContent: 'flex-end', marginBottom: 24}}>
      <div style={{padding: '16px 26px', background: BLUE, color: '#fff', borderRadius: '22px 22px 6px 22px', fontFamily: F, fontSize: 27, fontWeight: 400}}>
        Reply to Sarah — deck's coming Friday.
      </div>
    </div>
    {['Drafting in Mail', 'Checked the screen', 'Sent ✓'].map((t, i) => (
      <div key={i} style={{display: 'flex', gap: 14, alignItems: 'center', padding: '9px 0', fontFamily: F, fontSize: 25, color: '#39404C'}}>
        <div style={{width: 22, height: 22, borderRadius: 11, background: i === 2 ? BLUE : 'transparent', border: i === 2 ? 'none' : `2.5px solid ${BLUE}`}} />
        {t}
      </div>
    ))}
  </Card>
);

const MiniSheet: React.FC = () => (
  <Card w={1050} pad={44} style={{borderRadius: 34}}>
    <div style={{fontFamily: F, fontSize: 25, color: GRAY, fontWeight: 700, marginBottom: 20}}>Sheets — Q2 revenue</div>
    {[0, 1, 2, 3].map((r) => (
      <div key={r} style={{display: 'flex', gap: 16, alignItems: 'center', padding: '12px 14px', borderRadius: 10, background: r === 2 ? 'rgba(94,158,255,0.12)' : 'transparent', boxShadow: r === 2 ? `inset 0 0 0 2px ${BLUE}55` : 'none'}}>
        {[220, 320, 170].map((w, i) => (
          <div key={i} style={{width: w, height: 17, borderRadius: 9, background: 'rgba(13,17,23,0.09)'}} />
        ))}
        {r === 2 ? <span style={{fontFamily: F, fontSize: 21, color: BLUE_DEEP, fontWeight: 700}}>#2291 dupe</span> : null}
      </div>
    ))}
  </Card>
);

const MiniGraph: React.FC = () => (
  <Card w={1050} pad={30} style={{borderRadius: 34}}>
    <svg width={980} height={430}>
      {[[490, 210, 26, BLUE], [250, 110, 15, BLUE], [740, 100, 17, BLUE], [190, 320, 14, '#43C776'], [700, 330, 15, '#43C776'], [880, 210, 12, '#43C776']].map(([x, y, r, c], i) => (
        <g key={i}>
          {i > 0 ? <line x1={490} y1={210} x2={x as number} y2={y as number} stroke={INK} strokeOpacity={0.13} strokeWidth={2} /> : null}
          <circle cx={x as number} cy={y as number} r={(r as number) + 8} fill={c as string} opacity={0.15} />
          <circle cx={x as number} cy={y as number} r={r as number} fill={c as string} />
        </g>
      ))}
    </svg>
  </Card>
);

const MiniStats: React.FC = () => (
  <Card w={1050} pad={44} style={{borderRadius: 34, display: 'flex', gap: 44, justifyContent: 'center'}}>
    {[['5.9s', 'per skill'], ['6', 'agents'], ['0', 'windows']].map(([n, d], i) => (
      <div key={i} style={{textAlign: 'center'}}>
        <div style={{fontFamily: F, fontSize: 92, fontWeight: 700, color: i === 1 ? BLUE_DEEP : INK, letterSpacing: '0em'}}>{n}</div>
        <div style={{fontFamily: F, fontSize: 24, color: GRAY, fontWeight: 400}}>{d}</div>
      </div>
    ))}
  </Card>
);

const WALL_MINIS = [MiniChat, MiniSheet, MiniGraph, MiniStats];

export const Tunnel: React.FC = () => {
  const f = useCurrentFrame();
  const cam = rig(f, [
    {f: 0, z: 0, ry: 3, rx: -1, s: 1},
    {f: 290, z: 1500, ry: -4, rx: 1, s: 1},
  ]);
  return (
    <AbsoluteFill style={{background: PAPER}}>
      <World cam={cam} perspective={1300}>
        {[0, 1, 2].map((ring) => {
          const z = -350 - ring * 800;
          const camZ = interpolate(f, [0, 290], [0, 1500], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.5, 0, 0.12, 1)});
          const dist = Math.abs(z + camZ);
          const blur = Math.min(8, Math.max(0, (dist - 250) / 130));
          const o = interpolate(z + camZ, [-1500, -700, 500, 900], [0.15, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          return (
            <React.Fragment key={ring}>
              <At y={-440} z={z} rx={48} s={0.58} blur={blur} o={o}>
                {React.createElement(WALL_MINIS[ring % 4])}
              </At>
              <At y={440} z={z} rx={-48} s={0.58} blur={blur} o={o}>
                {React.createElement(WALL_MINIS[(ring + 2) % 4])}
              </At>
              <At x={-700} z={z} ry={55} s={0.58} blur={blur} o={o}>
                {React.createElement(WALL_MINIS[(ring + 1) % 4])}
              </At>
              <At x={700} z={z} ry={-55} s={0.58} blur={blur} o={o}>
                {React.createElement(WALL_MINIS[(ring + 3) % 4])}
              </At>
            </React.Fragment>
          );
        })}
      </World>
      {/* words floating in the tunnel */}
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <Fix x={960} y={540}>
          <Word t="Sees." at={15} exitAt={72} blue size={140} weight={700} />
        </Fix>
        <Fix x={960} y={540}>
          <Word t="Acts." at={80} exitAt={137} size={140} weight={700} />
        </Fix>
        <Fix x={960} y={540}>
          <Word t="Learns." at={145} exitAt={202} blue size={140} weight={700} />
        </Fix>
        <Fix x={960} y={480}>
          <Word t="One assistant." at={214} size={104} weight={700} />
        </Fix>
        <Fix x={960} y={620}>
          <Word t="Zero windows." at={238} blue size={104} weight={700} italic />
        </Fix>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ------------------------------------------------ 1b. FIRST (150f) — the claim
export const First: React.FC = () => {
  return (
    <AbsoluteFill style={{background: PAPER}}>
      <Fix x={960} y={400}>
        <Word t="The first" at={8} size={88} />
      </Fix>
      <Fix x={960} y={560}>
        <Word t="computer-use agent" at={38} blue size={132} weight={700} />
      </Fix>
      <Fix x={960} y={724}>
        <Word t="born for the Mac." at={88} size={62} color={GRAY} italic />
      </Fix>
      <Notch at={-20} w={240} h={64} color={INK} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------ 2b. ANY APP (250f) — icons fly past
const TILE_GRADS: Array<[string, string]> = [
  ['#42A5F5', '#0D47A1'],
  ['#29B6F6', '#01579B'],
  ['#66BB6A', '#1B5E20'],
  ['#AB47BC', '#4A148C'],
  ['#FFD54F', '#F57F17'],
  ['#EF5350', '#B71C1C'],
  ['#26C6DA', '#006064'],
  ['#78909C', '#263238'],
];

const Glyph: React.FC<{i: number}> = ({i}) => {
  const st = {stroke: '#FFF', strokeWidth: 7, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};
  switch (i % 8) {
    case 0: // mail
      return (
        <svg width={90} height={90} viewBox="0 0 100 100">
          <rect x={14} y={26} width={72} height={50} rx={9} {...st} />
          <path d="M16 30 L50 56 L84 30" {...st} />
        </svg>
      );
    case 1: // browser
      return (
        <svg width={90} height={90} viewBox="0 0 100 100">
          <circle cx={50} cy={50} r={34} {...st} />
          <path d="M64 36 L55 55 L36 64 L45 45 Z" fill="#FFF" stroke="none" />
        </svg>
      );
    case 2: // sheet
      return (
        <svg width={90} height={90} viewBox="0 0 100 100">
          <rect x={20} y={20} width={60} height={60} rx={8} {...st} />
          <path d="M20 44 L80 44 M20 62 L80 62 M44 20 L44 80" {...st} strokeWidth={5.5} />
        </svg>
      );
    case 3: // slack-ish hash
      return (
        <svg width={90} height={90} viewBox="0 0 100 100">
          <path d="M36 22 L30 78 M64 22 L58 78 M22 40 L80 40 M20 62 L78 62" {...st} strokeWidth={8} />
        </svg>
      );
    case 4: // notes
      return (
        <svg width={90} height={90} viewBox="0 0 100 100">
          <rect x={22} y={18} width={56} height={64} rx={8} {...st} />
          <path d="M34 38 L66 38 M34 52 L66 52 M34 66 L54 66" {...st} strokeWidth={5.5} />
        </svg>
      );
    case 5: // calendar
      return (
        <svg width={90} height={90} viewBox="0 0 100 100">
          <rect x={18} y={24} width={64} height={58} rx={9} {...st} />
          <path d="M18 42 L82 42 M34 16 L34 30 M66 16 L66 30" {...st} strokeWidth={6} />
        </svg>
      );
    case 6: // terminal
      return (
        <svg width={90} height={90} viewBox="0 0 100 100">
          <rect x={14} y={22} width={72} height={56} rx={9} {...st} />
          <path d="M28 42 L40 52 L28 62 M48 64 L64 64" {...st} strokeWidth={6.5} />
        </svg>
      );
    default: // chat
      return (
        <svg width={90} height={90} viewBox="0 0 100 100">
          <path d="M20 30 a10 10 0 0 1 10 -10 h40 a10 10 0 0 1 10 10 v26 a10 10 0 0 1 -10 10 h-30 l-14 14 v-14 h-6 a10 10 0 0 1 -10 -10 Z" {...st} />
        </svg>
      );
  }
};

const ICONS = ['mail', 'safari', 'numbers', 'slack', 'notes', 'calendar', 'terminal', 'messages'];

export const AnyApp: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const cam = rig(f, [
    {f: 0, z: 0, ry: -4, s: 1},
    {f: 240, z: 900, ry: 4, s: 1},
  ]);
  const click = spring({frame: f - 178, fps, config: {damping: 11, stiffness: 210, mass: 0.6}});
  return (
    <AbsoluteFill style={{background: PAPER}}>
      <World cam={cam} perspective={1300}>
        {ICONS.map((icon, i) => {
          const side = i % 2 === 0 ? -1 : 1;
          const z = -260 - i * 210;
          const camZ = interpolate(f, [0, 240], [0, 900], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.5, 0, 0.12, 1)});
          const rel = z + camZ;
          const blur = Math.min(7, Math.max(0, (Math.abs(rel) - 220) / 140));
          const o = interpolate(rel, [-1400, -600, 420, 760], [0.1, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          const isClicked = i === 2;
          const pop = isClicked ? 1 - 0.12 * Math.sin(Math.min(1, click) * Math.PI) : 1;
          return (
            <At key={i} x={side * (330 + (i % 3) * 130)} y={((i * 53) % 260) - 130} z={z} ry={side * -16} s={1 + (i % 3) * 0.06} blur={blur} o={o}>
              <div style={{transform: `scale(${pop})`, filter: 'drop-shadow(0 22px 40px rgba(13,17,23,0.28))'}}>
                <Img src={staticFile(`icons/${icon}.png`)} style={{width: 205, height: 205}} />
              </div>
            </At>
          );
        })}
      </World>
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <Fix x={960} y={520}>
          <Word t="Any app." at={16} exitAt={110} size={140} weight={700} />
        </Fix>
        <Fix x={960} y={520}>
          <Word t="Every app." at={118} blue size={140} weight={700} />
        </Fix>
      </AbsoluteFill>
      <div style={{position: 'absolute', left: interpolate(f, [150, 176], [520, 352], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)}), top: interpolate(f, [150, 176], [640, 500], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)}), opacity: interpolate(f, [150, 163], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
        <Cursor press={f >= 178 && f < 192} />
      </div>
      <Notch at={-20} w={240} h={64} color={INK} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------ 5b. AGENTS (250f) — spins up coding agents, verifies on screen
const AGENT_JOBS: Array<{title: string; line: string; status: string; eye?: boolean}> = [
  {title: 'agent 1 · peak', line: 'fix(tests): await flush()', status: 'tests pass ✓'},
  {title: 'agent 2 · notch', line: 'chore: tidy sources', status: 'PR #142 opened ✓'},
  {title: 'agent 3 · verify', line: 'screenshot → compare', status: 'verified on screen', eye: true},
];

export const Agents: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: PAPER}}>
      <Fix x={960} y={250}>
        <Line at={8} size={80} words={[{t: 'It spins up'}, {t: 'coding agents.', blue: true, weight: 700}]} per={18} />
      </Fix>
      {AGENT_JOBS.map((j, i) => {
        const at = 50 + i * 26;
        const rise = spring({frame: f - at, fps, config: {damping: 14, stiffness: 100, mass: 0.95}});
        const doneAt = 140 + i * 22;
        const done = spring({frame: f - doneAt, fps, config: {damping: 12, stiffness: 170, mass: 0.7}});
        const typedN = Math.max(0, Math.floor((f - at - 18) * 0.9));
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 350 + i * 420,
              top: 430 + i * 60,
              opacity: Math.min(1, rise * 1.4),
              transform: `translateY(${(1 - rise) * 80}px) rotate(${(i - 1) * 1.6}deg)`,
            }}
          >
            <div
              style={{
                width: 560,
                borderRadius: 22,
                background: NIGHT,
                boxShadow: '0 34px 80px rgba(13,17,23,0.30)',
                padding: '24px 30px 26px',
              }}
            >
              <div style={{display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16}}>
                {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
                  <div key={c} style={{width: 12, height: 12, borderRadius: 6, background: c}} />
                ))}
                <span style={{fontFamily: F, fontSize: 20, color: 'rgba(255,255,255,0.55)', marginLeft: 10, fontWeight: 400}}>{j.title}</span>
              </div>
              <div style={{fontFamily: 'SF Mono, Menlo, monospace', fontSize: 22, color: '#9CC4FF', minHeight: 30}}>
                <span style={{color: '#4ADE80'}}>❯ </span>
                {j.line.slice(0, typedN)}
                <span style={{opacity: Math.sin(f / 7) > 0 ? 0.9 : 0, color: BLUE}}>▏</span>
              </div>
              <div
                style={{
                  marginTop: 18,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 20px',
                  borderRadius: 999,
                  background: 'rgba(94,158,255,0.16)',
                  border: '1.5px solid rgba(94,158,255,0.45)',
                  fontFamily: F,
                  fontSize: 21,
                  fontWeight: 700,
                  color: BLUE,
                  transform: `scale(${done})`,
                  transformOrigin: 'left center',
                }}
              >
                {j.eye ? (
                  <svg width={24} height={16} viewBox="0 0 24 16">
                    <path d="M1 8 C5 2 19 2 23 8 C19 14 5 14 1 8 Z" fill="none" stroke={BLUE} strokeWidth={2} />
                    <circle cx={12} cy={8} r={3.4} fill={BLUE} />
                  </svg>
                ) : null}
                {j.status}
              </div>
            </div>
          </div>
        );
      })}
      <Fix x={960} y={935}>
        <Word t="— and checks their work with its own eyes." at={190} size={42} color={GRAY} italic />
      </Fix>
      <Notch at={-20} w={240} h={64} color={INK} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------ 6b. MISSION (500f) — one complex job, end to end
const Station: React.FC<{title: string; n: number; active: boolean; children: React.ReactNode}> = ({title, n, active, children}) => (
  <div>
    <div style={{display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24}}>
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          background: active ? BLUE : '#FFFFFF',
          color: active ? '#FFF' : GRAY,
          border: active ? 'none' : `2px solid ${HAIR}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: F,
          fontSize: 26,
          fontWeight: 700,
          boxShadow: active ? '0 10px 28px rgba(94,158,255,0.45)' : 'none',
        }}
      >
        {n}
      </div>
      <span style={{fontFamily: F, fontSize: 34, fontWeight: 700, color: INK}}>{title}</span>
    </div>
    {children}
  </div>
);

const MRow: React.FC<{t: string; at: number; f: number}> = ({t, at, f}) => (
  <div style={{display: 'flex', gap: 14, alignItems: 'center', padding: '8px 0', opacity: f >= at ? 1 : 0.22, fontFamily: F, fontSize: 27, color: '#39404C'}}>
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        background: f >= at ? BLUE : 'transparent',
        border: f >= at ? 'none' : `2.5px solid rgba(13,17,23,0.18)`,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 15,
        fontWeight: 700,
      }}
    >
      {f >= at ? '✓' : ''}
    </div>
    {t}
  </div>
);

export const Mission: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const scan = interpolate(f, [292, 356], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad)});
  const okChip = spring({frame: f - 366, fps, config: {damping: 12, stiffness: 160, mass: 0.7}});
  const report = spring({frame: f - 420, fps, config: {damping: 13, stiffness: 110, mass: 0.9}});
  const connectorP = interpolate(f, [40, 470], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{background: PAPER}}>
      <Cam2D
        w={5400}
        h={2000}
        keys={[
          {f: 0, x: 980, y: 1120, s: 1.02},
          {f: 118, x: 1010, y: 1130, s: 1.05},
          {f: 138, x: 2320, y: 1110, s: 1.02},
          {f: 246, x: 2350, y: 1120, s: 1.06},
          {f: 268, x: 3620, y: 1110, s: 1.04},
          {f: 376, x: 3650, y: 1120, s: 1.06},
          {f: 396, x: 4680, y: 1100, s: 1.05},
          {f: 452, x: 4680, y: 1105, s: 1.05},
          {f: 499, x: 2780, y: 1120, s: 0.42},
        ]}
      >
        {/* connector spine */}
        <div style={{position: 'absolute', left: 980, top: 1450, width: 3700, height: 3, background: 'rgba(13,17,23,0.10)', borderRadius: 2}} />
        <div style={{position: 'absolute', left: 980, top: 1450, width: 3700 * connectorP, height: 3, background: BLUE, borderRadius: 2, boxShadow: '0 0 14px rgba(94,158,255,0.6)'}} />
        {/* station 1 — the ask + plan */}
        <div style={{position: 'absolute', left: 620, top: 800}}>
          <Station title="Plan" n={1} active={f > 20}>
            <div style={{padding: '20px 30px', background: BLUE, color: '#fff', borderRadius: '26px 26px 6px 26px', fontFamily: F, fontSize: 29, fontWeight: 400, width: 640, boxShadow: '0 16px 40px rgba(94,158,255,0.35)'}}>
              “Ship the pricing-page fix — test it, and tell the team.”
            </div>
            <div style={{marginTop: 22, background: '#FFF', borderRadius: 22, border: `1px solid ${HAIR}`, boxShadow: CARD_SHADOW, padding: '24px 32px', width: 620}}>
              <MRow t="Patch the stylesheet" at={46} f={f} />
              <MRow t="Run the test suite" at={66} f={f} />
              <MRow t="Verify the live page — visually" at={86} f={f} />
              <MRow t="Post the update in #team" at={106} f={f} />
            </div>
          </Station>
        </div>
        {/* station 2 — coding agents */}
        <div style={{position: 'absolute', left: 1950, top: 810}}>
          <Station title="Ship" n={2} active={f > 140}>
            {[
              {t: 'agent 1 · css', line: 'fix: clamp() price cards', badge: 'tests pass ✓', at: 150},
              {t: 'agent 2 · deploy', line: 'merge → deploy preview', badge: 'PR #147 merged ✓', at: 172},
            ].map((a, i) => {
              const rise = spring({frame: f - a.at, fps, config: {damping: 14, stiffness: 100, mass: 0.9}});
              const done = spring({frame: f - a.at - 66, fps, config: {damping: 12, stiffness: 170, mass: 0.7}});
              const typedN = Math.max(0, Math.floor((f - a.at - 12) * 0.85));
              return (
                <div key={i} style={{opacity: Math.min(1, rise * 1.4), transform: `translateY(${(1 - rise) * 60}px)`, marginBottom: 20}}>
                  <div style={{width: 640, borderRadius: 20, background: NIGHT, boxShadow: '0 26px 60px rgba(13,17,23,0.28)', padding: '20px 26px'}}>
                    <div style={{display: 'flex', gap: 7, alignItems: 'center', marginBottom: 12}}>
                      {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
                        <div key={c} style={{width: 11, height: 11, borderRadius: 6, background: c}} />
                      ))}
                      <span style={{fontFamily: F, fontSize: 19, color: 'rgba(255,255,255,0.55)', marginLeft: 8}}>{a.t}</span>
                    </div>
                    <div style={{fontFamily: 'SF Mono, Menlo, monospace', fontSize: 21, color: '#9CC4FF', minHeight: 28}}>
                      <span style={{color: '#4ADE80'}}>❯ </span>
                      {a.line.slice(0, typedN)}
                    </div>
                    <div style={{marginTop: 12, display: 'inline-flex', padding: '7px 18px', borderRadius: 999, background: 'rgba(94,158,255,0.16)', border: '1.5px solid rgba(94,158,255,0.45)', fontFamily: F, fontSize: 19, fontWeight: 700, color: BLUE, transform: `scale(${done})`, transformOrigin: 'left center'}}>
                      {a.badge}
                    </div>
                  </div>
                </div>
              );
            })}
          </Station>
        </div>
        {/* station 3 — visual verification */}
        <div style={{position: 'absolute', left: 3280, top: 800}}>
          <Station title="Verify — with its eyes" n={3} active={f > 270}>
            <div style={{position: 'relative', width: 680, borderRadius: 20, background: '#FFF', border: `1px solid ${HAIR}`, boxShadow: CARD_SHADOW, overflow: 'hidden'}}>
              <div style={{display: 'flex', gap: 7, alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${HAIR}`}}>
                {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
                  <div key={c} style={{width: 11, height: 11, borderRadius: 6, background: c}} />
                ))}
                <span style={{fontFamily: F, fontSize: 18, color: GRAY, marginLeft: 8}}>pricing — live</span>
              </div>
              <div style={{padding: '24px 26px', position: 'relative'}}>
                <div style={{display: 'flex', gap: 18}}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{flex: 1, borderRadius: 14, border: i === 1 ? `2px solid ${BLUE}` : `1px solid ${HAIR}`, padding: '18px 16px', background: i === 1 ? 'rgba(94,158,255,0.06)' : '#FFF'}}>
                      <div style={{width: '62%', height: 13, borderRadius: 7, background: 'rgba(13,17,23,0.10)', marginBottom: 12}} />
                      <div style={{fontFamily: F, fontSize: 30, fontWeight: 700, color: INK}}>{['$0', '$19', '$49'][i]}</div>
                      <div style={{width: '84%', height: 10, borderRadius: 6, background: 'rgba(13,17,23,0.07)', marginTop: 12}} />
                    </div>
                  ))}
                </div>
                {/* eye-scan sweep */}
                {scan > 0 && scan < 1 ? (
                  <div style={{position: 'absolute', left: 0, right: 0, top: `${scan * 100}%`, height: 3, background: BLUE, boxShadow: `0 0 22px ${BLUE}`, opacity: 0.85}} />
                ) : null}
                {scan > 0 && scan < 1 ? (
                  <div style={{position: 'absolute', inset: 10, border: `2px solid ${BLUE}55`, borderRadius: 12}} />
                ) : null}
              </div>
              <div style={{position: 'absolute', right: 18, bottom: 14, transform: `scale(${okChip})`, transformOrigin: 'bottom right', display: 'inline-flex', alignItems: 'center', gap: 9, padding: '9px 20px', borderRadius: 999, background: 'rgba(94,158,255,0.14)', border: `1.5px solid rgba(94,158,255,0.5)`, fontFamily: F, fontSize: 20, fontWeight: 700, color: BLUE_DEEP}}>
                <svg width={22} height={15} viewBox="0 0 24 16">
                  <path d="M1 8 C5 2 19 2 23 8 C19 14 5 14 1 8 Z" fill="none" stroke={BLUE_DEEP} strokeWidth={2} />
                  <circle cx={12} cy={8} r={3.2} fill={BLUE_DEEP} />
                </svg>
                matches the spec
              </div>
            </div>
          </Station>
        </div>
        {/* station 4 — report */}
        <div style={{position: 'absolute', left: 4420, top: 860}}>
          <Station title="Report" n={4} active={f > 400}>
            <div style={{opacity: Math.min(1, report * 1.4), transform: `translateY(${(1 - report) * 50}px)`}}>
              <div style={{width: 540, background: '#FFF', borderRadius: 22, border: `1px solid ${HAIR}`, boxShadow: CARD_SHADOW, padding: '26px 32px'}}>
                <div style={{fontFamily: F, fontSize: 22, fontWeight: 700, color: GRAY, marginBottom: 12}}># team</div>
                <div style={{display: 'inline-block', padding: '14px 20px', borderRadius: 14, background: 'rgba(94,158,255,0.10)', border: `1px solid rgba(94,158,255,0.3)`, fontFamily: F, fontSize: 23, color: INK}}>
                  Pricing fix is live — tested and verified on screen. ✓
                </div>
              </div>
            </div>
          </Station>
        </div>
      </Cam2D>
      {/* fixed heading */}
      <Fix x={960} y={92}>
        <Line at={6} size={56} words={[{t: 'One job,'}, {t: 'end to end.', blue: true, italic: true, weight: 700}]} per={20} />
      </Fix>
      <Notch at={-20} w={240} h={64} color={INK} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------ 4. DONE (250f) — liquid bar → check → confetti
export const Done: React.FC = () => {
  const f = useCurrentFrame();
  const p = interpolate(f, [12, 126], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const rows = Math.round(p * 47);
  const done = f >= 132;
  const barOut = interpolate(f, [126, 140], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad)});
  return (
    <AbsoluteFill style={{background: PAPER}}>
      <NotchReveal>
        <AbsoluteFill style={{background: PAPER}}>
          {!done || barOut > 0.02 ? (
            <>
              <Fix x={960} y={572}>
                <div style={{opacity: barOut, transform: `scale(${0.9 + barOut * 0.1})`}}>
                  <LiquidBar w={1380} p={p} />
                </div>
              </Fix>
              <div style={{position: 'absolute', left: 268, top: 380, fontFamily: F, fontSize: 34, fontWeight: 400, color: GRAY, opacity: barOut}}>
                fixing the Q2 report…
              </div>
              <div style={{position: 'absolute', right: 268, top: 330, fontFamily: F, fontWeight: 700, letterSpacing: '0em', opacity: barOut}}>
                <span style={{fontSize: 110, color: BLUE_DEEP}}>{rows}</span>
                <span style={{fontSize: 66, color: '#B9C2D0'}}>/47 rows</span>
              </div>
            </>
          ) : null}
          {done ? (
            <>
              <Fix x={960} y={330}>
                <Word t="Done" at={138} size={148} weight={700} />
              </Fix>
              <Fix x={960} y={585}>
                <GlassCheck at={134} />
              </Fix>
              <Fix x={960} y={800}>
                <Word t="$12,400 recovered — before you were back" at={172} size={40} color={GRAY} italic />
              </Fix>
            </>
          ) : null}
          <Confetti at={140} />
        </AbsoluteFill>
      </NotchReveal>
      <Notch at={-20} w={240} h={64} color={INK} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------ 5. CAROUSEL (200f) — everything it did today
const RECEIPTS: Array<[string, string]> = [
  ['Replied to Sarah', "deck committed for Friday"],
  ['Fixed the Q2 report', '$12,400 duplicate removed'],
  ['Learned a skill', 'toggle-dark-mode · 5.9s'],
  ['Posted to #ops', 'summary with links'],
  ['Ran 6 agents', 'overnight, unattended'],
  ['Rebuilt itself', 'new build running'],
  ['Remembered it all', 'graph memory + vault'],
  ['Ready again', 'hold fn anytime'],
];

export const Carousel: React.FC = () => {
  const f = useCurrentFrame();
  const drive = interpolate(f, [0, 199], [300, -2350], {easing: Easing.bezier(0.3, 0, 0.4, 1)});
  return (
    <AbsoluteFill style={{background: PAPER}}>
      <Fix x={960} y={300}>
        <Line at={8} size={78} words={[{t: 'Everything it does,'}, {t: 'it remembers.', blue: true, italic: true, weight: 700}]} per={22} />
      </Fix>
      <div style={{position: 'absolute', top: 500, left: 0, right: 0, height: 360}}>
        {RECEIPTS.map(([t, d], i) => {
          const x = drive + i * 500;
          const prox = Math.max(0, 1 - Math.abs(x + 210 - 960) / 900);
          return (
            <div key={i} style={{position: 'absolute', left: x, top: 40 - prox * 26, transform: `scale(${0.92 + prox * 0.1})`}}>
              <Card w={430} pad={'34px 38px'} style={{borderRadius: 26, boxShadow: `0 ${14 + prox * 20}px ${40 + prox * 30}px rgba(13,17,23,${0.08 + prox * 0.05})`}}>
                <div style={{width: 44, height: 22, background: INK, borderRadius: '0 0 10px 10px', marginBottom: 18}} />
                <div style={{fontFamily: F, fontSize: 31, fontWeight: 700, color: INK, letterSpacing: '0em'}}>{t}</div>
                <div style={{fontFamily: F, fontSize: 23, fontWeight: 400, color: BLUE_DEEP, marginTop: 9}}>{d}</div>
              </Card>
            </div>
          );
        })}
      </div>
      <Notch at={-20} w={240} h={64} color={INK} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------ 6. FINALE (250f) — the real product, then the mark
export const Finale: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const panel = spring({frame: f - 8, fps, config: {damping: 14, stiffness: 90, mass: 1}});
  const out = interpolate(f, [108, 128], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad)});
  return (
    <AbsoluteFill style={{background: PAPER}}>
      <NotchReveal>
        <AbsoluteFill style={{background: PAPER}}>
          {/* the actual product */}
          <Fix x={960} y={505}>
            <div
              style={{
                opacity: Math.min(1, panel * 1.4) * (1 - out),
                transform: `scale(${(0.86 + 0.14 * panel) * (1 + out * 0.12)}) `,
                filter: out > 0.05 ? `blur(${out * 10}px)` : undefined,
              }}
            >
              <div
                style={{
                  width: 1080,
                  borderRadius: '0 0 44px 44px',
                  background: 'linear-gradient(180deg, #000 0%, #0c0c10 26%, #15151c 100%)',
                  boxShadow: '0 50px 110px rgba(13,17,23,0.35), 0 0 0 1px rgba(255,255,255,0.06)',
                  padding: '86px 58px 46px',
                  position: 'relative',
                }}
              >
                <div style={{position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 330, height: 64, background: '#000', borderRadius: '0 0 24px 24px'}} />
                <div style={{display: 'flex', alignItems: 'center', gap: 15, marginBottom: 20}}>
                  <div style={{width: 15, height: 15, borderRadius: 8, background: '#4ADE80', boxShadow: '0 0 14px #4ADE80'}} />
                  <span style={{fontFamily: F, fontSize: 27, fontWeight: 700, color: 'rgba(255,255,255,0.85)'}}>Done</span>
                  <span style={{fontFamily: F, fontSize: 22, color: 'rgba(255,255,255,0.45)', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9}}>
                    <svg width={24} height={16} viewBox="0 0 24 16">
                      <path d="M1 8 C5 2 19 2 23 8 C19 14 5 14 1 8 Z" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={1.8} />
                      <circle cx={12} cy={8} r={3.2} fill="rgba(255,255,255,0.45)" />
                    </svg>
                    saw it through
                  </span>
                </div>
                <div style={{fontFamily: F, fontSize: 36, fontWeight: 400, color: '#FFF', lineHeight: 1.35}}>
                  The Q2 report is fixed — finance has the correction, and #ops has the summary.
                </div>
                <div style={{marginTop: 26, display: 'inline-flex', gap: 12, alignItems: 'center', padding: '13px 26px', borderRadius: 999, background: 'rgba(94,158,255,0.16)', border: `1.5px solid rgba(94,158,255,0.4)`, fontFamily: F, fontSize: 25, fontWeight: 700, color: BLUE}}>
                  ✨ Learned: fix-quarterly-report
                </div>
              </div>
            </div>
          </Fix>
          {/* the mark */}
          <Fix x={960} y={470}>
            <Word t="Notch" at={134} size={220} weight={700} />
          </Fix>
          <Fix x={960} y={660}>
            <Word t="The Era of Intuitive Intelligence is here" at={165} size={46} color={GRAY} italic />
          </Fix>
        </AbsoluteFill>
      </NotchReveal>
      <Notch at={-20} w={330} h={88} color={INK} />
    </AbsoluteFill>
  );
};

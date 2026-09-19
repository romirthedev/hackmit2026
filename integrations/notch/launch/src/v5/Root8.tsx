import React from 'react';
import {AbsoluteFill, Audio, Composition, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Agents, AnyApp, Carousel, Done, Finale, First, Intuitive, Mission, Open, Prompt8, Tunnel} from './scenes8';

// bar = 50 frames (144 BPM after 0.9% speedup); all cuts on bars. total 2900f (96.7s)
const SCENES: Array<{key: string; dur: number; C: React.FC; vo: Array<{k: string; at: number}>}> = [
  {key: 'open', dur: 250, C: Open, vo: [{k: 'open', at: 66}]},
  {key: 'first', dur: 150, C: First, vo: [{k: 'first', at: 34}]},
  {key: 'intuitive', dur: 300, C: Intuitive, vo: [{k: 'intuitive1', at: 16}, {k: 'intuitive2', at: 160}]},
  {key: 'prompt', dur: 200, C: Prompt8, vo: [{k: 'prompt', at: 30}]},
  {key: 'anyapp', dur: 250, C: AnyApp, vo: [{k: 'anyapp', at: 26}]},
  {key: 'tunnel', dur: 300, C: Tunnel, vo: [{k: 'tunnel', at: 20}]},
  {key: 'agents', dur: 250, C: Agents, vo: [{k: 'agents', at: 44}]},
  {key: 'mission', dur: 500, C: Mission, vo: [{k: 'mission1', at: 12}, {k: 'mission2', at: 286}]},
  {key: 'done', dur: 250, C: Done, vo: [{k: 'done', at: 22}]},
  {key: 'carousel', dur: 200, C: Carousel, vo: [{k: 'carousel', at: 26}]},
  {key: 'finale', dur: 250, C: Finale, vo: [{k: 'end', at: 106}]},
];
export const TOTAL = SCENES.reduce((a, s) => a + s.dur, 0);

// SFX cues (absolute frames)
const START = (k: string) => {
  let at = 0;
  for (const s of SCENES) {
    if (s.key === k) return at;
    at += s.dur;
  }
  return 0;
};
const SFX: Array<{file: string; at: number; vol: number}> = [
  // word pops in the open
  ...[8, 22, 68, 80, 118, 128].map((at) => ({file: 'sfx-pop.wav', at, vol: 0.3})),
  // whooshes on chapter cuts
  ...SCENES.slice(1).map((s) => ({file: 'sfx-whoosh.wav', at: START(s.key) - 4, vol: 0.3})),
  // tunnel word pops
  ...[15, 80, 145, 214, 238].map((at) => ({file: 'sfx-pop.wav', at: START('tunnel') + at, vol: 0.26})),
  // first + anyapp + agents word pops
  ...[8, 38, 88].map((at) => ({file: 'sfx-pop.wav', at: START('first') + at, vol: 0.3})),
  ...[16, 118, 178].map((at) => ({file: 'sfx-pop.wav', at: START('anyapp') + at, vol: 0.28})),
  ...[140, 162, 184].map((at) => ({file: 'sfx-pop.wav', at: START('agents') + at, vol: 0.26})),
  // intuitive: stamps + panel fold
  ...[38, 80, 150, 196].map((at) => ({file: 'sfx-pop.wav', at: START('intuitive') + at, vol: 0.3})),
  // mission: station whooshes + status pops
  ...[128, 258, 386].map((at) => ({file: 'sfx-whoosh.wav', at: START('mission') + at, vol: 0.26})),
  ...[106, 216, 238, 366, 428].map((at) => ({file: 'sfx-pop.wav', at: START('mission') + at, vol: 0.26})),
  // done chime + confetti
  {file: 'sfx-chime.wav', at: START('done') + 132, vol: 0.5},
  {file: 'sfx-pop.wav', at: START('done') + 140, vol: 0.34},
  // finale mark
  {file: 'sfx-chime.wav', at: START('finale') + 134, vol: 0.4},
];

const EndFade: React.FC<{children: React.ReactNode}> = ({children}) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [TOTAL - 26, TOTAL - 2], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{opacity: o}}>{children}</AbsoluteFill>;
};

const Launch: React.FC = () => {
  let at = 0;
  const seqs = SCENES.map((s) => {
    const el = (
      <Sequence key={s.key} from={at} durationInFrames={s.dur}>
        <s.C />
        {s.vo.map((v) => (
          <Sequence key={v.k} from={v.at}>
            <Audio src={staticFile(`vo/v8-${v.k}.mp3`)} volume={1} />
          </Sequence>
        ))}
      </Sequence>
    );
    at += s.dur;
    return el;
  });
  return (
    <EndFade>
      {seqs}
      {SFX.map((s, i) => (
        <Sequence key={`sfx${i}`} from={Math.max(0, s.at)}>
          <Audio src={staticFile(s.file)} volume={s.vol} />
        </Sequence>
      ))}
    </EndFade>
  );
};

export const RemotionRoot: React.FC = () => (
  <Composition id="Launch" component={Launch} durationInFrames={TOTAL} fps={30} width={1920} height={1080} />
);

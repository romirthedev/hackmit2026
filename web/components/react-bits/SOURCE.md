# React Bits sources

Source: https://github.com/DavidHDev/react-bits
Pinned commit: 23b6d2c0ab10b949c7891b3e76b2f801dff186a3

These are actual upstream components, included as part of the REWIND application under the adjacent license. Original paths:

- `src/ts-default/Animations/StarBorder/StarBorder.css`
- `src/ts-default/Animations/StarBorder/StarBorder.tsx`
- `src/ts-default/Backgrounds/Aurora/Aurora.css`
- `src/ts-default/Backgrounds/Aurora/Aurora.tsx`
- `src/ts-default/Components/AnimatedList/AnimatedList.tsx`
- `src/ts-default/Components/SpotlightCard/SpotlightCard.css`
- `src/ts-default/Components/SpotlightCard/SpotlightCard.tsx`
- `src/ts-default/TextAnimations/CountUp/CountUp.tsx`

REWIND changes: client directives, scoped styling at integration points, typed button/span composition, one-time counter initialization, reduced motion, bounded shader rendering, viewport/visibility pause, graceful WebGL fallback, and application-provided content. AnimatedItem is extracted from AnimatedList so its animation can wrap real accessible recording buttons without the upstream global keyboard handler.

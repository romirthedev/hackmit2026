# Interface sources and controls

The current interface uses actual React Bits sources alongside the installed shadcn/Base UI components listed on 21st.dev. This replaces the earlier pass of homemade approximations. The dashboard layout, spacing, color palette, branding, and REWIND data bindings are application-specific compositions of these components. Recording images are the user's original evidence, never component demo imagery.

## Sourced components

| Component | Source | Where it is used |
|---|---|---|
| Aurora | [React Bits](https://reactbits.dev/backgrounds/aurora) | Sign-in visual and empty recording preview; actual OGL shader |
| Star Border | [React Bits](https://reactbits.dev/animations/star-border) | Primary actions, composed with shadcn Button |
| Spotlight Card | [React Bits](https://reactbits.dev/components/spotlight-card) | Original recording cards with pointer/focus highlights |
| Animated List / AnimatedItem | [React Bits](https://reactbits.dev/components/animated-list) | Recording entry animation, extracted around accessible buttons |
| Count Up | [React Bits](https://reactbits.dev/text-animations/count-up) | Real saved/ready/processing counters; storage uses exact formatted bytes |
| Button | [shadcn on 21st](https://21st.dev/@shadcn/components/button) | All visible application buttons, including replay, microphone, import, search, evidence, and settings |
| Card | [shadcn on 21st](https://21st.dev/@shadcn/components/card) | Metrics, preview, recall, answers, device details, sign-in and empty states |
| Sidebar | [shadcn on 21st](https://21st.dev/@shadcn/components/sidebar) | Desktop workspace navigation and mobile sheet |
| Input OTP | [shadcn on 21st](https://21st.dev/@shadcn/components/input-otp) | Eight-digit pairing sign-in, including paste and numeric input |
| Command | [shadcn on 21st](https://21st.dev/@shadcn/components/command) | Command/Ctrl+K search across actual recordings and workspace actions |
| Additional shadcn primitives | [21st shadcn catalog](https://21st.dev/@shadcn) | Input, Textarea, Checkbox, Accordion, Tabs, ToggleGroup, Slider, Progress, AspectRatio, Popover, Dialog, AlertDialog, Sheet |

The 21st pages were inspected using computer use. The installed shadcn implementation uses Base UI; catalog pages may show a different primitive version. No unknown-license dashboard template was copied. React Bits code was retrieved from its official public repository at pinned commit `23b6d2c0ab10b949c7891b3e76b2f801dff186a3`.

## License and local modifications

React Bits sources and their **MIT + Commons Clause License Condition v1.0** are retained together in [`web/components/react-bits`](../web/components/react-bits). The license permits use as part of an application; the components must not be sold or redistributed as a standalone component library. [`SOURCE.md`](../web/components/react-bits/SOURCE.md) records original paths and adaptations. The existing shadcn components retain their own MIT licensing.

Changes include client directives, typed button composition, spans inside Star Border buttons, removal of an unused type, counter initialization, and extracting AnimatedItem without AnimatedList's global keyboard listener. Aurora's shader is unchanged; its lifecycle is adapted for 24 fps, device pixel ratio 1, resize cleanup, out-of-view/background pausing, reduced motion, and unavailable WebGL. Reduced-motion users get static counters and entry transitions. No live CDN or reference-site connection is required; OGL and Motion are bundled locally.

## Preserved behavior

- Eight-digit sign-in, single-use links, advanced key fallback, remembered sessions, and the opt-in local `0000 0000` test code.
- Importing originals, actual microphone recording, capture pause/resume, replay selection and evidence downloads.
- Main search and questions share a date range. Quick search explicitly searches all time.
- Filters apply to currently loaded records. Grid/list layouts, keyboard list navigation and loading earlier recordings remain available.
- Recorded answers retain their citations. Monitoring, scene reconstruction, device health, retry and export still call the existing local API.
- All empty, processing and disconnected states reflect the server. No demo recordings, simulated activity, or generated evidence were added.

Run `pnpm build` inside `web` to update the dashboard served by FastAPI. See [README](../README.md) for hardware and server setup and [validation notes](VALIDATION.md) for what was actually verified.

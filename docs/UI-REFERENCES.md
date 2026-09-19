# Interface references and controls

The September 19, 2026 interface pass used computer use to visit 21st.dev and ReactBits, inspect their live component pages, and adapt nine patterns to REWIND. These are original implementations composed with the repository's existing shadcn/Base UI and cmdk components. No new runtime dependency, copied demo data, or third-party component source was added. Existing dependencies retain their own licenses.

| Pattern | Reference visited | REWIND implementation |
|---|---|---|
| Command palette | [shadcn Command on 21st](https://21st.dev/@shadcn/components/command) | **Quick search**, opened with Command/Ctrl+K. Debounced search across actual recordings, recent memories, section navigation, and import. Arrow keys and Enter select; Escape closes. Requests cancel when the query changes or the dialog closes. |
| Question composer | [Vlad Vovk's AI Prompt Input on 21st](https://21st.dev/@senommu/components/ai-prompt-input) | Expanding text area, contextual AI label, character count, voice action, and submit control. Command/Ctrl+Enter submits. The toolbar reflects the configured provider; the request uses the existing question API. |
| Spotlight cards | [ReactBits Spotlight Card](https://reactbits.dev/components/spotlight-card) | Soft pointer-following highlights on real recording cards, with a keyboard focus equivalent. |
| Animated memory list | [ReactBits Animated List](https://reactbits.dev/components/animated-list) | Grid/list switch, short staggered entry transitions, stable recording keys, and compact list rows. Up/Down/Home/End navigate the list's recording buttons; Enter opens evidence. |
| Animated counters | [ReactBits Count Up](https://reactbits.dev/text-animations/count-up) | Counters ease between actual API updates. Assistive technology receives the final value rather than intermediate animation values. Initial counts are immediately accurate. |
| Selection controls | [ReactBits Glide Select](https://reactbits.dev/micro/glide-select) | Pill-shaped All/Frames/Audio filters, counts, and clearly selected states, adapted as accessible installed toggle groups rather than a dropdown. |
| Visual filmstrip | [ReactBits Carousel](https://reactbits.dev/components/carousel) | A bounded strip of up to eight nearby original recordings. Select a thumbnail to replay that moment. The selected recording stays in view and remains selected when newer recordings arrive. |
| Processing journey | [ReactBits Stepper](https://reactbits.dev/components/stepper) | Saved → Processing → Ready counts, analyzed fraction, failure count, and a link to Device & storage. This is a read-only view of server state, not an estimated timer or a setup wizard. |
| Voice recording pill | [ReactBits Voice Pill](https://reactbits.dev/micro/voice-pill) | Real microphone permission, recording, and upload states with elapsed time and the existing 30-second question / 60-second conversation limits. No simulated audio waveform. Stop remains available during recording. |

## Behavior details

- Quick search searches **all time** and labels this explicitly. The main search and question composer retain their shared date range.
- Frames/Audio filter the **currently loaded** recordings or search results. Load earlier recordings to expand the history. They do not imply that the complete archive has been loaded.
- Empty, loading, search error, recording failure, and disconnected-device states use actual server state. No example recordings or generated answers are inserted.
- The new motion respects `prefers-reduced-motion`. Pointer effects do not run for touch input. All key actions remain available as visible controls.
- The interface uses the same local API and authentication. External reference sites are not contacted by the running app.

## Implementation

- `web/components/memory-command.tsx`: command navigation and cancellable search.
- `web/components/memory-composer.tsx`: question input and keyboard submission.
- `web/components/memory-library.tsx`: filters, layouts, recording cards, and list navigation.
- `web/components/memory-details.tsx`: counters, spotlight, status badges, filmstrip, and processing journey.
- `web/components/audio-capture.tsx`: actual browser recording and elapsed-time display.
- `web/app/memory-interactions.css`: shared responsive styling and motion.

Run `pnpm build` in `web` after source edits to update the dashboard served by FastAPI. See [README](../README.md) for the complete hardware and server setup, and [validation notes](VALIDATION.md) for the verification boundary.

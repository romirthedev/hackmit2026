# Saved-memory recall and orb startup repair

September 20, 2026. Personal recordings, exact extracted text, query outputs and source IDs remain in the ignored `data/dorm-audit/` directory; they are not repository fixtures.

## Problems corrected

- Compact frame descriptions previously requested one sentence of at most 24 words and three tags. Text-bearing scenes now get a fuller pass over the original-resolution image, preserving clearly readable event details and object locations. Full observations have sufficient output budget. Unreadable text must remain explicitly uncertain.
- Search omitted object descriptions and locations, and did not update its text index when an observation changed. The additive index migration includes these fields and installs an update trigger. Original media and existing observations are not deleted.
- General workspace inventory requests could be answered by generic chat, incorrectly denying access to recordings. They now inspect a bounded, temporally distributed set of retained originals, including sources awaiting labels. Explicit time filters remain in force.
- Building-floor queries were dominated by the floor-surface meaning. A bounded search for building signs/directories, with ranking for explicit level-number labels, now nominates relevant originals. A sign does not by itself establish residence.
- Assistant-directed questions are not reused as evidence supporting their own assumptions.
- Uncited abstentions now use the `no_evidence` state; they no longer imply that an unqueued evidence review failed. Cited partial answers still require original-source review.
- Yearless printed dates are reported without inventing a year or assuming past/future status.

## Interaction change

Phone and desktop commit an opening-microphone state before native audio setup. The orb responds immediately, with a short optional vibration on supporting browsers. Actual listening begins only after the recorder starts. A second tap cancels startup, including a pending permission request or suspended audio context. Motion starts without the prior slow shader interpolation and 700 ms visual transition.

## Validation

- Full isolated backend suite: 374 tests passed before the final building-floor refinement; 106 focused recall, routing, source-review and provider tests passed afterward.
- TypeScript and lint passed; production web build passed.
- Microphone lifecycle checks passed, including permission/readiness, cancellation during audio resume, shared-track preservation, and Safari activation ordering.
- Real ASUS inference and original-image review were exercised against private copies, then against the existing live app for the reported event-date, building-floor and workspace-inventory questions. Event dates returned a verified answer; floor and inventory returned reviewed partial answers instead of blanket abstention.
- Personal originals were backed up by database snapshot and source manifests before derived-label repair. The pre-repair inventory remains available privately. Known misread text in blurry frames received conservative, separately attributed original-image corrections.

The orb changes were built and deployed to the existing private phone service. Actual vibration/animation feel on a physical phone remains a device check; unsupported vibration falls back to visual feedback. Automatic frame labels remain retrieval hints, not independently verified facts. Answer review still inspects original pixels.

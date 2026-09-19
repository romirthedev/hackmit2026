# User-confirmed people memory

The phone's **Your connections → Faces & names** panel lets the owner select
a retained original picture, choose a detected face and explicitly confirm a
name. Existing contacts never identify a face automatically. Several pictures
can be enrolled for one person by explicitly selecting that saved person.

Each confirmation stores the original media ID and SHA-256, normalized face
region, encoder revision, confirmation time and a retry-safe request ID. Name
corrections use a version check. A wrong picture-to-person link can be removed
without changing the other confirmed pictures. Forgetting a person revokes their
name links and removes their enrolled face templates from matching. Corrections
and revocations keep an audit history; originals and unnamed derived features
remain saved. They are not represented as erased recordings.

After the first person is explicitly enrolled, a low-priority background loop
checks retained frames on the ASUS. It indexes the original pixels using CPU
YuNet detection and SFace features; it does not take GPU slots from Qwen. The
phone reports checked/retained frame counts and can show **possible appearances**
of a confirmed person. Any candidate is a suggestion to review against the
original, not a fact that the person attended an event. Unknown or ambiguous
faces receive no name. Face suggestions are not inserted into verified general
question-answering as identity facts.

## Models and reproducibility

Run on the ASUS from the project directory:

```sh
.venv/bin/python -m pip install --no-deps opencv-python-headless==4.11.0.86
.venv/bin/python scripts/setup_faces.py
```

The optional `faces` package extra declares this same OpenCV dependency.
The setup script downloads approximately 38.9 MB from the official
[OpenCV Zoo](https://github.com/opencv/opencv_zoo) at commit
`47534e27c9851bb1128ccc0102f1145e27f23f98`. It verifies each Git LFS SHA-256
and exact byte length, keeps source metadata and license texts beside the
weights, and never downloads models during an inference request. Runtime
loading verifies the pinned hashes again.

- [YuNet](https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet): MIT;
  `face_detection_yunet_2023mar.onnx`, 232,589 bytes.
- [SFace](https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface): Apache-2.0;
  `face_recognition_sface_2021dec.onnx`, 38,696,353 bytes.

Both use OpenCV's CPU backend with two CPU threads. Detection requires a score
of at least 0.90 and a face at least 40 pixels wide and high in the analyzed
image. Similarity suggestions use cosine similarity at least 0.60 and a margin
of at least 0.10 above any differently named enrolled person. These are
conservative engineering heuristics, **not calibrated error rates**. Blur,
occlusion, pose, lighting, aging and similar-looking people still need real
device evaluation. A higher threshold does not establish a universal accuracy
guarantee.

## Validation and present limits

Automated tests exercise original hash checking, explicit confirmation,
idempotency, authentication, versioned corrections, single-link/person
revocation, removal of revoked matching templates, ambiguous/unknown abstention,
tentative sighting retrieval and activation only after enrollment. The tests
use controlled feature vectors to test decision behavior; they do not measure
face-recognition accuracy.

A real ASUS CPU run processed 31 retained original public kitchen POV frames
in 0.414 seconds including model loading. No sufficiently clear faces were
detected, so this was a negative-scene smoke test, not a positive recognition
benchmark. A live positive-flow smoke test used the
[public-domain NASA portrait distributed by scikit-image](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut),
explicitly named **Reference person** in an isolated test workspace. Actual
ASUS detection, Mac enrollment, repeated-photo candidate matching, a no-face
negative, background indexing of an uninspected fourth frame, rename and
revocation all passed. Three HTTP inference round trips in the final smoke
took 2.098, 0.737 and 0.528 seconds. This tests a
repeated photograph, not identity accuracy across different photos, poses or
people. No test person was inserted in the user's workspace. Original PNG,
JPEG serialization and test receipts are retained only under ignored `data/`.

Notch computer control was checked read-only: the native bridge returned HTTP
200, the Codex backend was idle, and Accessibility and Screen Recording
permissions were granted. The authorized production context connection then
succeeded for notes, calendar, contacts and mail. Nonempty note, calendar and
contact sources were imported; Mail returned no documents.
No appointment was in the 30-minute reminder window at that check. Reminder
deduplication, rescheduling, cancellation, errors, staleness and disconnect are
covered by tests; no actual future notification delivery is claimed yet.

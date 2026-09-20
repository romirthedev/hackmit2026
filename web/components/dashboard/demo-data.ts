import type { Alert, Answer, Recording, Rule, Status } from '@/lib/api';

// Original Raghav hackathon widget fixtures, labelled Demo widgets in the UI.
// These are never inserted into live recordings, recall answers, or evidence.

const now = Date.now() / 1000;
const at = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime() / 1000;
};
const pic = (seed: string, s = 640) =>
  `https://picsum.photos/seed/${seed}/${s}/${Math.round(s * 0.75)}`;

export const avatar = (seed: string, bg: string, extra = '') =>
  `https://api.dicebear.com/9.x/big-smile/svg?seed=${seed}&backgroundColor=${bg}${extra}`;

export const ROSE_AVATAR =
  'https://api.dicebear.com/10.x/big-smile/svg?seed=Rose&hairVariant=wavyBob&hairColor=e8e8e8&accessoriesVariant=glasses&accessoriesProbability=100&eyesVariant=cheery&mouthVariant=kawaii&skinColor=f5d0b0';

export const PEOPLE = [
  {
    name: 'Priya',
    role: 'Daughter',
    note: 'called this morning',
    img: avatar('Maya', 'ffdfbf'),
  },
  {
    name: 'Dana',
    role: 'Physiotherapist',
    note: 'here at 10',
    img: avatar('Leela', 'c0e0f5'),
  },
  {
    name: 'Sam',
    role: 'Grandson',
    note: 'coming with Priya',
    img: avatar('Max', 'c8ecd4'),
  },
  {
    name: 'Dr. Lee',
    role: 'Cambridge Clinic',
    note: 'next visit Oct 2',
    img: avatar('Anita', 'd9d4f7'),
  },
];

export const demoRecordings: Recording[] = [
  {
    id: 'r1',
    kind: 'frame',
    captured_at: at(9, 12),
    clock_quality: 'synced',
    status: 'done',
    summary: 'Reading glasses placed on the kitchen counter next to a kettle.',
    objects: [
      {
        label: 'glasses',
        description: 'reading glasses',
        location: 'kitchen counter',
        bbox: [0.4, 0.5, 0.2, 0.1],
        confidence: 0.91,
      },
    ],
    tags: ['kitchen', 'glasses'],
    confidence: 0.91,
    media_url: pic('rw-kitchen'),
    device: 'necklace',
  },
  {
    id: 'r2',
    kind: 'audio',
    captured_at: at(8, 41),
    clock_quality: 'synced',
    status: 'done',
    transcript:
      'I will leave the keys in my coat pocket so I do not forget them again.',
    tags: ['keys'],
    confidence: 0.86,
    media_url: '',
    device: 'necklace',
  },
  {
    id: 'r3',
    kind: 'frame',
    captured_at: at(8, 3),
    clock_quality: 'synced',
    status: 'done',
    summary:
      'A hand holding a white tablet and a glass of water at the dining table.',
    objects: [
      {
        label: 'pill',
        description: 'white tablet',
        location: 'dining table',
        bbox: [0.5, 0.4, 0.1, 0.1],
        confidence: 0.83,
      },
    ],
    tags: ['medication'],
    confidence: 0.83,
    media_url: pic('rw-table'),
    device: 'necklace',
  },
  {
    id: 'r4',
    kind: 'audio',
    captured_at: at(7, 48),
    clock_quality: 'synced',
    status: 'done',
    transcript:
      "Hi Mom, it's Priya. We'll be there around two with the kids. Don't cook, I'm bringing lunch.",
    tags: ['call', 'Priya'],
    confidence: 0.9,
    media_url: '',
    device: 'browser',
  },
  {
    id: 'r5',
    kind: 'frame',
    captured_at: at(7, 30),
    clock_quality: 'synced',
    status: 'done',
    summary:
      'Morning light through the living room window, a cardigan on the armchair.',
    tags: ['living room'],
    confidence: 0.78,
    media_url: pic('rw-window'),
    device: 'necklace',
  },
  {
    id: 'r6',
    kind: 'frame',
    captured_at: at(7, 12),
    clock_quality: 'synced',
    status: 'pending',
    summary: '',
    media_url: pic('rw-garden'),
    device: 'necklace',
  },
];

export const demoStatus: Status = {
  received: 1284,
  analyzed: 1271,
  pending: 9,
  failed: 4,
  stored_bytes: 12.4e9,
  free_bytes: 51.6e9,
  storage_limit_bytes: 64e9,
  last_capture: now - 12,
  average_analysis_ms: 1840,
  oldest_pending_at: now - 95,
  devices: [
    {
      id: 'necklace-01',
      last_seen: now - 6,
      state: {
        queued: 3,
        dropped: 0,
        rssi: -58,
        error: '',
        free_sd_bytes: 21.3e9,
      },
    },
  ],
  provider: 'ollama',
  model: 'qwen2.5-vl:7b',
  paused: false,
  observed_sequence_gaps: 2,
  embedding_failures: 0,
  timezone: 'America/New_York',
};

export const demoAnswers: Answer[] = [
  {
    id: 'a1',
    question: 'Where did I put my glasses?',
    answer:
      'On the kitchen counter, next to the kettle. You set them down at 9:12.',
    evidence: [demoRecordings[0]],
    created_at: at(9, 40),
    grounded: true,
    mode: 'wearable',
  },
  {
    id: 'a2',
    question: 'Did I take my pills this morning?',
    answer: 'Yes. You took one tablet with water at 8:03.',
    evidence: [demoRecordings[2]],
    created_at: at(8, 55),
    grounded: true,
    mode: 'wearable',
  },
  {
    id: 'a3',
    question: 'What did Priya say on the phone?',
    answer: 'She is coming around two with the kids and is bringing lunch.',
    evidence: [demoRecordings[3]],
    created_at: at(8, 10),
    grounded: true,
    mode: 'typed',
  },
];

export const demoRules: Rule[] = [
  {
    id: 'ru1',
    instruction: 'Tell me if the stove is left on for more than 20 minutes',
    enabled: 1,
  },
  {
    id: 'ru2',
    instruction: 'Notice if Rose has not moved for two hours during the day',
    enabled: 1,
  },
  {
    id: 'ru3',
    instruction: 'Alert me when the front door opens after 9 PM',
    enabled: 1,
  },
];

export const demoAlerts: Alert[] = [
  {
    id: 'al1',
    message:
      'Front door opened at 9:41 PM. Rose stepped onto the porch for about a minute.',
    event_id: 'r5',
    created_at: now - 3600 * 11,
    seen: 0,
  },
  {
    id: 'al2',
    message: 'Stove was on for 24 minutes. It was turned off at 6:52 PM.',
    event_id: 'r3',
    created_at: now - 3600 * 14,
    seen: 1,
  },
];

export const MEDS = [
  {
    name: 'Lisinopril 10 mg',
    time: '8:00',
    when: 'AM',
    taken: true,
    with: 'breakfast',
  },
  {
    name: 'Metformin 500 mg',
    time: '12:30',
    when: 'PM',
    taken: false,
    with: 'lunch',
  },
  {
    name: 'Vitamin D 1000 IU',
    time: '6:00',
    when: 'PM',
    taken: false,
    with: 'dinner',
  },
];
// 7 days x 3 doses, 1 taken, 0 missed, 2 upcoming
export const ADHERENCE = [
  [1, 1, 1],
  [1, 1, 1],
  [1, 0, 1],
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 0],
  [1, 2, 2],
];

export const WEEK_STEPS = [1.4, 0.3, 1.8, 1.0, 0.2, 2.4, 1.1];
export const WEEK_SLEEP = [7.2, 6.4, 7.8, 7.1, 5.9, 7.4, 7.6];

export const DAYS: [string, string, [string, string, string, string][]][] = [
  [
    'Monday',
    'September 14',
    [
      ['9:00', 'blue', 'Blood pressure check', 'Nurse visit · 20 min'],
      ['3:00', 'amber', 'Bridge club', 'Community center'],
    ],
  ],
  [
    'Tuesday',
    'September 15',
    [['11:00', 'pink', 'Call with Sam', 'He wants to show you his project']],
  ],
  [
    'Wednesday',
    'September 16',
    [
      ['10:00', 'blue', 'Physio with Dana', '45 min · at home'],
      ['1:00', 'amber', 'Grocery delivery', 'Leave the door unlocked'],
    ],
  ],
  ['Thursday', 'September 17', []],
  [
    'Friday',
    'September 18',
    [
      ['2:30', 'blue', 'Dr. Lee', 'Cambridge Clinic · Priya drives'],
      ['6:00', 'amber', 'Fish on Friday', 'Priya is cooking'],
    ],
  ],
  [
    'Saturday',
    'September 19',
    [
      ['10:00', 'blue', 'Physio with Dana', '45 min · at home'],
      ['2:00', 'pink', 'Priya visits', 'With Sam and Mia'],
      ['6:30', 'amber', 'Dinner', 'Soup in the fridge'],
    ],
  ],
  [
    'Sunday',
    'September 20',
    [
      ['9:30', 'pink', 'Church', 'Ruth is picking you up'],
      ['12:30', 'amber', 'Lunch at Ruth\u2019s', 'Bring the photo album'],
    ],
  ],
];

export const PINS = [
  {
    name: 'Reading glasses',
    where: 'Kitchen counter · seen 9:12 AM',
    label: 'Glasses',
    x: 232,
    y: 36,
    w: 56,
  },
  {
    name: 'Keys',
    where: 'Coat pocket, by the door · 8:40 AM',
    label: 'Keys',
    x: 46,
    y: 78,
    w: 40,
  },
  {
    name: 'TV remote',
    where: 'Sofa, left cushion · 9:30 PM',
    label: 'Remote',
    x: 74,
    y: 46,
    w: 52,
  },
  {
    name: 'Purse',
    where: 'Bedroom, on the chair · 7:15 AM',
    label: 'Purse',
    x: 286,
    y: 132,
    w: 44,
    left: true,
  },
];

export function demoAnswerFor(q: string) {
  q = q.toLowerCase();
  if (/glass/.test(q))
    return 'Your glasses are on the kitchen counter, next to the kettle. You set them down at 9:12.';
  if (/pill|med|metformin|lisinopril/.test(q))
    return 'You took Lisinopril at 8:03 this morning. Metformin is next, at 12:30 with lunch.';
  if (/priya|daughter/.test(q))
    return 'Priya called at 7:48. She left Somerville at 1:35 and should arrive around 2.';
  if (/key/.test(q))
    return 'Your keys are in your coat pocket, by the door. You put them there at 8:40.';
  if (/remote|tv/.test(q))
    return 'The remote is on the sofa, left cushion, from last night.';
  if (/dana|knee|physio/.test(q))
    return 'Dana is coming at 10. Last time she asked you to ice the knee twice a day.';
  if (/eat|lunch|dinner|soup|food/.test(q))
    return 'Priya left soup in the fridge. Two minutes in the microwave.';
  if (/weather|outside|cold|rain/.test(q))
    return 'It\u2019s 58 and clear right now, warming up to 63 this afternoon.';
  if (/stove|door|alert/.test(q))
    return 'The front door opened once last night at 9:41 PM, for about a minute. The stove has been off since 6:52 PM.';
  if (!q)
    return 'I heard you. Nothing important since your call with Priya at 7:48.';
  return 'I\u2019ll remember that. Ask me about it anytime.';
}

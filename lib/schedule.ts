// The published damage schedule, the hire catalogue and the capture angles. Fictional fixtures.
// shortcut: constants, not tables; move to Clause/Item tables when a second item exists.

// oncePerGarment: one charge per hire however many findings cite it (settle merges them).
export type Clause = { id: string; name: string; chargeable: boolean; lowGBP: number; highGBP: number; oncePerGarment?: boolean };

// Wear first: it is never charged. A fixed price is a band whose low and high are equal.
export const CLAUSES: Clause[] = [
  { id: 'W1', name: 'Normal wear: creases, light pilling, lint', chargeable: false, lowGBP: 0, highGBP: 0 },
  { id: 'S1', name: 'Stain needing specialist cleaning', chargeable: true, lowGBP: 18, highGBP: 30, oncePerGarment: true },
  { id: 'B1', name: 'Missing button', chargeable: true, lowGBP: 6, highGBP: 6 },
  { id: 'R1', name: 'Beyond repair: replacement value, capped at the hold', chargeable: true, lowGBP: 140, highGBP: 140 },
];

export type KnownMark = { id: string; description: string; firstSeen: string };

export const ITEMS: Record<
  string,
  { name: string; branch: string; feeGBP: number; depositGBP: number; hireDays: number }
> = {
  'BLZ-NAVY-40R': {
    name: 'Brown wool blazer, 40R',
    branch: 'Halifax',
    feeGBP: 28,
    depositGBP: 60,
    hireDays: 3,
  },
};

// label goes to the inspector's prompt; short and hint are what the capture screen shows.
export const ANGLES = [
  { id: 'front', label: 'Front, buttoned, on the hanger', short: 'Front', hint: 'Buttoned, on the hanger, the whole jacket in frame' },
  { id: 'back', label: 'Back', short: 'Back', hint: 'Turn the hanger round, the whole jacket in frame' },
  { id: 'left-sleeve', label: 'Left sleeve, including the cuff', short: 'Left sleeve', hint: 'The whole sleeve, including the cuff' },
  { id: 'right-sleeve', label: 'Right sleeve, including the cuff', short: 'Right sleeve', hint: 'The whole sleeve, including the cuff' },
  { id: 'collar-cuffs', label: 'Close-up of the collar and lapels', short: 'Collar and lapels', hint: 'Close up, both lapels in frame' },
  { id: 'care-label', label: 'Care label and barcode tag', short: 'Care label', hint: 'Inside the jacket, the label and barcode tag sharp' },
] as const;

export const STAGES = ['pickup', 'return'] as const;

export const AI_NOTICE =
  'An AI inspector compares your pick-up and return photos and proposes any charge from this schedule. ' +
  'A member of staff approves every charge, you see the same photos, and you can contest once.';

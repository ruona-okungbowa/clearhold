// The hire catalogue: the looks (first is featured on the home page), the shops, and the renter wording of the price list. Fictional.
// shortcut: constants, not tables; move to Look/Shop tables when the catalogue is edited by staff.

import { ITEMS } from './schedule';

export type Look = {
  slug: string;
  name: string;
  occasion: string;
  img: string;
  blurb: string;
  sizes: string[];
  pieces: [string, number][];
  deposit: number;
};

const DRESS = ['6', '8', '10', '12', '14', '16'];
const SUIT = ['36R', '38R', '40R', '42R', '44R'];

export const LOOKS: Look[] = [
  {
    slug: 'blazer', img: 'blazer-look', name: 'The wedding blazer', occasion: 'Wedding guest',
    blurb: 'A long brown wool blazer with notched lapels and five buttons. Sharp over a dress or with tailored trousers, and warm enough for the walk to the reception.',
    sizes: SUIT, pieces: [['Brown wool blazer', 28]], deposit: 60,
  },
  {
    slug: 'blush', img: 'blush', name: 'Blush maxi', occasion: 'Wedding guest',
    blurb: 'Bias-cut satin that skims rather than clings, with a sage clutch to finish. Made for a summer ceremony and dancing after.',
    sizes: DRESS, pieces: [['Blush satin maxi dress', 34], ['Sage clutch', 8]], deposit: 50,
  },
  {
    slug: 'bestman', img: 'bestman', name: 'The best man', occasion: 'Wedding party',
    blurb: 'A brown wool three-piece with a sage silk tie and leather brogues. Smart enough for the top table, warm enough for an autumn wedding.',
    sizes: [...SUIT, '40L'], pieces: [['Brown wool three-piece suit', 45], ['Sage silk tie', 6], ['Leather brogues', 12]], deposit: 60,
  },
  {
    slug: 'tux', img: 'tux', name: 'Classic tux', occasion: 'Black tie',
    blurb: 'A single-button dinner suit with satin peak lapels, a pleated dress shirt and a self-tie silk bow.',
    sizes: [...SUIT, '46R'], pieces: [['Black dinner suit', 49], ['Dress shirt', 10], ['Silk bow tie', 6]], deposit: 60,
  },
  {
    slug: 'sage', img: 'sage', name: 'Sage midi', occasion: 'Garden party',
    blurb: 'A soft cotton tea dress with a gathered waist and a straw tote. Easy on a lawn, easy in the heat.',
    sizes: [...DRESS, '18'], pieces: [['Sage tea dress', 29], ['Straw tote', 7]], deposit: 40,
  },
  {
    slug: 'linen', img: 'linen', name: 'Linen day suit', occasion: 'Race day',
    blurb: 'An unlined linen two-piece with a sage knit tie. It creases, and that’s the point: creases are never charged.',
    sizes: SUIT, pieces: [['Linen two-piece suit', 39], ['Sage knit tie', 6]], deposit: 50,
  },
  {
    slug: 'cocoa', img: 'cocoa', name: 'Cocoa slip', occasion: 'Evening do',
    blurb: 'A cocoa satin slip dress cut on the bias, with a fine gold necklace. Dinner, drinks, the lot.',
    sizes: DRESS, pieces: [['Cocoa satin slip dress', 32], ['Fine gold necklace', 5]], deposit: 50,
  },
];

export const feeOf = (look: Look) => look.pieces.reduce((sum, [, price]) => sum + price, 0);
export const lookBySlug = (slug: string) => LOOKS.find((l) => l.slug === slug);

// Each shop's code is the middle of its hire refs, e.g. LH-HAL-0142.
export const SHOP_CODES: Record<string, string> = {
  Halifax: 'HAL',
  Leeds: 'LDS',
  Bradford: 'BRD',
  Huddersfield: 'HUD',
  Wakefield: 'WKF',
  Dewsbury: 'DEW',
};
export const SHOPS = Object.keys(SHOP_CODES);

// Renter wording of CLAUSES in lib/schedule.ts.
export const PRICE_LIST = [
  { id: 'W1', what: 'Creases, light pilling, lint and everyday wear', price: 'Never charged' },
  { id: 'S1', what: 'A stain that needs a specialist clean', price: '£18 to £30' },
  { id: 'B1', what: 'A missing button', price: '£6' },
  { id: 'R1', what: 'Damaged beyond repair', price: 'Up to the deposit' },
];

export const HIRE_DAYS = 3;

// A look in one size is one bookable item: "LOOK-bestman-40R".
export const lookItemRef = (look: Look, size: string) => `LOOK-${look.slug}-${size}`;

export type Item = { name: string; feeGBP: number; depositGBP: number; hireDays: number; look?: Look; size?: string };

// Any item a hire can name: a look in a size, or one of the original single items in lib/schedule.ts.
export function itemOf(itemRef: string): Item | null {
  const m = /^LOOK-([a-z]+)-([0-9A-Z]+)$/.exec(itemRef);
  const look = m && LOOKS.find((l) => l.slug === m[1]);
  if (look && look.sizes.includes(m[2])) {
    return { name: `${look.name}, ${m[2]}`, feeGBP: feeOf(look), depositGBP: look.deposit, hireDays: HIRE_DAYS, look, size: m[2] };
  }
  const old = ITEMS[itemRef];
  return old ? { name: old.name, feeGBP: old.feeGBP, depositGBP: old.depositGBP, hireDays: old.hireDays } : null;
}

export const itemName = (itemRef: string) => itemOf(itemRef)?.name ?? itemRef;

// The judges' sample photos in public/judge/blazer show this look, so only its hires may use them.
export const takesSamplePhotos = (itemRef: string) => itemOf(itemRef)?.look?.slug === 'blazer';

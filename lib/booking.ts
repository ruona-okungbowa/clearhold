// Booking dates: which collection days a look in one size can take, shared by the look page and its actions.
// Days are ISO "YYYY-MM-DD" strings in London time; a hire runs HIRE_DAYS nights, collect 10am, back by 5pm.
// shortcut: collection and return times are stored as UTC, which is London time in winter and an hour out in summer;
// use a time-zone library before bookings run through BST.

import { HIRE_DAYS } from './catalogue';

const DAY = 86_400_000;
// A PayPal authorization lasts 29 days, so the hire has to be back before the hold runs out.
const HOLD_DAYS = 29;

export type Booked = { itemRef: string; start: string; end: string };

export const londonToday = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const collectAt = (start: string) => new Date(`${start}T10:00:00Z`);
export const returnBy = (start: string) => new Date(`${addDays(start, HIRE_DAYS)}T17:00:00Z`);
export const isoOf = (d: Date) => d.toISOString().slice(0, 10);

// After today, and back before a hold placed today expires.
export const startAllowed = (start: string, today: string) => start > today && addDays(start, HIRE_DAYS) <= addDays(today, HOLD_DAYS);

// Inclusive by day: handing back on the 16th and collecting on the 16th clash, because the garment needs cleaning.
export const clashes = (start: string, booked: Booked[]) => {
  const end = addDays(start, HIRE_DAYS);
  return booked.some((b) => start <= b.end && b.start <= end);
};

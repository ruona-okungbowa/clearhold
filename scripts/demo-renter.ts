// A made-up renter name for a seeded hire. Hashed from the ref, not drawn from seed-history's PRNG, so adding names
// doesn't change any seeded outcome.

const FIRST = ['Amara', 'Ben', 'Chloe', 'Daniel', 'Eilidh', 'Farah', 'George', 'Hannah', 'Imran', 'Jess', 'Kofi', 'Lucy'];
const LAST = ['Ashworth', 'Bello', 'Clarke', 'Dhillon', 'Evans', 'Fraser', 'Gill', 'Hughes', 'Iqbal', 'Jones', 'Khan', 'Lowe'];

export function demoRenter(hireRef: string) {
  let hash = 0;
  for (const c of hireRef) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return `${FIRST[hash % FIRST.length]} ${LAST[(hash >>> 8) % LAST.length]}`;
}

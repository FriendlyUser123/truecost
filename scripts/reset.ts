/**
 * `npm run reset` — put the demo back to its opening frame.
 *
 * Wipes the local transfer/bill overlay, the bridge grants and the verified
 * starts, so the board and the balances read the way they did when we
 * rehearsed. Run it after every rehearsal and between judges.
 *
 * It does the same for the median household's account and its saved payday
 * plans, so `/average-american` opens on its seeded balance again.
 *
 * With a live Nessie key it also re-seeds Maria's sandbox account. It does NOT
 * re-seed the household: seeding creates a brand-new customer with new ids, and
 * doing that silently on every reset would leave orphan customers in the
 * sandbox. Run `npm run seed:nessie:household` yourself when you want one.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { SUBJECTS } from '../lib/nessie/subjects';

// The replay caches are NOT here: they are recordings, not runtime state.
const names = [
  SUBJECTS.maria.files.runtime,
  'runtime-grants.json',
  'runtime-starts.json',
  'readyday-counter.json',
  SUBJECTS.household.files.runtime,
  SUBJECTS.household.files.activation,
];
const files = names.map((f) => path.join(process.cwd(), 'data', 'cache', f));

for (const f of files) {
  await rm(f, { force: true });
  console.log(`cleared ${path.relative(process.cwd(), f)}`);
}

if (process.env.NESSIE_API_KEY?.trim()) {
  const { seedNessie } = await import('./seed-nessie.js');
  await seedNessie('maria');
} else {
  console.log('No NESSIE_API_KEY — demo ledgers are rebuilt from lib/fixtures on the next request.');
}
console.log('Reset. The board is back to its opening frame; the household reads $3,900.00 again.');

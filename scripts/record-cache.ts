/**
 * `npx tsx scripts/record-cache.ts` — write the fixture ledgers into the
 * replay caches so RECORDED=1 exercises the real replay path rather than
 * falling through to the fixture builder. Both customers: Maria's
 * `nessie-recorded.json` and the household's `nessie-recorded-household.json`.
 *
 * It NEVER overwrites a cache that already exists, unless you pass --force.
 * A cache file is often a real recording: every live read is written through to
 * it, and `npm run seed:nessie` writes real sandbox ids into it. Replacing that
 * with a fixture would quietly turn the evidence that the live path worked into
 * a synthetic ledger, and RECORDED=1 would then replay fiction while claiming to
 * replay the sandbox. (This script once did exactly that.)
 *
 * `npm run seed:nessie` builds these from live API responses. This script
 * exists so a fresh clone can still ship working replay caches even though no
 * key was ever used to build them.
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SUBJECTS } from '../lib/nessie/subjects';

const force = process.argv.includes('--force');
const dir = path.join(process.cwd(), 'data', 'cache');
await mkdir(dir, { recursive: true });

for (const cfg of Object.values(SUBJECTS)) {
  const file = path.join(dir, cfg.files.recorded);
  const rel = path.relative(process.cwd(), file);
  const exists = await access(file).then(
    () => true,
    () => false,
  );
  if (exists && !force) {
    console.log(`kept    ${rel} (already exists; pass --force to replace it with the fixture)`);
    continue;
  }
  await writeFile(file, `${JSON.stringify(cfg.build(), null, 2)}\n`, 'utf8');
  console.log(`wrote   ${rel}${exists ? ' (--force)' : ''}`);
}

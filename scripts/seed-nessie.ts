/**
 * `npm run seed:nessie` — push Maria's ledger into a real Capital One Nessie
 * sandbox, then write the whole thing to data/cache/nessie-recorded.json so
 * RECORDED=1 can replay it. For Maria it also creates the bridge funder (a
 * second customer, an independent foundation) and the pharmacy merchants the
 * ATM query and the fill verification need.
 *
 * `npm run seed:nessie:household` seeds the median household instead, as its OWN
 * independent customer: its own ids, its own replay cache, its own environment
 * variables. Seed both to run both pages live. The household has no funder and
 * no pharmacies: it is a bank account, not a Ready patient.
 *
 * Requires NESSIE_API_KEY. Without one you do not need this script at all:
 * the app builds the identical ledgers from lib/fixtures on every request.
 *
 * After it runs, put the ids it prints into .env.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SUBJECTS, parseSubject, type Subject } from '../lib/nessie/subjects';
import type { LedgerSnapshot } from '../lib/nessie/types';

// HTTPS only. api.nessieisreal.com refuses plain http connections outright.
const BASE = process.env.NESSIE_BASE_URL ?? 'https://api.nessieisreal.com';

function requireKey(): string {
  const key = process.env.NESSIE_API_KEY?.trim();
  if (!key) throw new Error('NESSIE_API_KEY is not set. Get one at nessieisreal.com.');
  return key;
}

async function call<T>(route: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const key = requireKey();
  const sep = route.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${route}${sep}key=${encodeURIComponent(key)}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

interface Created {
  objectCreated: { _id: string };
}

/**
 * The bridge funder.
 *
 * An independent charitable foundation, deliberately not a manufacturer fund:
 * routing manufacturer money to a federally-insured patient's copay is an
 * Anti-Kickback Statute problem, and the eligibility gate that enforces that
 * lives in code (see BridgeFunder in lib/ready/types.ts). The seed has to
 * agree with the type, so the second customer in the sandbox is a foundation.
 *
 * $4,000 is enough to fund every bridge in a demo run and small enough to be
 * obviously a sandbox.
 */
const FUND_CUSTOMER = {
  first_name: 'Blue Ridge',
  last_name: 'Access Foundation',
  address: {
    street_number: '210',
    street_name: 'Reserve Ave SW',
    city: 'Roanoke',
    state: 'VA',
    zip: '24016',
  },
} as const;

const FUND_OPENING_BALANCE = 4000;

/**
 * Pharmacies the patient could actually walk into, with real coordinates.
 *
 * These exist so `GET /atms?lat=&lng=&rad=` has somewhere real to be centred.
 * A radius query around a made-up geocode returns an empty list and the ATM
 * row on the Ready Card silently disappears — which is exactly the failure
 * that would go unnoticed until 9 AM.
 */
const PHARMACIES: readonly {
  name: string;
  street_number: string;
  street_name: string;
  zip: string;
  lat: number;
  lng: number;
}[] = [
  {
    name: 'Kroger Pharmacy — Electric Road',
    street_number: '1802',
    street_name: 'Electric Rd',
    zip: '24018',
    lat: 37.2337,
    lng: -80.0086,
  },
  {
    name: 'CVS Pharmacy — Williamson Road',
    street_number: '3202',
    street_name: 'Williamson Rd NW',
    zip: '24012',
    lat: 37.3033,
    lng: -79.9528,
  },
  {
    name: 'Walgreens — Brambleton Avenue',
    street_number: '4347',
    street_name: 'Brambleton Ave',
    zip: '24018',
    lat: 37.2225,
    lng: -80.0044,
  },
];

export async function seedNessie(subject: Subject = 'maria'): Promise<void> {
  const cfg = SUBJECTS[subject];
  const fixture = cfg.build();
  const { customer: who } = cfg;
  const isPatient = subject === 'maria';

  console.log(`Seeding ${cfg.label}…`);
  console.log('Creating customer…');
  const customer = await call<Created>('/customers', 'POST', {
    first_name: who.first,
    last_name: who.last,
    address: {
      street_number: who.street.number,
      street_name: who.street.name,
      city: who.city,
      state: who.state,
      zip: who.zip,
    },
  });
  const customerId = customer.objectCreated._id;

  console.log('Creating accounts…');
  const checking = await call<Created>(`/customers/${customerId}/accounts`, 'POST', {
    type: 'Checking',
    nickname: fixture.checking.nickname,
    rewards: 0,
    balance: cfg.openingChecking / 100,
  });
  const savings = await call<Created>(`/customers/${customerId}/accounts`, 'POST', {
    type: 'Savings',
    nickname: fixture.savings.nickname,
    rewards: 0,
    balance: 0,
  });
  const checkingId = checking.objectCreated._id;
  const savingsId = savings.objectCreated._id;

  // Customer #2 (Maria's side only). The bridge is a real P2P transfer between
  // two real Nessie customers, which means the funder has to be one of them.
  let fundCustomerId = '';
  let fundCheckingId = '';
  if (isPatient) {
    console.log('Creating the bridge funder…');
    const fund = await call<Created>('/customers', 'POST', FUND_CUSTOMER);
    fundCustomerId = fund.objectCreated._id;
    const fundChecking = await call<Created>(`/customers/${fundCustomerId}/accounts`, 'POST', {
      type: 'Checking',
      nickname: 'Access Grants',
      rewards: 0,
      balance: FUND_OPENING_BALANCE,
    });
    fundCheckingId = fundChecking.objectCreated._id;
  }

  // Nessie merchants are global, so reuse any that already exist by name.
  console.log('Creating merchants…');
  const existing = await call<{ _id: string; name: string }[]>('/merchants', 'GET');
  const byName = new Map(existing.map((m) => [m.name, m._id]));
  const merchantIds = new Map<string, string>();
  for (const m of cfg.merchants) {
    const found = byName.get(m.name);
    if (found) {
      merchantIds.set(m._id, found);
      continue;
    }
    const created = await call<Created>('/merchants', 'POST', {
      name: m.name,
      category: Array.isArray(m.category) ? m.category[0] : m.category,
      address: {
        street_number: '1',
        street_name: 'Market St SE',
        city: who.city,
        state: who.state,
        zip: who.zip,
      },
      geocode: { lat: 37.27, lng: -79.94 },
    });
    merchantIds.set(m._id, created.objectCreated._id);
  }

  // Pharmacies are created separately from the fixture merchants: they carry
  // real coordinates, they are the geocode the ATM radius query is centred on,
  // and recordFill() needs one of their ids as the purchase counterparty.
  const pharmacyIds = new Map<string, string>();
  if (isPatient) {
    console.log('Creating pharmacy merchants…');
    for (const p of PHARMACIES) {
      const found = byName.get(p.name);
      if (found) {
        pharmacyIds.set(p.name, found);
        continue;
      }
      const created = await call<Created>('/merchants', 'POST', {
        name: p.name,
        category: 'pharmacy',
        address: {
          street_number: p.street_number,
          street_name: p.street_name,
          city: 'Roanoke',
          state: 'VA',
          zip: p.zip,
        },
        geocode: { lat: p.lat, lng: p.lng },
      });
      pharmacyIds.set(p.name, created.objectCreated._id);
    }
  }

  console.log(`Posting ${fixture.deposits.length} deposits…`);
  for (const d of fixture.deposits) {
    await call(`/accounts/${checkingId}/deposits`, 'POST', {
      medium: 'balance',
      transaction_date: d.transaction_date,
      status: 'completed',
      amount: d.amount,
      description: d.description,
    });
  }

  console.log(`Posting ${fixture.withdrawals.length} withdrawals…`);
  for (const w of fixture.withdrawals) {
    await call(`/accounts/${checkingId}/withdrawals`, 'POST', {
      medium: 'balance',
      transaction_date: w.transaction_date,
      status: 'completed',
      amount: w.amount,
      description: w.description,
    });
  }

  console.log(`Posting ${fixture.purchases.length} purchases…`);
  for (const p of fixture.purchases) {
    const merchantId = merchantIds.get(p.merchant_id);
    if (!merchantId) throw new Error(`no live merchant id for ${p.merchant_id}`);
    await call(`/accounts/${checkingId}/purchases`, 'POST', {
      merchant_id: merchantId,
      medium: 'balance',
      purchase_date: p.purchase_date,
      amount: p.amount,
      status: 'completed',
      description: p.description,
    });
  }

  console.log(`Posting ${fixture.transfers.length} savings transfers…`);
  for (const t of fixture.transfers) {
    await call(`/accounts/${checkingId}/transfers`, 'POST', {
      transaction_date: t.transaction_date,
      status: 'completed',
      amount: t.amount,
      description: t.description,
    });
  }

  // Nessie derives balance from posted transactions and truncates to whole
  // dollars, so its arithmetic drifts from ours by a few dollars per run. Rather
  // than pretend, measure the drift and close it with one dated opening-balance
  // deposit — after this the live account reads exactly what the fixture says.
  console.log('Calibrating opening balance…');
  const pre = await call<{ balance: number; type: string }[]>(`/customers/${customerId}/accounts`, 'GET');
  const liveChecking = pre.find((a) => a.type === 'Checking');
  const drift = Math.round(cfg.closingChecking / 100 - (liveChecking?.balance ?? 0));
  if (drift !== 0) {
    await call(`/accounts/${checkingId}/${drift > 0 ? 'deposits' : 'withdrawals'}`, 'POST', {
      medium: 'balance',
      transaction_date: '2026-06-30',
      status: 'completed',
      amount: Math.abs(drift),
      description: 'OPENING BALANCE',
    });
    console.log(`  corrected by ${drift > 0 ? '+' : ''}${drift}`);
  }

  console.log('Reading the account back…');
  const accounts = await call<LedgerSnapshot['checking'][]>(`/customers/${customerId}/accounts`, 'GET');
  for (const a of accounts) {
    console.log(`  ${a.type.padEnd(8)} ${a._id}  $${a.balance.toFixed(2)}`);
  }

  const cacheDir = path.join(process.cwd(), 'data', 'cache');
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    path.join(cacheDir, cfg.files.recorded),
    `${JSON.stringify({ ...fixture, customerId }, null, 2)}\n`,
    'utf8',
  );

  console.log('\nAdd these to .env:');
  console.log(`${cfg.env.customer}=${customerId}`);
  console.log(`${cfg.env.checking}=${checkingId}`);
  console.log(`${cfg.env.payee}=${savingsId}`);
  if (isPatient) {
    console.log(`NESSIE_FUND_CUSTOMER_ID=${fundCustomerId}`);
    console.log(`NESSIE_FUND_CHECKING_ID=${fundCheckingId}`);
    // One active pharmacy var, the rest commented out: the block has to paste
    // into .env without the last line silently winning the duplicate key.
    let firstPharmacy = true;
    for (const [name, id] of pharmacyIds) {
      console.log(`${firstPharmacy ? '' : '# '}NESSIE_PHARMACY_MERCHANT_ID=${id}  # ${name}`);
      firstPharmacy = false;
    }
    console.log('\nATM radius queries should be centred on a pharmacy geocode, e.g.');
    const [first] = PHARMACIES;
    if (first) console.log(`  getAtmsNear(${first.lat}, ${first.lng}, 5, copay)`);
  }
}

if (process.argv[1]?.includes('seed-nessie')) {
  await seedNessie(parseSubject(process.argv[2]));
}

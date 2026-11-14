import { CHECKING_ID, CLOSING_CHECKING, MERCHANTS, OPENING_CHECKING, buildLedger } from '../fixtures/ledger';
import {
  HOUSEHOLD_CHECKING_ID,
  HOUSEHOLD_CLOSING_CHECKING,
  HOUSEHOLD_MERCHANTS,
  HOUSEHOLD_OPENING_CHECKING,
  buildHouseholdLedger,
} from '../fixtures/household-ledger';
import { MARIA } from '../fixtures/patient';
import type { Cents } from '../types';
import type { LedgerSnapshot, NessieMerchant } from './types';

/**
 * Whose bank account is being read or written.
 *
 * The Ready board banks one patient customer, Maria (plus the foundation that
 * funds the bridge, which is not a subject: it is only ever paid from). The household segment
 * needs a second, so everything that used to be a constant about Maria is now a
 * field here: which environment variables hold her Nessie ids, which files hold
 * her replay cache and her runtime overlay, and how her ledger is built when
 * there is no sandbox to read it from.
 *
 * `maria` is the original behaviour, unchanged, and remains the default
 * everywhere a subject is optional.
 */
export type Subject = 'maria' | 'household';

export interface SubjectConfig {
  id: Subject;
  label: string;
  /** Builds the ledger with no sandbox to read. */
  build: () => LedgerSnapshot;
  merchants: NessieMerchant[];
  openingChecking: Cents;
  closingChecking: Cents;
  customer: {
    first: string;
    last: string;
    street: { number: string; name: string };
    city: string;
    state: string;
    zip: string;
  };
  /** Names of the environment variables that hold this customer's Nessie ids. */
  env: { customer: string; checking: string; payee: string };
  /** File names under data/cache/. */
  files: { recorded: string; runtime: string; activation: string };
  /** Account ids used when the ledger is a local simulation. */
  demoCheckingId: string;
  demoPayeeId: string;
}

export const SUBJECTS: Record<Subject, SubjectConfig> = {
  maria: {
    id: 'maria',
    label: 'Maria Delgado',
    build: buildLedger,
    merchants: MERCHANTS,
    openingChecking: OPENING_CHECKING,
    closingChecking: CLOSING_CHECKING,
    customer: {
      first: MARIA.firstName,
      last: MARIA.lastName,
      street: { number: '1412', name: 'Patterson Ave SW' },
      city: MARIA.city,
      state: MARIA.state,
      zip: MARIA.zip,
    },
    env: { customer: 'NESSIE_CUSTOMER_ID', checking: 'NESSIE_CHECKING_ID', payee: 'NESSIE_PAYEE_ID' },
    files: {
      recorded: 'nessie-recorded.json',
      runtime: 'runtime-state.json',
      activation: 'runtime-activation.json',
    },
    demoCheckingId: CHECKING_ID,
    demoPayeeId: 'novocare-pharmacy-escrow',
  },
  household: {
    id: 'household',
    label: 'The median household',
    build: buildHouseholdLedger,
    merchants: HOUSEHOLD_MERCHANTS,
    openingChecking: HOUSEHOLD_OPENING_CHECKING,
    closingChecking: HOUSEHOLD_CLOSING_CHECKING,
    customer: {
      first: 'Median',
      last: 'Household',
      street: { number: '3120', name: 'Hull St' },
      city: 'Richmond',
      state: 'VA',
      zip: '23224',
    },
    env: {
      customer: 'NESSIE_HOUSEHOLD_CUSTOMER_ID',
      checking: 'NESSIE_HOUSEHOLD_CHECKING_ID',
      payee: 'NESSIE_HOUSEHOLD_PAYEE_ID',
    },
    files: {
      recorded: 'nessie-recorded-household.json',
      runtime: 'runtime-state-household.json',
      activation: 'runtime-activation-household.json',
    },
    demoCheckingId: HOUSEHOLD_CHECKING_ID,
    demoPayeeId: 'household-rx-fund',
  },
};

export function parseSubject(raw: string | null | undefined): Subject {
  return raw === 'household' ? 'household' : 'maria';
}

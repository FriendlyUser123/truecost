import { dollars } from '../money';
import type { Patient } from '../types';

/** 2026 HHS federal poverty guideline, 48 contiguous states, household of 2. */
export const FPL_HOUSEHOLD_2 = dollars(21_150);

export const MARIA: Patient = {
  id: 'maria-delgado',
  firstName: 'Maria',
  lastName: 'Delgado',
  age: 54,
  city: 'Roanoke',
  state: 'VA',
  zip: '24016',
  householdSize: 2,
  annualHouseholdIncome: dollars(41_600),
  // 41,600 / 21,150 = 1.967
  incomeFplMultiple: 1.97,
  insuranceType: 'commercial',
  planId: 'anthem-hsa-3400',
  diagnosis: 'Type 2 diabetes mellitus without complications (E11.9)',
  a1c: 8.4,
  preferredLanguage: 'en',
  nessieCustomerId: 'demo-maria-delgado',
};

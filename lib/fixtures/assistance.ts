import { dollars } from '../money';
import type { AssistanceProgram } from '../types';

/**
 * Eight programs. Two are eligible for Maria and six are not, each for a
 * different structural reason. The point of the panel is the six: a rules
 * engine that only ever returns winners is indistinguishable from a hardcoded
 * string, and a judge will ask.
 */
export const ASSISTANCE_PROGRAMS: AssistanceProgram[] = [
  {
    id: 'novocare-ozempic-card',
    name: 'NovoCare Ozempic Savings Card',
    sponsor: 'Novo Nordisk',
    kind: 'copay-card',
    patientPaysMonthly: dollars(25),
    annualBenefitCap: dollars(6000),
    annualCapRemaining: dollars(6000),
    durationMonths: 12,
    fundingOpen: true,
    enrollmentUrl: 'https://www.novocare.com/ozempic/savings-card.html',
    criteria: [
      {
        label: 'Commercial or private insurance (not Medicare, Medicaid or TRICARE)',
        predicate: { field: 'insuranceType', op: 'neq', value: 'government' },
      },
      {
        label: 'Prescribed product is covered by this card',
        predicate: { field: 'drugId', op: 'in', value: ['semaglutide'] },
      },
      { label: 'Age 18 or older', predicate: { field: 'age', op: 'gte', value: 18 } },
      {
        label: 'Program is accepting new enrollments',
        predicate: { field: 'fundingOpen', op: 'isTrue', value: true },
      },
      {
        label: 'Remaining annual benefit covers the projected plan-year cost',
        predicate: { field: 'annualCapRemaining', op: 'coversProjected', value: true },
      },
    ],
  },
  {
    id: 'roanoke-bridge-grant',
    name: 'Roanoke Valley Community Health Bridge Grant',
    sponsor: 'Roanoke Valley Community Health Fund',
    kind: 'foundation-grant',
    patientPaysMonthly: null,
    annualBenefitCap: dollars(750),
    annualCapRemaining: dollars(750),
    durationMonths: 12,
    fundingOpen: true,
    enrollmentUrl: 'https://example.org/roanoke-bridge-grant',
    criteria: [
      {
        label: 'Resident of Virginia',
        predicate: { field: 'state', op: 'in', value: ['VA'] },
      },
      {
        label: 'Household income at or below 300% of the federal poverty level',
        predicate: { field: 'incomeFplMultiple', op: 'lte', value: 3.0 },
      },
      {
        label: 'Grant cycle has funds remaining',
        predicate: { field: 'fundingOpen', op: 'isTrue', value: true },
      },
    ],
  },
  {
    id: 'novo-pap',
    name: 'Novo Nordisk Patient Assistance Program',
    sponsor: 'Novo Nordisk',
    kind: 'manufacturer-pap',
    patientPaysMonthly: dollars(0),
    annualBenefitCap: null,
    annualCapRemaining: dollars(0),
    durationMonths: 12,
    fundingOpen: true,
    enrollmentUrl: 'https://www.novocare.com/diabetes/help-with-costs/pap.html',
    criteria: [
      {
        label: 'Uninsured, or Medicare Part D with a documented coverage gap',
        predicate: { field: 'insuranceType', op: 'eq', value: 'uninsured' },
      },
      {
        label: 'Household income at or below 400% of the federal poverty level',
        predicate: { field: 'incomeFplMultiple', op: 'lte', value: 4.0 },
      },
      {
        label: 'Prescribed product is a Novo Nordisk product',
        predicate: { field: 'drugId', op: 'in', value: ['semaglutide', 'insulin-glargine'] },
      },
    ],
  },
  {
    id: 'lilly-cares',
    name: 'Lilly Cares Foundation Patient Assistance Program',
    sponsor: 'Eli Lilly and Company Foundation',
    kind: 'manufacturer-pap',
    patientPaysMonthly: dollars(0),
    annualBenefitCap: null,
    annualCapRemaining: dollars(0),
    durationMonths: 12,
    fundingOpen: true,
    enrollmentUrl: 'https://www.lillycares.com',
    criteria: [
      {
        label: 'Household income at or below 150% of the federal poverty level',
        predicate: { field: 'incomeFplMultiple', op: 'lte', value: 1.5 },
      },
      {
        label: 'Prescribed product is a Lilly product',
        predicate: { field: 'drugId', op: 'in', value: ['tirzepatide', 'dulaglutide'] },
      },
      { label: 'Age 18 or older', predicate: { field: 'age', op: 'gte', value: 18 } },
    ],
  },
  {
    id: 'va-pharm-connection',
    name: 'Virginia Pharmaceutical Assistance Connection',
    sponsor: 'Commonwealth of Virginia — Dept. of Health',
    kind: 'foundation-grant',
    patientPaysMonthly: dollars(15),
    annualBenefitCap: dollars(4000),
    annualCapRemaining: dollars(0),
    durationMonths: 12,
    fundingOpen: false,
    enrollmentUrl: 'https://example.gov/va-pharmaceutical-assistance',
    criteria: [
      { label: 'Resident of Virginia', predicate: { field: 'state', op: 'in', value: ['VA'] } },
      {
        label: 'Household income at or below 250% of the federal poverty level',
        predicate: { field: 'incomeFplMultiple', op: 'lte', value: 2.5 },
      },
      {
        label: 'Grant cycle has funds remaining',
        predicate: { field: 'fundingOpen', op: 'isTrue', value: true },
      },
    ],
  },
  {
    id: 'healthwell-diabetes',
    name: 'HealthWell Foundation — Diabetes Fund',
    sponsor: 'HealthWell Foundation',
    kind: 'foundation-grant',
    patientPaysMonthly: dollars(0),
    annualBenefitCap: dollars(3000),
    annualCapRemaining: dollars(3000),
    durationMonths: 12,
    fundingOpen: false,
    enrollmentUrl: 'https://www.healthwellfoundation.org',
    criteria: [
      {
        label: 'Fund is open to new applicants',
        predicate: { field: 'fundingOpen', op: 'isTrue', value: true },
      },
      {
        label: 'Household income at or below 500% of the federal poverty level',
        predicate: { field: 'incomeFplMultiple', op: 'lte', value: 5.0 },
      },
      {
        label: 'Insurance that covers the prescribed product',
        predicate: { field: 'insuranceType', op: 'neq', value: 'uninsured' },
      },
    ],
  },
  {
    id: 'medicare-extra-help',
    name: 'Medicare Part D Extra Help (Low-Income Subsidy)',
    sponsor: 'Social Security Administration',
    kind: 'government',
    patientPaysMonthly: dollars(11.2),
    annualBenefitCap: null,
    annualCapRemaining: dollars(0),
    durationMonths: 12,
    fundingOpen: true,
    enrollmentUrl: 'https://www.ssa.gov/medicare/part-d-extra-help',
    criteria: [
      {
        label: 'Enrolled in Medicare Part D',
        predicate: { field: 'insuranceType', op: 'eq', value: 'government' },
      },
      {
        label: 'Household income at or below 150% of the federal poverty level',
        predicate: { field: 'incomeFplMultiple', op: 'lte', value: 1.5 },
      },
      { label: 'Age 65 or older, or qualifying disability', predicate: { field: 'age', op: 'gte', value: 65 } },
    ],
  },
  {
    id: 'pan-t2dm',
    name: 'PAN Foundation — Type 2 Diabetes Fund',
    sponsor: 'Patient Access Network Foundation',
    kind: 'foundation-grant',
    patientPaysMonthly: dollars(0),
    annualBenefitCap: dollars(4500),
    annualCapRemaining: dollars(4500),
    durationMonths: 12,
    fundingOpen: false,
    enrollmentUrl: 'https://www.panfoundation.org',
    criteria: [
      {
        label: 'Fund is open to new applicants',
        predicate: { field: 'fundingOpen', op: 'isTrue', value: true },
      },
      {
        label: 'Household income at or below 500% of the federal poverty level',
        predicate: { field: 'incomeFplMultiple', op: 'lte', value: 5.0 },
      },
      {
        label: 'Resident of the United States',
        predicate: {
          field: 'state',
          op: 'in',
          value: ['VA', 'NC', 'TN', 'WV', 'MD', 'DC', 'KY', 'OH', 'PA', 'NY', 'CA', 'TX'],
        },
      },
    ],
  },
];

import { dollars } from '../money';
import type { Drug } from '../types';

const T2DM = 'Type 2 diabetes — glucose-lowering therapy';

/**
 * listPrice   = retail cash price at a Roanoke chain pharmacy (what an
 *               uninsured patient is quoted at the counter).
 * allowedAmount = the rate Anthem has negotiated. Member cost share is computed
 *               off THIS, never off list. Getting that backwards is the single
 *               most common reason a patient-facing estimate is wrong.
 */
export const FORMULARY: Drug[] = [
  {
    id: 'semaglutide',
    name: 'Semaglutide',
    brand: 'Ozempic',
    therapeuticClass: T2DM,
    listPrice: dollars(1178.0),
    allowedAmount: dollars(997.58),
    tier: 3,
    priorAuthRequired: true,
    classAlternatives: [
      'tirzepatide',
      'dulaglutide',
      'empagliflozin',
      'sitagliptin',
      'insulin-glargine',
      'metformin-er',
    ],
  },
  {
    id: 'tirzepatide',
    name: 'Tirzepatide',
    brand: 'Mounjaro',
    therapeuticClass: T2DM,
    listPrice: dollars(1264.0),
    allowedAmount: dollars(1069.08),
    tier: 3,
    priorAuthRequired: true,
    classAlternatives: [],
  },
  {
    id: 'dulaglutide',
    name: 'Dulaglutide',
    brand: 'Trulicity',
    therapeuticClass: T2DM,
    listPrice: dollars(1165.0),
    allowedAmount: dollars(987.19),
    tier: 3,
    priorAuthRequired: true,
    classAlternatives: [],
  },
  {
    id: 'empagliflozin',
    name: 'Empagliflozin',
    brand: 'Jardiance',
    therapeuticClass: T2DM,
    listPrice: dollars(723.0),
    allowedAmount: dollars(611.7),
    tier: 3,
    priorAuthRequired: false,
    classAlternatives: [],
  },
  {
    id: 'sitagliptin',
    name: 'Sitagliptin',
    brand: 'Januvia',
    therapeuticClass: T2DM,
    listPrice: dollars(690.0),
    allowedAmount: dollars(584.4),
    tier: 3,
    priorAuthRequired: false,
    classAlternatives: [],
  },
  {
    id: 'insulin-glargine',
    name: 'Insulin glargine',
    brand: 'Lantus',
    therapeuticClass: T2DM,
    listPrice: dollars(401.0),
    allowedAmount: dollars(340.15),
    tier: 2,
    priorAuthRequired: false,
    classAlternatives: [],
  },
  {
    id: 'metformin-er',
    name: 'Metformin ER',
    brand: null,
    therapeuticClass: T2DM,
    listPrice: dollars(12.4),
    allowedAmount: dollars(8.4),
    tier: 1,
    priorAuthRequired: false,
    classAlternatives: [],
  },
  // Five drugs from other classes. They exist so the comparison panel is a
  // filtered query against a real formulary, not a hand-picked list of three.
  {
    id: 'atorvastatin',
    name: 'Atorvastatin',
    brand: null,
    therapeuticClass: 'Hyperlipidemia — statin',
    listPrice: dollars(16.5),
    allowedAmount: dollars(9.2),
    tier: 1,
    priorAuthRequired: false,
    classAlternatives: [],
  },
  {
    id: 'lisinopril',
    name: 'Lisinopril',
    brand: null,
    therapeuticClass: 'Hypertension — ACE inhibitor',
    listPrice: dollars(11.2),
    allowedAmount: dollars(6.4),
    tier: 1,
    priorAuthRequired: false,
    classAlternatives: [],
  },
  {
    id: 'escitalopram',
    name: 'Escitalopram',
    brand: null,
    therapeuticClass: 'Depression — SSRI',
    listPrice: dollars(21.4),
    allowedAmount: dollars(11.8),
    tier: 1,
    priorAuthRequired: false,
    classAlternatives: [],
  },
  {
    id: 'levothyroxine',
    name: 'Levothyroxine',
    brand: null,
    therapeuticClass: 'Hypothyroidism',
    listPrice: dollars(18.9),
    allowedAmount: dollars(10.6),
    tier: 1,
    priorAuthRequired: false,
    classAlternatives: [],
  },
  {
    id: 'albuterol-hfa',
    name: 'Albuterol HFA',
    brand: 'ProAir',
    therapeuticClass: 'Asthma — short-acting beta agonist',
    listPrice: dollars(89.0),
    allowedAmount: dollars(64.5),
    tier: 2,
    priorAuthRequired: false,
    classAlternatives: [],
  },
];

export function drugById(id: string): Drug | undefined {
  return FORMULARY.find((d) => d.id === id);
}

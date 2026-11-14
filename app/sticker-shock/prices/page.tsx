import type { Metadata } from 'next';
import PriceShock from './PriceShock';

/**
 * Its own title, its own description, its own card. This page gets shared on
 * its own and must not arrive looking like a fragment of something else.
 */
export const metadata: Metadata = {
  title: 'Price Shock — guess what American healthcare costs',
  description:
    'Three questions, eleven seconds, no account. A different three every time: guess the price of an inhaler, an EpiPen, an ambulance ride or a night in the hospital, and find out how wrong you are.',
  openGraph: {
    title: 'Price Shock — guess what American healthcare costs',
    description: 'Three questions. No account. Find out how wrong you are.',
    type: 'website',
  },
};

export default function Page() {
  return <PriceShock />;
}

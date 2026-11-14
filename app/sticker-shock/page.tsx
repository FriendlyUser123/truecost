import type { Metadata } from 'next';
import ReadyDayTest from './StickerShock';

/**
 * Its own title, its own description, its own card. This page gets shared on
 * its own and must never arrive looking like a fragment of the clinician app.
 *
 * The route keeps the /sticker-shock path it was built under — links to it
 * already exist, and a dead URL is a worse cost than a stale slug.
 */
export const metadata: Metadata = {
  title: 'The Ready Day Test — when can you actually fill it?',
  description:
    'Three questions, no login. Your payday rhythm, your checking balance, one prescription — and the exact calendar date you can fill it. Or the honest answer that no such date exists.',
  openGraph: {
    title: 'The Ready Day Test',
    description:
      '1 in 4 prescriptions in America are never picked up, and the prescriber is told "patient declined." Three questions. One date.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Ready Day Test',
    description: 'Three questions. One date. What is your Ready Day?',
  },
};

export default function Page() {
  return <ReadyDayTest />;
}

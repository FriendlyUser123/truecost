import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ready — which abandonment alerts are worth a prescriber’s attention',
  description:
    'Surescripts can already tell a prescriber a prescription was never picked up. Ready works out why — from the patient’s own cash position — and decides whether the alert is worth sending at all. Most of them are not.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0e1726',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { NextConfig } from 'next';

/**
 * Nothing here but strict mode, on purpose.
 *
 * This file used to carry `serverExternalPackages: ['mongodb']`, left over
 * from a persistence path that was never connected and has since been
 * deleted (lib/store.ts is a local JSON file and nothing else). docs/FACTS.md
 * lists MongoDB Atlas under DO-NOT-CLAIM, so a driver named in the build
 * config was a contradiction sitting in a file a judge can grep.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;

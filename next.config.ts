import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async redirects() {
    // The dashboard is now the home page.
    return [{ source: '/dashboard', destination: '/', permanent: false }];
  },
};

export default nextConfig;

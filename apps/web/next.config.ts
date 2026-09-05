import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pacotes do workspace são consumidos direto do fonte (TypeScript).
  transpilePackages: ['@cobot/shared'],
};

export default nextConfig;

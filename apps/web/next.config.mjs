/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Phaser uses canvas; keep it client-side only.
    return config;
  }
};
export default nextConfig;

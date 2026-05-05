/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are TypeScript source — let Next.js transpile them
  // rather than requiring each package to ship a build step.
  transpilePackages: ["@platform/db", "@platform/observability", "@platform/schemas"],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are TypeScript source — let Next.js transpile them
  // rather than requiring each package to ship a build step.
  transpilePackages: [
    "@platform/db",
    "@platform/email-templates",
    "@platform/observability",
    "@platform/schemas",
  ],
  // Next.js 15 promoted typedRoutes out of experimental.
  typedRoutes: true,
};

export default nextConfig;

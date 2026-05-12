/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are TypeScript source — let Next.js transpile them
  // rather than requiring each package to ship a build step.
  transpilePackages: [
    "@platform/db",
    "@platform/distribution",
    "@platform/email-templates",
    "@platform/observability",
    "@platform/schemas",
  ],
  // Next.js 15 promoted typedRoutes out of experimental.
  typedRoutes: true,
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;

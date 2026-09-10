/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native module and must stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3"],
  // The dashboard is an internal operator tool; disable the "powered by" header.
  poweredByHeader: false,
};

export default nextConfig;

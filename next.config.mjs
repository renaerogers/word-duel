/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fully static site: Vercel serves plain files from its CDN, so there are
  // no server functions to run (and pay for). All live data comes from Convex.
  output: "export",
  images: { unoptimized: true },
  allowedDevOrigins: ["192.168.1.87"],
};

export default nextConfig;

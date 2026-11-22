/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  reactStrictMode: true,
  transpilePackages: ["@just-see/schema", "@just-see/engine", "@just-see/ui"],
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;

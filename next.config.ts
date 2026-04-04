import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/expense-tracker",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;

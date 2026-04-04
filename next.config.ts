import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/expense-tracker",
  images: { unoptimized: true },
};

export default nextConfig;

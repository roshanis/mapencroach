import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "gibs.earthdata.nasa.gov",
        pathname: "/wms/**",
      },
    ],
  },
};

export default nextConfig;

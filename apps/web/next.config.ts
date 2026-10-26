import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep visited and prefetched pages in the client router cache so going back
    // and forth is instant; mutations call router.refresh()/revalidatePath.
    staleTimes: { dynamic: 30, static: 300 },
  },
};

export default nextConfig;

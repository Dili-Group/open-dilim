import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// Cho phép `next dev` truy cập binding Cloudflare (getCloudflareContext) qua Miniflare.
void initOpenNextCloudflareForDev();

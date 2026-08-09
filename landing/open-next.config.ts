import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Caching config sống ở đây. Xem https://opennext.js.org/cloudflare/caching
// khi cần bật incremental cache (R2/KV) hoặc tag cache (D1).
export default defineCloudflareConfig();

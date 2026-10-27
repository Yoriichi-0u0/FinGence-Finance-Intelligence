import { defineConfig } from "vitest/config";
export default defineConfig({
  envDir: false,
  test: { environment: "node", include: ["tests/**/*.test.ts"], fileParallelism: false, hookTimeout: 300000, testTimeout: 30000 },
});

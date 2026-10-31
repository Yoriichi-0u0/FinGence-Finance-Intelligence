import { configDefaults, defineConfig } from "vitest/config";

// This profile is deliberately incompatible with real inference/evaluation mode.
if (process.env.AI03_REAL === "1" || process.env.AI05_STAGE?.trim()) {
  throw new Error("The synthetic CI unit profile cannot run real inference or official evaluation");
}

const isolated = [
  "tests/reconciliation/ai05-metrics.test.ts",
  "tests/reconciliation/ai05-ci-freeze.test.ts",
];

export default defineConfig({
  envDir: false,
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 300000,
    testTimeout: 30000,
    isolate: true,
    projects: [
      {
        extends: true,
        test: {
          name: "standard",
          include: ["tests/**/*.test.ts"],
          // Routed to the second project below, not skipped or dropped.
          exclude: [...configDefaults.exclude, ...isolated],
        },
      },
      {
        extends: true,
        test: {
          name: "ai05-freeze-unit",
          include: isolated,
          setupFiles: ["tests/reconciliation/ai05-ci-freeze.setup.ts"],
        },
      },
    ],
  },
});

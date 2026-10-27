import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local AI state and evaluation labels must never enter a deployment artifact.
  // Runtime page/API guards independently deny all production AI processing.
  outputFileTracingExcludes: {
    "/*": [".ai-local/**/*", ".venv-ai/**/*", ".env*", ".codegraph/**/*", "**/__pycache__/**/*", "tests/**/*", "docs/**/*"],
  },
};

export default nextConfig;

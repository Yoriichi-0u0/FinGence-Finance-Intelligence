import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF and OCR reading in a server processing job: pdf.js and tesseract.js load worker code from their own package files, which bundling breaks.
  serverExternalPackages: ["tesseract.js", "@tesseract.js-data/eng", "pdfjs-dist"],
  // Local AI state and evaluation labels must never enter a deployment artifact.
  // Runtime page/API guards independently deny all production AI processing.
  outputFileTracingExcludes: {
    "/*": [".local/**/*", ".ai-local/**/*", ".venv-ai/**/*", ".env*", ".codegraph/**/*", "**/__pycache__/**/*", "tests/**/*", "docs/**/*"],
  },
};

export default nextConfig;

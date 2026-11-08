import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF and OCR reading in a server processing job: pdf.js and tesseract.js load worker code from their own package files, which bundling breaks.
  serverExternalPackages: ["tesseract.js", "@tesseract.js-data/eng", "pdfjs-dist"],
  // A server processing job reads PDFs and scans in the hosted function, so the files pdf.js and tesseract.js load at run
  // time (never imported statically, so never traced) are included: pdf.js's worker, the canvas pdf.js draws scanned
  // pages on (with this platform's native binary), the OCR worker script and its dependencies, the OCR engine and the
  // English language data.
  outputFileTracingIncludes: {
    "/api/processing/jobs": [
      "./node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/.pnpm/pdfjs-dist@*/node_modules/@napi-rs/**",
      "./node_modules/.pnpm/@napi-rs+canvas*/node_modules/@napi-rs/**",
      "./node_modules/.pnpm/tesseract.js@*/node_modules/**",
      "./node_modules/.pnpm/{tesseract.js-core,bmp-js,zlibjs,wasm-feature-detect,is-url,regenerator-runtime}@*/node_modules/**",
      "./node_modules/@tesseract.js-data/eng/package.json",
      "./node_modules/.pnpm/@tesseract.js-data+eng@*/node_modules/@tesseract.js-data/eng/{package.json,4.0.0/**}",
    ],
  },
  // Local AI state and evaluation labels must never enter a deployment artifact.
  // Runtime page/API guards independently deny all production AI processing.
  outputFileTracingExcludes: {
    "/*": [".local/**/*", ".ai-local/**/*", ".venv-ai/**/*", ".env*", ".codegraph/**/*", "**/__pycache__/**/*", "tests/**/*", "docs/**/*"],
  },
};

export default nextConfig;

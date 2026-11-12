import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF and OCR reading in a server processing job: pdf.js and tesseract.js load worker code from their own package files, which bundling breaks.
  serverExternalPackages: ["tesseract.js", "@tesseract.js-data/eng", "pdfjs-dist"],
  // A server processing job reads PDFs and scans in the hosted function, so the files pdf.js and tesseract.js load at run
  // time (never imported statically, so never traced) are included: pdf.js's worker, the canvas pdf.js draws scanned
  // pages on (with this platform's native binary), the OCR worker script and its dependencies, the OCR engine and the
  // English language data.
  // Keys are matched against the route's entry, so "/api/processing/jobs/route" is the job route alone. The shorter
  // "/api/processing/jobs" also matched the job status route (/api/processing/jobs/[id]), which only reads a job from the
  // store and never reads a PDF or a scan, and copied these files into it too (about 87 MB per deployment).
  // In Node, tesseract.js loads one `<core>.js` with its `<core>.wasm` (picked by SIMD support and engine mode;
  // 7.0.0 loads a non-LSTM core even for `createWorker('eng', 1, …)`), never the browser-only single-file `.wasm.js`
  // builds, so only those twelve core files are named (about 26 MB less per deployment). They are named through
  // tesseract.js's own pnpm link, which the trace needs so that `require('tesseract.js-core/…')` resolves; a glob that
  // matches the link itself, as `tesseract.js@*/node_modules/**` did, copies the whole package behind it. Excludes do
  // not remove files an include added, so narrowing has to happen here. `pnpm check:job-trace` proves the result.
  outputFileTracingIncludes: {
    "/api/processing/jobs/route": [
      "./node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/.pnpm/pdfjs-dist@*/node_modules/@napi-rs/**",
      "./node_modules/.pnpm/@napi-rs+canvas*/node_modules/@napi-rs/**",
      "./node_modules/.pnpm/tesseract.js@*/node_modules/{tesseract.js,bmp-js,idb-keyval,is-url,node-fetch,opencollective-postinstall,regenerator-runtime,wasm-feature-detect,zlibjs}/**",
      "./node_modules/.pnpm/tesseract.js@*/node_modules/tesseract.js-core/{package.json,index.js,tesseract-core{,-lstm,-simd,-simd-lstm,-relaxedsimd,-relaxedsimd-lstm}.{js,wasm}}",
      "./node_modules/.pnpm/{bmp-js,zlibjs,wasm-feature-detect,is-url,regenerator-runtime}@*/node_modules/**",
      "./node_modules/@tesseract.js-data/eng/package.json",
      "./node_modules/.pnpm/@tesseract.js-data+eng@*/node_modules/@tesseract.js-data/eng/{package.json,4.0.0/**}",
    ],
  },
  // Local AI state and evaluation labels must never enter a deployment artifact.
  // Runtime page/API guards independently deny all production AI processing.
  outputFileTracingExcludes: {
    "/*": [
      ".local/**/*", ".ai-local/**/*", ".venv-ai/**/*", ".env*", ".codegraph/**/*", "**/__pycache__/**/*", "tests/**/*", "docs/**/*",
      // PGlite is the local-only database (every route that opens it requires NODE_ENV=development and no VERCEL), so its
      // engine and data files (about 16.6 MB, copied into each of 11 routes) never ship. Its small JS chunks stay, so those
      // routes still load and answer their own 404.
      ".next/server/assets/{pglite,initdb}.*",
    ],
  },
};

export default nextConfig;

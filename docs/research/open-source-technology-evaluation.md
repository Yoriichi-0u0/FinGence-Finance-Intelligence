# Open-source technology evaluation — FinGence 2.0

20 October 2026. **Implemented local extraction feasibility study; live LLM evaluation unavailable.**
Source snapshots: [GitHub metadata](github-candidates.json), [measured extraction results](extraction-benchmark.json), [observed model assets](model-assets.json).
The academic title and FinGence 1.0 financial contracts remain unchanged. These are developer experiments on controlled synthetic documents, not a client-document validation study.

## Candidates and maintenance

Stars and latest push timestamps below were fetched from GitHub on 20 October. A recent push is maintenance evidence, not proof of quality. Source/documentation inspection preceded selection; only the two specified extraction configurations were benchmarked locally.

| Repository | Stars | Latest push (UTC) | Code license | Suitability and installation cost |
|---|---:|---|---|---|
| [Docling](https://github.com/docling-project/docling) | 69,142 | 19 Oct 15:59 | MIT | PDF, images, XLSX and many office formats. Local OCR, table cells, page geometry and structured JSON. Python worker fits the Node boundary. CPU mode works here; Torch/model downloads and roughly 2–3 GiB peak process RSS are substantial. **Selected for PDF/images.** |
| [MarkItDown](https://github.com/microsoft/markitdown) | 191,138 | 4 Oct 03:59 | MIT | CSV/XLSX/PDF/image conversion to Markdown. Its PDF converter uses text extraction; the inspected image converter provides metadata and optional LLM description. It does not provide the independent table-cell evidence boundary needed here. Python integration is straightforward but would still need separate OCR/coordinates. Not installed. |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | 91,391 | 16 Sep 03:31 | Apache-2.0 | Image/scanned-PDF OCR and PP-Structure table/layout pipelines. Strong candidate for later OCR comparison. Paddle/model/runtime setup would duplicate the working ONNX OCR stack; no local financial benchmark of PaddleOCR was run. CPU/GPU configurations and model-specific licenses need separate checks. |
| [Unstructured](https://github.com/Unstructured-IO/unstructured) | 15,578 | 19 Oct 23:08 | Apache-2.0 | Format-specific partitioners for spreadsheets, PDF and images, with OCR/high-resolution table options and element metadata. Local paths and hosted products must be distinguished. Python/native/model dependencies are broader than this bounded worker requires. Not installed or benchmarked. |
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs) | 3,366 | 20 Oct 00:08 | MIT | TypeScript stateful orchestration; no document extractor or OCR. Useful when durable graph/checkpoint orchestration becomes a demonstrated need. A short observable pipeline does not need it yet. |
| [Vercel AI SDK](https://github.com/vercel/ai) | 27,405 | 20 Oct 01:26 | Apache-2.0 per repository license; GitHub metadata reports NOASSERTION | TypeScript provider abstraction, structured generation and streaming; no OCR/table verification. Compatible with Next.js, but direct official OpenAI SDK plus a small provider interface is sufficient for one experimental provider. Not installed. |

The inspected APIs and examples include [Docling's supported formats](https://docling-project.github.io/docling/usage/supported_formats/), [DoclingDocument structure](https://docling-project.github.io/docling/concepts/docling_document/), MarkItDown's [image converter](https://github.com/microsoft/markitdown/blob/v0.1.8/packages/markitdown/src/markitdown/converters/_image_converter.py) and PDF converter, [PaddleOCR PP-Structure](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PP-StructureV3.html), [Unstructured partitioning](https://docs.unstructured.io/open-source/core-functionality/partitioning), and [AI SDK structured output](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data). No large third-party source tree was copied.

## Actual comparison

Both approaches processed the **same bytes**, with the same six source columns and independent evaluation-only labels. Positive cases: two-page digital PDF, scanned PDF, mixed digital/scanned PDF, PNG and JPEG. A blurred low-resolution PNG is a negative case. CSV/XLSX keep the already tested FinGence readers; replacing those readers offered no demonstrated improvement.

1. **Lightweight baseline:** pdfplumber table extraction; PDFium rendering plus RapidOCR ONNX when a PDF page lacks text; RapidOCR for images. OCR regions are preserved without custom row reconstruction.
2. **Selected:** Docling slim with local layout/table models, RapidOCR ONNX and two CPU threads. No GPU or cloud extraction service was used.

Each file/engine pair ran three sequential extractions in a fresh process. First-run latency includes process/model initialization but **not first-ever model downloads**, since caches were populated. Warm latency is the median of runs two and three. Peak RSS is the whole worker process, not model size or total machine memory. Other machine activity may affect timings; this is a small feasibility comparison, not a controlled performance publication.

| Positive input | Expected rows | Lightweight exact rows / fields | Docling exact rows / fields |
|---|---:|---|---|
| Digital PDF | 4 | 4 / 24 | 4 / 24 |
| Scanned PDF | 4 | 0 / 0 | 4 / 24 |
| Mixed PDF | 4 | 2 / 12 | 4 / 24 |
| PNG | 2 | 0 / 0 | 2 / 12 |
| JPEG | 2 | 0 / 0 | 2 / 12 |
| **Total repeated representations** | **16** | **6 / 36** | **16 / 96** |

Fields are exact strings associated with the correct unique transaction-ID row and named column. One-to-one matching prevents a repeated currency string from satisfying multiple rows. All six fields are checked: identifier, both dates, amount, currency and description. The 16 rows represent repeated document versions of four underlying synthetic transactions; they are not 16 independent financial examples.

Both configurations found all 96 expected strings somewhere in positive documents. That global presence metric is **not positional extraction accuracy**: the lightweight OCR path could not establish the scanned/image table rows. Neither extractor returned accepted financial data from the unreadable example. Coordinates, source hash and page/cell references were checked separately in executable tests.

Docling recovered the required structure at a measured warm cost of several seconds and around 2–3 GiB process RSS; the lighter path was faster and smaller but insufficient for independently verified scanned-table structure. Exact per-file milliseconds, RSS, hashes and coverage are retained in the JSON results. **No live LLM financial-interpretation accuracy has been measured.** Recorded test proposals exercise the verifier only.

## Licenses, models and security

Docling's MIT code license does not cover every model automatically. The [Heron model card](https://huggingface.co/docling-project/docling-layout-heron/blob/main/README.md) declares Apache-2.0. The observed docling-models card declares CDLA-Permissive-2.0; per-artifact notices must be retained. [RapidOCR](https://github.com/RapidAI/RapidOCR) code is Apache-2.0. Its evaluated PP-OCRv6 ONNX assets have published download hashes, matched in the asset inventory, but weight-specific redistribution clearance has **not** been completed. Model binaries are not distributed in this repository. Wider redistribution or production adoption needs a dedicated license review. The selected PDF tooling also has its own transitive/native licenses; this is not a legal clearance claim.

Parsing untrusted PDFs/images is a separate risk from prompt injection. This prototype permits only SHA-256-registered synthetic files at the HTTP and CLI entry points; enforces byte/page/pixel/row/column/output/time limits; runs extraction in a bounded local subprocess without application credentials; retains exact evidence; and rejects partial conversion. It is not a container sandbox or a production upload security boundary. Model downloads need network access during setup. No document URL ingestion, model tools, SQL execution or arbitrary generated code is permitted. Production HTTP processing is disabled.

## Selected stack and effort

- Unchanged TypeScript CSV/XLSX readers, hashing, exact-decimal/date normalization and validation.
- Python 3.12 + pinned Docling slim / RapidOCR ONNX for PDF/images; pdfplumber/PDFium retained as the benchmark comparator.
- Small versioned evidence and declarative-blueprint types, independent synthetic-policy verifier and reusable column-template experiment.
- Official OpenAI SDK 7.39.0 and Zod 4.6.7; no orchestration framework. The new direct Zod pin also resolves the existing compatible ESLint Zod dependency to 4.6.7; this incidental lock resolution is disclosed, not a broad upgrade.
- Local Next.js upload/observable stages and Node CLI. Node 24.22.0 / pnpm 11.19.0 were used.

See `requirements-ai.in` for direct Python inputs and `requirements-ai-lock.txt` for the exact tested environment. The lock was captured on macOS arm64; another OS needs its own installation verification. First setup downloads substantial packages and models. On a compatible machine, allow roughly 30–60 minutes for installation/cache population and a few minutes for evaluation; this is an estimate, not a measured teammate onboarding result. Add a separate day of focused evaluation for a new language/layout; do not assume this tiny benchmark generalizes.

The academic contribution is the evidence/blueprint/verification/reuse boundary and its measurable safeguards, not proprietary OCR. General unfamiliar-layout rule synthesis, live multimodal accuracy, wider client data and production deployment remain unverified.

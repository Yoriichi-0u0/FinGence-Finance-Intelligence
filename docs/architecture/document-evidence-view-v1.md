# Document evidence view v1: the document and what FinGence read, side by side

6 November 2026. On the Data page, **Compare each document with what FinGence read** opens one panel per processed document:

- **Left, the document as supplied.**
  - PDFs (text or scanned) are drawn page by page with pdf.js in the browser; photos are shown as they are.
  - A box over every cell FinGence read is coloured by the field it was read as: date, description, amount, reference, counterparty, record ID or balance.
  - CSV files and Excel worksheets are shown as their table, line by line, with the same colours.
- **Right, the verified records.** The same rows every page reads, each with the line it came from.
- **Linked.** Hovering or tapping a record highlights its line on the left, and the reverse. Lines nothing was read from (letterheads, headings, totals, page text) stay dim.
- **Honest about the AI.** A dashed outline marks the lines the AI model was shown (headings and a few samples, about 15 to 21 lines). The model proposes the layout from those; the code reads and checks every line.
- **OCR uncertainty.** A red outline marks a cell the two OCR passes read differently.

Everything is computed in the browser from the processing's own reading. Nothing is sent anywhere, and nothing about the processing changes: same records, same processing ID.

## Data

- `ProcessedDocument.reading` (`lib/document-ingestion/ingest.ts`):
  - `rows`, the table as read;
  - `records`, each verified record's ID and source line. An AI-read document's lines come from the gates' canonical `lineage`; a supported-schema document has one record per line after its header;
  - `columns`, the column each field was read from;
  - `aiLines`, the evidence lines sent to the model.
- `ExtractedSource.geometry` and `coords` (`lib/interpretation/extract.ts`, `positioned.ts`):
  - for every table line, its page and a box per cell, in the words' coordinates;
  - per page, how those map to the drawing: PDF points times a scale, or the stored scan's pixels.
  - A server processing job keeps them in its stored reading, so the browser's re-check shows them too. Readings stored before this version have none, and the view falls back to the line-by-line table.

## Limits

- On a tilted scan the boxes follow the de-skewed lines, so they can sit slightly off a strongly tilted page.
- A scanned PDF page stored as one image is assumed to fill the page.

## Tests

`tests/document-ingestion/reading.test.ts`:
- every record of a supported-schema CSV points to the line that holds its ID;
- every record of an AI-read CSV points to the line that holds its amount, and the AI lines are a strict subset of the lines;
- every record of a text PDF has boxes on its page;
- scan pixel sizes are read from the image header.

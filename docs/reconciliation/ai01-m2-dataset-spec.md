# AI01 M2 dataset specification

30 October 2026, Asia/Singapore. `ai01-m2/1.1.0`, default seed `fingence-ai01-m2-frozen-001`. This specification defines a new 300-row, twelve-schema research benchmark. M1 `ai01-m1/1.0.1` remains an unchanged historical pilot. Neither milestone implements a matching algorithm or proves H1–H4.

## Frozen source allocation

Each template has 25 normalized records and belongs to one split. All templates are new; none of M1's four templates is repurposed as unseen evaluation data.

| Split | Template | Meaningful source characteristics |
| --- | --- | --- |
| Train | m2-bank-structured | CSV, ISO dates, structured references, signed cash, transaction-date basis |
| Train | m2-ledger-cash | Cash-book journal, cash-asset debit/inflow and credit/outflow, ISO transaction dates |
| Train | m2-bank-workbook | Logical worksheet, DMY source dates, unsigned amount plus direction, posting-date basis |
| Train | m2-ledger-invoice | Invoice/supplier CSV, DMY settlement dates, restricted paid-expense debit/refund credit |
| Train | m2-bank-abbreviated | Abbreviated merchant CSV, MDY dates, separate cash-in/cash-out columns |
| Train | m2-ledger-journal | ISO signed expense journal; paid expense positive/outflow, refund negative/inflow |
| Development | m2-bank-booking | Signed account delta, separate initiation/booking dates, DMY posting-date basis |
| Development | m2-ledger-supplier | Supplier-remittance journal, unsigned amount/direction, DMY posting-date basis |
| Held-out | m2-bank-wallet | Wallet CSV, unsigned value/flow, ISO occurrence date, optional trace metadata |
| Held-out | m2-ledger-minimal | Minimal signed cash book, MDY transaction date, sparse optional metadata |
| Held-out | m2-bank-treasury | Logical treasury worksheet, MDY trade/settlement dates, signed settled cash |
| Held-out | m2-ledger-localized | Malay field-name journal, DMY posting dates, paid-expense/refund debit/credit view |

Schemas differ in monetary interpretation, date basis/source date conventions, source layout, primary field mappings and descriptive vocabulary. `fields` lists distinctive primary source mappings; common optional research fields remain defined by the normalized Transaction contract. These are logical source descriptions, not complete physical file parsers. Provenance names designate synthetic logical sources. No CSV/XLSX/PDF/image reading is implemented, and normalized dates always use ISO regardless of the declared source date convention.

## Distribution and economic accounting

| Split | Schemas | Rows | Bank | Ledger | True pairs | Full groups | Partial groups | Negatives | Unmatched | Ambiguous cases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Training | 6 | 150 | 75 | 75 | 48 | 3 | 3 | 42 | 36 | 12 |
| Development | 2 | 50 | 25 | 25 | 16 | 1 | 1 | 14 | 12 | 4 |
| Held-out | 4 | 100 | 50 | 50 | 32 | 2 | 2 | 28 | 24 | 8 |
| Total | 12 | 300 | 150 | 150 | 96 | 6 | 6 | 84 | 72 | 24 |

The 96 true pairs use 192 rows; twelve three-row groups use 36; 72 unmatched rows complete the 300-row economic partition. Group totals are not counted as individual positive candidate pairs. Ambiguous cases overlap the partition: 78 rows include 30 true pairs and 18 unmatched decoys. Sixty pairs have provisional SUGGEST_PAIR outcomes, 30 true pairs abstain for ambiguity, six abstain for insufficient references, and twelve groups remain unresolved. Unmatched outcomes are UNRESOLVED_UNMATCHED. No outcome is an authorized financial confirmation.

Six independently identified 50-row blocks contain the following scenario structure (three train, one development, two held-out). Shared scenario families are intentional; merchants, references, identities, periods and source schemas are split-specific. Repeating a family is not a claim of statistical independence.

| Family | Rows per block | Case and annotation |
| --- | ---: | --- |
| A | 2 | Exact pair, identifiable reference, inflow |
| B | 2 | Delivery charge versus Malay freight wording; references absent on both sides |
| C | 2 | Equipment-repair abbreviation and merchant spelling changes; independent bank/supplier references |
| D | 2 | English supplies versus Malay/mixed-language wording; bank reference absent |
| E | 4 | Two recurring true pairs with indistinguishable evidence; cross-pairs explicitly negative |
| F | 3 | One bank, two plausible ledger candidates; one decoy |
| G | 2 | Author-known pair, missing references, insufficient-evidence abstention |
| H | 2 | Optional counterparty/source ID/date unavailable; retained supported reference |
| I | 2 | Two unmatched bank events |
| J | 1 | Unmatched ledger event |
| K | 2 | Identical descriptions, 88.10 versus 88.11, explicit amount negative |
| L | 2 | Identical descriptions, MYR versus USD, explicit currency negative |
| M | 2 | Identical descriptions, different counterparties, explicit identity negative |
| N | 3 | Duplicate ledger candidates with unique source identities |
| O | 3 | Duplicate bank candidates with unique source identities |
| P | 2 | Different transaction/posting dates and an authored one-day counterpart lag |
| Q | 2 | Bank service fee and its ledger counterpart |
| R | 4 | Original outflow and corresponding refund/inflow as two separate economic pairs |
| S | 3 | Two bank payments (25 + 50), ledger obligation 100, outstanding 25; unresolved partial |
| T | 3 | Bank 300 against ledger 125 + 175; unresolved complete group |
| U | 2 | Exact 9007199254740993.123456789 pair |
| V | Outside candidate rows | Eight rejected examples: Number/null money, impossible date, absent currency, unapproved/legacy-VALID eligibility, unknown monetary basis/source |

The accepted population is exactly 300; the eight V fixtures are **additional validation examples**, never candidate records or economic accounting entries. Their expected rejection is verified separately. M2 includes both one-to-many and many-to-one relationships. Partial outstanding balances live only in private annotations, not fabricated financial records; bank sums plus the declared positive outstanding amount must equal the ledger obligation exactly.

## Description-dependent competing payments (1.1.0 correction)

B, C and D are three separate equal-value service payments from the same supplier on the same transaction and posting day. All six records share amount, currency, direction, counterparty and dates. B has no references; C retains differing source-specific references; D lacks a bank reference. Delivery, equipment repair and supplies are distinguished by descriptive evidence. Each true edge has two explicitly labelled DISTINCT_EVENT alternatives, adding 36 negative edges across six blocks. Economic relationships and the 60 provisional suggestions are unchanged.

These 18 suggestions require examining descriptions beyond exact reference equality. They are not guaranteed difficult for fuzzy rules, dictionaries or any model. A safe system may still abstain; SUGGEST_PAIR is a research annotation, never financial approval. E/F/N/O retain identical permitted evidence and require abstention. No model inference, E5 tuning or AI02 baseline implementation was used. Read-only diagnostics report shortcut coverage rather than model accuracy.

## Ground truth and independent validation

scenarios.ts is the author-only economic event board. It is defined before rendering text and contains no algorithm output. annotations.ts separately lists required pairs/groups, negative edges/reasons, unmatched rows, outcomes and family membership by source coordinates. The validator imports neither the generator nor the author board. It resolves real IDs from immutable source coordinates, checks the independent inventory and then verifies financial consistency. This is M2-version-specific coverage, not a universal label-count policy. Additional consistent explicit negatives can be added; deleting any required edge or changing its reason fails.

Economics, eligibility and operational outcomes are separate. Every eligible record has one economic disposition. Positive/negative contradictions, duplicate economic use, duplicate event/relationship IDs, missing annotations, unknown references and forced group/ambiguity suggestions fail. All unlisted Cartesian bank–ledger edges are **unannotated**, not implied negatives. Six source blocks yield 180 distinct private economic event identities (96 pairs + 12 groups + 72 unmatched events).

Recurring and duplicate candidates have identical allowed amount/currency/direction/text/date evidence; references and source transaction IDs are null. All candidate source identities remain unique. An exact-date matcher cannot resolve these cases. Metadata such as source-row ordering, account/template IDs, monetary/date basis labels and private case/event IDs is interpretation or bookkeeping context and must not be used as a counterpart tie-breaker.

## Financial contract

All money is bounded canonical decimal text. The unchanged M1 BigInt-scaled arithmetic supports exact sums/comparisons; Number is used only for counts, row coordinates and date/scale metadata. Original sourceAmount or debit/credit values are preserved separately from positive economic magnitude. Signed cash, explicit direction, cash-asset debit/credit, restricted expense debit/credit and signed paid-expense views each have documented sign conventions. The expense conventions do not generalize to arbitrary ledgers.

Null means unavailable. No missing monetary value is replaced by zero, no currency is converted, and no unsupported amount tolerance or settlement policy is inferred. Source identities, coordinates, accounts, normalized calendar dates, selected canonical basis and disjoint accounting periods are verified. Eligibility is SYNTHETIC_RESEARCH_ELIGIBLE only, a research marker with no ingestion V2 or authorization meaning. Legacy VALID/WARNING does not satisfy it.

Case P's SUGGEST_PAIR label is an authored experimental suggestion backed by common reference/economics; it establishes no client-approved date window. Partial/grouped cases always remain unresolved. Reversals are separate signed-direction events, not automatic netting or duplicated records.

## Determinism and frozen artifacts

The configurable printable seed, explicit version and domain-separated SHA-256 derive IDs, references and a BigInt amount offset. Dates/periods and source allocation are fixed. Record ordering is opaque-ID lexical order. There is no current clock, uncontrolled random input or network dependency. Canonical JSON sorts object keys, preserves array ordering and adds one LF. Every artifact is UTF-8 and byte-hashed; no line-ending normalization is used for frozen JSON.

The fixture directory contains three input JSON files, two development annotation files, one evaluator-only held-out annotation file, eight rejection examples in one file, split-manifest.json and artifact-manifest.json. The split manifest binds templates/record IDs/periods to input and truth hashes; the artifact manifest hashes all eight other files. Snapshot tests independently regenerate default-seed bytes, and artifact verification rechecks hashes, financial/annotation rules, eligibility rejections and split isolation. Alternate seeds are separately tested but are not additional frozen evaluation splits.

No precision/recall/F1/accuracy or model preference is reported. E0 exact, E1 fuzzy, E2a MiniLM, E2b E5 Small, E2c BGE M3, E3 Splink, E4 verifier ablation and E5 hybrid/abstention are future compatible experiments only. Future evaluation should report recall@1/@3/@5, pair precision/recall/F1, coverage, unresolved ratio, invalid financial pairs, duplicate assignments, latency and resources under an approved protocol.

# Trusted ingestion integration

Start: 5483ed79aba668a70a8d8fb1298390ab0d06092e. Freshly fetched main remains
cb5db4625ceca1cb94867a90a8a3edddbcf1e6ba; it was not checked out or modified.

## Verified available contracts

| Contract | Available meaning | DB04 reconciliation support |
| --- | --- | --- |
| C1 0.1/0.1 | Dataset fingerprint and producer batch, normalized VALID/WARNING records, canonical transaction/posting date basis; rejected rows stay outside normalized | Generic source_system is not trusted BANK/LEDGER identity; no proven VALUE_DATE projection. Explicitly unsupported by this adapter; existing C1 grouped persistence remains unchanged |
| Experimental V2 | Semantic document-kind proposals, financial values and accepted/rejected/unresolved evidence | Not interchangeable with C1 or cash-source-v1; no independently established role/date/provenance mapping for this adapter |
| Existing CashSource normalizer | Registered synthetic source bytes, BANK ValueDate or LEDGER PostingDate, exact signed cents, source record IDs/CSV record coordinates and raw field evidence | Supported through a separately versioned internal envelope |

CashSource is already used by the shared PoC/browser normalizer; it is not Chia's
C1 or V2 accepted-data transport. It accepts an entire valid source or rejects the
document; it has no WARNING/REJECTED row status or producer batch ID. The adapter
does not manufacture those fields. DB04 derives its existing processing ID from
organization, source hashes and pipeline/policy version, not an invented producer
batch. C1 VALID/WARNING and rejected-row boundaries continue to be regression tested
in their existing ingestion/persistence path, without granting them reconciliation
roles. General C1/V2 reconciliation remains a missing external contract.

## Implemented internal adapter and service

`adaptTrustedIngestion` accepts version `db04-trusted-ingestion/1`, contract
`cash-source-v1`, and exactly two `{document:{bytes,filename}, verified:CashSource}`
entries. It owns bounded byte copies, derives roles only from the trusted server
registry, rehashes/re-normalizes with existing normalizeCashSource, and requires
deep equality of the supplied verified output with the authoritative result.
Missing/forged SHA, row IDs, coordinates, money, dates or roles are unsupported.
Filenames never establish roles. Original decimal cells survive in the original
bytes and existing DB04 raw evidence; no decimal conversion is introduced.

Unsupported input returns `{supported:false,reason}` before database access:
UNSUPPORTED_CONTRACT_OR_CLASSIFICATION, INVALID_SOURCE_PROVENANCE or
CONFLICTING_SOURCE_CLASSIFICATION. A TypeScript accepted label alone confers no
trust. This is internal server composition, not an arbitrary JSON/browser API.
Registration is constructor-controlled, never supplied by an upload request.

`createTrustedIngestionService(database, registry).process(token, input, e5?)`
reuses the existing authenticated DB04 persistence, get, rankFuzzy, optional rankE5
and verifyRankings methods. It returns the same processing receipt and protected
context. Existing immutable rankings are reused; a repeated request does not
rerun E5 when its evidence already exists. The optional provider must be an
explicit supported local provider, not a browser/provider claim. AI proposals
remain unresolved under the existing assignment policy.

Document/accepted-record/deterministic writes remain atomic in the original
persist transaction. Subsequent ranking and verification stages retain their own
atomic transactions. A later stage failure does not erase an already acknowledged
financial commit; errors propagate without automatic retry or success fallback.
No table, migration, financial query, public route or dashboard mapping was added.

Required external work for broader support: establish a versioned, independently
verified producer contract for BANK/LEDGER authority, original source bytes/hash,
producer batch and row identity, VALUE_DATE versus POSTING_DATE, monetary basis,
currency/direction, warning eligibility and verification evidence. Do not infer
these from a filename, source_system, model document-kind label or V2 cast.

## Executed evidence

Relevant suite: 631 passed, 0 failed, 10 existing skips, with real E5 enabled
(outputs/db04-ai06/trusted-ingestion.json). Final focused run: 86 passed,
0 failed, 0 skipped, including 26 native PostgreSQL tests, in
trusted-ingestion-release.json. Typecheck, focused lint and server-boundary
checks pass. Runs overlap and must not be summed.
Native integration starts with actual normalizer-produced CashSource objects,
persists through the adapter, retains exact 06380.53 source meaning and record
IDs, generates fuzzy/real E5 evidence, independently verifies, retrieves, repeats
without new jobs/snapshots/inference, rejects forged output and denies another
organization's access. Existing native tests cover RLS, rollback and reconnect;
existing live Next tests cover upload/dashboard compatibility.

C1/V2 rejection and cash-source support are deliberately separate test claims.
No generic C1/V2 adapter, hosted Supabase result, financial approval, improved
matching accuracy or new browser automation is claimed. Prior full-suite baseline
failures remain disclosed. Production/authentication/Vercel and frozen research
were unchanged; PR #57 remains Draft and unmerged.

# Increment 02 execution ledger

Approved scope: semantic policy registry, field dispositions, independently verified
blueprint reuse, four-format evaluation and separate local developer replay.
Base: da10e2f21add1fec5449ac32ea1affdd8024563b; existing branch retained.

- External snapshot created before edits: increment-02-before-20261020T175250,
  212 source files, source.zip SHA-256
  8fac24d4107e6e49df65099cbecfec96b747caa96dd9b7cdc24d70bc5d2612d1.
  Archive CRC and every source hash verified.
- Ruling: use additive 0.2 modules and a dedicated developer route; preserve every
  Increment 01 source/test/fixture/report byte — avoids weakening the reviewed baseline.
- Ruling: bank movement roles are recognized but not mapped to ledger sides or a
  fabricated signed amount. Their normalization remains explicitly unsupported.
- Ruling: invoice/receipt extraction is supported; transaction normalization remains
  unresolved. Document totals are never copied into transaction amounts.
- Ruling: registry entries are experimental synthetic policies, not client approvals.
- Ruling: provider request preparation is pure/mocked only. No credentials, paid
  calls, commit, push, deployment, dependency update or V2-to-C1 bridge.

Task order: tests → contracts/registry/verifier → evidence/reuse → developer replay
→ synthetic evaluation → full verification/review/archive. Results appended when executed.

- Ruling: add a 26th malformed-value CSV after the initial 25-case evaluation, so
  the developer interface demonstrates actual financial rejection separately from
  unsupported semantic interpretation. Existing 25 source bytes remain unchanged.

- Final verification: 492 tests passed / 9 skipped; lint, type generation/typecheck,
  server-boundary check, production build, Python dependency check and diff whitespace
  check passed. Audit reports 6 high / 5 moderate / 1 low / 0 critical; no packages changed.
- Independent internal review identified two counterexamples: financial text excluded
  as notes and unrepresented text dropped inside table rectangles. Both were reproduced
  with failing regressions, repaired and rechecked. This does not substitute for the
  user's independent review of the delivered ZIP.
- Final 26-document recorded evaluation: 27 accepted / 2 rejected / 14 unresolved
  observed rows; three additional documents have unestablished row structure; one
  deliberate corrupt source fails extraction. No unexpected failures. Zero model calls.
- Preservation: all 212 preexisting source files, original review ZIP, legacy fixtures,
  protected worktrees, sample stash and external backup hashes rechecked unchanged.

-- Additive disposable local PoC only. Never migrate hosted Supabase automatically.
CREATE SCHEMA IF NOT EXISTS fingence_poc;
REVOKE ALL ON SCHEMA fingence_poc FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS fingence_poc.reconciliations (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES fingence_m2.organizations(id),
 created_by uuid NOT NULL REFERENCES fingence_m2.users(id),
 bank_sha256 text NOT NULL CHECK(bank_sha256 ~ '^[a-f0-9]{64}$'),
 ledger_sha256 text NOT NULL CHECK(ledger_sha256 ~ '^[a-f0-9]{64}$'),
 snapshot jsonb NOT NULL CHECK(COALESCE(
  snapshot->>'version'='finance-poc-reconciliation-v1'
  AND snapshot->>'origin'='DETERMINISTIC_RULES'
  AND snapshot #>> '{scope,organizationId}'=organization_id::text
  AND snapshot #>> '{sources,bank,sha256}'=bank_sha256
  AND snapshot #>> '{sources,ledger,sha256}'=ledger_sha256, false)),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,bank_sha256,ledger_sha256)
);
ALTER TABLE fingence_poc.reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_poc FROM PUBLIC, anon, authenticated;
-- Additive human annotations only; the original matcher snapshot is never updated.
CREATE UNIQUE INDEX IF NOT EXISTS reconciliations_organization_id_idx ON fingence_poc.reconciliations(organization_id,id);
CREATE TABLE IF NOT EXISTS fingence_poc.reconciliation_reviews (
 organization_id uuid NOT NULL,
 reconciliation_id uuid NOT NULL,
 outcome_key text NOT NULL CHECK(outcome_key ~ '^[a-f0-9]{64}$'),
 version integer NOT NULL CHECK(version > 0),
 state text NOT NULL CHECK(state IN ('OPEN','INVESTIGATING','EXPLAINED','ESCALATED')),
 rationale text NOT NULL CHECK(length(rationale) <= 600 AND (state='OPEN' OR length(btrim(rationale)) > 0)),
 decided_by uuid NOT NULL REFERENCES fingence_m2.users(id),
 decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,reconciliation_id,outcome_key,version),
 FOREIGN KEY(organization_id,reconciliation_id) REFERENCES fingence_poc.reconciliations(organization_id,id)
);
ALTER TABLE fingence_poc.reconciliation_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fingence_poc.reconciliation_reviews FROM PUBLIC, anon, authenticated;

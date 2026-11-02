-- REVIEW ONLY: disposable local PostgreSQL. Requires v2-m2-local and v2-m3-local.
-- Deliberately separate from C1 financial_records: cash-source-v1 is not C1.
BEGIN;
CREATE SCHEMA fingence_reconciliation;
REVOKE ALL ON SCHEMA fingence_reconciliation FROM PUBLIC;
CREATE TABLE fingence_reconciliation.documents (
 organization_id uuid NOT NULL REFERENCES fingence_m2.organizations,
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK (kind IN ('BANK','LEDGER')),
 classification_method text NOT NULL CHECK (classification_method='REGISTERED_SYNTHETIC_EXACT_SCHEMA'),
 classification_version text NOT NULL CHECK (classification_version='cash-source-v1'),
 original_name text NOT NULL,
 byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 512000),
 PRIMARY KEY(organization_id,sha256), UNIQUE(organization_id,sha256,kind)
);
CREATE TABLE fingence_reconciliation.jobs (
 organization_id uuid NOT NULL REFERENCES fingence_m2.organizations,
 processing_id text NOT NULL CHECK (processing_id ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES fingence_m2.users,
 pipeline_version text NOT NULL,
 policy jsonb NOT NULL CHECK (jsonb_typeof(policy)='object'),
 status text NOT NULL CHECK (status IN ('COMPLETED','COMPLETED_WITH_EXCEPTIONS')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,processing_id),
 FOREIGN KEY(created_by,organization_id) REFERENCES fingence_m2.memberships(user_id,organization_id)
);
CREATE TABLE fingence_reconciliation.job_sources (
 organization_id uuid NOT NULL, processing_id text NOT NULL, sha256 text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('BANK','LEDGER')),
 PRIMARY KEY(organization_id,processing_id,kind),
 UNIQUE(organization_id,processing_id,sha256,kind),
 FOREIGN KEY(organization_id,processing_id) REFERENCES fingence_reconciliation.jobs,
 FOREIGN KEY(organization_id,sha256,kind) REFERENCES fingence_reconciliation.documents(organization_id,sha256,kind)
);
CREATE TABLE fingence_reconciliation.transactions (
 organization_id uuid NOT NULL, processing_id text NOT NULL, sha256 text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('BANK','LEDGER')),
 record_id text NOT NULL CHECK (length(record_id)>0),
 source_row integer NOT NULL CHECK (source_row>=2),
 status text NOT NULL CHECK (status IN ('VALID','WARNING')),
 canonical_date date NOT NULL, transaction_date date, value_date date, posting_date date,
 date_basis text NOT NULL CHECK (date_basis IN ('VALUE_DATE','POSTING_DATE')),
 currency text NOT NULL CHECK (currency='MYR'),
 signed_amount numeric NOT NULL CHECK (signed_amount::text NOT IN ('NaN','Infinity','-Infinity')),
 original_amount text NOT NULL CHECK (original_amount ~ '^-?[0-9]{1,16}(\.[0-9]{1,2})?$' AND original_amount::numeric=signed_amount),
 reference text NOT NULL,
 evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object'),
 PRIMARY KEY(organization_id,processing_id,kind,record_id),
 UNIQUE(organization_id,processing_id,kind,source_row),
 FOREIGN KEY(organization_id,processing_id,sha256,kind) REFERENCES fingence_reconciliation.job_sources(organization_id,processing_id,sha256,kind),
 CHECK (transaction_date IS NULL),
 CHECK ((kind='BANK' AND date_basis='VALUE_DATE' AND value_date IS NOT NULL AND canonical_date=value_date AND posting_date IS NULL)
 OR (kind='LEDGER' AND date_basis='POSTING_DATE' AND posting_date IS NOT NULL AND canonical_date=posting_date AND value_date IS NULL))
);
CREATE TABLE fingence_reconciliation.proposals (
 organization_id uuid NOT NULL, processing_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal>=0),
 bank_kind text NOT NULL DEFAULT 'BANK' CHECK (bank_kind='BANK'),
 ledger_kind text NOT NULL DEFAULT 'LEDGER' CHECK (ledger_kind='LEDGER'),
 bank_record_id text NOT NULL, ledger_record_id text NOT NULL,
 algorithm_version text NOT NULL CHECK (algorithm_version='cash-rules-v1'),
 proposal_type text NOT NULL CHECK (proposal_type='ONE_TO_ONE'),
 PRIMARY KEY(organization_id,processing_id,ordinal),
 UNIQUE(organization_id,processing_id,bank_record_id,ledger_record_id),
 FOREIGN KEY(organization_id,processing_id,bank_kind,bank_record_id) REFERENCES fingence_reconciliation.transactions(organization_id,processing_id,kind,record_id),
 FOREIGN KEY(organization_id,processing_id,ledger_kind,ledger_record_id) REFERENCES fingence_reconciliation.transactions(organization_id,processing_id,kind,record_id)
);
CREATE TABLE fingence_reconciliation.decisions (
 organization_id uuid NOT NULL, processing_id text NOT NULL, ordinal integer NOT NULL,
 policy_version text NOT NULL,
 decision text NOT NULL CHECK (decision IN ('VERIFIED_SUGGESTION','UNRESOLVED')),
 checks jsonb NOT NULL CHECK (jsonb_typeof(checks)='object'),
 CHECK(decision<>'VERIFIED_SUGGESTION' OR checks @> '{"SOURCE_IDENTITY":true,"SCOPE":true,"EXACT_AMOUNT":true,"CURRENCY":true,"DIRECTION":true,"CANONICAL_DATE_POLICY":true,"REFERENCE":true,"COUNTERPARTY":true,"UNIQUE_IDENTITY":true}'::jsonb),
 PRIMARY KEY(organization_id,processing_id,ordinal),
 FOREIGN KEY(organization_id,processing_id,ordinal) REFERENCES fingence_reconciliation.proposals
);
CREATE TABLE fingence_reconciliation.cases (
 organization_id uuid NOT NULL, processing_id text NOT NULL, ordinal integer NOT NULL,
 reason text NOT NULL, evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object'),
 PRIMARY KEY(organization_id,processing_id,ordinal),
 FOREIGN KEY(organization_id,processing_id) REFERENCES fingence_reconciliation.jobs
);
CREATE TABLE fingence_reconciliation.reviews (
 organization_id uuid NOT NULL, processing_id text NOT NULL, case_ordinal integer NOT NULL,
 version integer NOT NULL CHECK(version>0),
 state text NOT NULL CHECK(state IN ('OPEN','INVESTIGATING','EXPLAINED','ESCALATED')),
 rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 600),
 actor_id uuid NOT NULL REFERENCES fingence_m2.users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,processing_id,case_ordinal,version),
 FOREIGN KEY(organization_id,processing_id,case_ordinal) REFERENCES fingence_reconciliation.cases,
 FOREIGN KEY(actor_id,organization_id) REFERENCES fingence_m2.memberships(user_id,organization_id)
);
CREATE TABLE fingence_reconciliation.audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES fingence_m2.organizations,
 processing_id text NOT NULL, actor_id uuid NOT NULL REFERENCES fingence_m2.users,
 action text NOT NULL CHECK(action IN ('PERSISTED','READ','REUSED','REVIEWED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,processing_id) REFERENCES fingence_reconciliation.jobs,
 FOREIGN KEY(actor_id,organization_id) REFERENCES fingence_m2.memberships(user_id,organization_id)
);
CREATE INDEX reconciliation_jobs_created ON fingence_reconciliation.jobs(organization_id,created_at);
CREATE INDEX reconciliation_audit_processing ON fingence_reconciliation.audit(organization_id,processing_id,id);
COMMIT;

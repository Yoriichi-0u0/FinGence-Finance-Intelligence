-- Disposable test schema only. Not a hosted migration or authentication provider.
CREATE SCHEMA fingence_local_security_v1;
REVOKE ALL ON SCHEMA fingence_local_security_v1 FROM PUBLIC, anon, authenticated;
CREATE TABLE fingence_local_security_v1.memberships (
 subject_id uuid NOT NULL, organization_id uuid NOT NULL,
 role text NOT NULL CHECK (role IN ('Finance','Technical (Management)','Admin')),
 active boolean NOT NULL, scope_version integer NOT NULL CHECK(scope_version>0),
 PRIMARY KEY(subject_id,organization_id)
);
CREATE TABLE fingence_local_security_v1.sessions (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 subject_id uuid NOT NULL, organization_id uuid NOT NULL, expires_at timestamptz NOT NULL, revoked boolean NOT NULL,
 FOREIGN KEY(subject_id,organization_id) REFERENCES fingence_local_security_v1.memberships(subject_id,organization_id)
);
CREATE TABLE fingence_local_security_v1.batch_owners (
 batch_id uuid PRIMARY KEY REFERENCES public.ingestion_batches(id), organization_id uuid NOT NULL
);
ALTER TABLE fingence_local_security_v1.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_local_security_v1.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_local_security_v1.batch_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_local_security_v1 FROM PUBLIC, anon, authenticated;

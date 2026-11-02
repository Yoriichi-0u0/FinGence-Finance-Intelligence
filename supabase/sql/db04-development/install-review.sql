-- Atomic isolated development installation; no public foundation changes.
BEGIN;
-- ISOLATED SYNTHETIC DEVELOPMENT ONLY. Personal FYP A fhipzomczevbpybezzxu. Separate approval required.
-- Source: db04-hosted-identity-v1-review.sql
-- PROPOSAL ONLY. No hosted execution or automatic account mapping authorized.
-- Minimal FK compatibility namespaces; NOT the local password/auth/V2 bootstrap.
-- Target personal FYP A fhipzomczevbpybezzxu. Jason must approve authority/SLA first.

CREATE ROLE fingence_db04_dev_broker NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE SCHEMA fingence_db04_dev_identity;

REVOKE ALL ON SCHEMA fingence_db04_dev_identity,fingence_db04_dev_identity FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE fingence_db04_dev_identity.organizations(id uuid PRIMARY KEY,name text NOT NULL);
CREATE TABLE fingence_db04_dev_identity.users(
 id uuid PRIMARY KEY,issuer text NOT NULL CHECK(issuer='https://fhipzomczevbpybezzxu.supabase.co/auth/v1'),
 subject uuid NOT NULL,suspended boolean NOT NULL DEFAULT false,UNIQUE(issuer,subject));
CREATE TABLE fingence_db04_dev_identity.memberships(
 user_id uuid REFERENCES fingence_db04_dev_identity.users,organization_id uuid REFERENCES fingence_db04_dev_identity.organizations,
 role text NOT NULL CHECK(role IN ('Finance','Technical (Management)','Admin')),
 active boolean NOT NULL DEFAULT true,version integer NOT NULL CHECK(version>0),
 PRIMARY KEY(user_id,organization_id));
CREATE TABLE fingence_db04_dev_identity.organization_states(
 organization_id uuid PRIMARY KEY REFERENCES fingence_db04_dev_identity.organizations,active boolean NOT NULL);
CREATE TABLE fingence_db04_dev_identity.sessions(
 id uuid NOT NULL UNIQUE,token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid NOT NULL,organization_id uuid NOT NULL,upstream_session_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,revoked boolean NOT NULL DEFAULT false,
 membership_version integer NOT NULL,contract_version text NOT NULL CHECK(contract_version='hosted-finance-admission/1'),
 FOREIGN KEY(user_id,organization_id) REFERENCES fingence_db04_dev_identity.memberships,
 UNIQUE(id,user_id,organization_id));
-- No email/password, auth.users trigger, invented membership or default tenant.
ALTER TABLE fingence_db04_dev_identity.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_db04_dev_identity.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_db04_dev_identity.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_db04_dev_identity.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_db04_dev_identity.organization_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_db04_dev_identity,fingence_db04_dev_identity FROM PUBLIC,anon,authenticated,service_role;
-- Serialize membership insertion/deletion with admission's locked subject, too:
-- row locks on existing memberships alone cannot prevent a phantom new tenant.
CREATE FUNCTION fingence_db04_dev_identity.membership_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM id FROM fingence_db04_dev_identity.users WHERE id=NEW.user_id FOR UPDATE;
 ELSIF TG_OP='DELETE' THEN
  PERFORM id FROM fingence_db04_dev_identity.users WHERE id=OLD.user_id FOR UPDATE;
 ELSE
  PERFORM id FROM fingence_db04_dev_identity.users WHERE id IN (OLD.user_id,NEW.user_id) ORDER BY id FOR UPDATE;
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.active IS DISTINCT FROM OLD.active THEN NEW.version=OLD.version+1;
  ELSIF NEW.version<OLD.version THEN RAISE EXCEPTION 'membership version cannot decrease' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION fingence_db04_dev_identity.membership_lifecycle() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER membership_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON fingence_db04_dev_identity.memberships
 FOR EACH ROW EXECUTE FUNCTION fingence_db04_dev_identity.membership_lifecycle();

-- Only the trusted server broker may issue short-lived opaque capabilities AFTER
-- cryptographic identity AND authoritative session-lifecycle verification.
CREATE FUNCTION fingence_db04_dev_identity.issue_hosted_grant(hash text,lease_id uuid,iss text,sub uuid,sid uuid,deadline timestamptz)
RETURNS TABLE(user_id uuid,organization_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u record;m record;
BEGIN
 IF iss<>'https://fhipzomczevbpybezzxu.supabase.co/auth/v1'
  OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '30 seconds'
  OR hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO u FROM fingence_db04_dev_identity.users x WHERE x.issuer=iss AND x.subject=sub AND NOT x.suspended FOR SHARE;
 IF u.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 -- More than one eligible membership is ambiguous: no browser-selected tenant.
 IF (SELECT count(*) FROM fingence_db04_dev_identity.memberships x JOIN fingence_db04_dev_identity.organization_states o USING(organization_id)
  WHERE x.user_id=u.id AND x.role='Finance' AND x.active AND o.active)<>1 THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT x.* INTO m FROM fingence_db04_dev_identity.memberships x JOIN fingence_db04_dev_identity.organization_states o USING(organization_id)
  WHERE x.user_id=u.id AND x.role='Finance' AND x.active AND o.active FOR SHARE OF x,o;
 IF m.user_id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 INSERT INTO fingence_db04_dev_identity.sessions VALUES(lease_id,hash,u.id,m.organization_id,sid,deadline,false,m.version,'hosted-finance-admission/1');
 RETURN QUERY SELECT u.id::uuid,m.organization_id::uuid;
END $$;
CREATE FUNCTION fingence_db04_dev_identity.revoke_hosted_grant(hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE fingence_db04_dev_identity.sessions SET revoked=true WHERE token_hash=hash;
$$;
REVOKE ALL ON FUNCTION fingence_db04_dev_identity.issue_hosted_grant(text,uuid,text,uuid,uuid,timestamptz),fingence_db04_dev_identity.revoke_hosted_grant(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA fingence_db04_dev_identity TO fingence_db04_dev_broker;
GRANT EXECUTE ON FUNCTION fingence_db04_dev_identity.issue_hosted_grant(text,uuid,text,uuid,uuid,timestamptz),fingence_db04_dev_identity.revoke_hosted_grant(text) TO fingence_db04_dev_broker;


-- Source: db04-001-reconciliation.sql
-- REVIEW ONLY: disposable local PostgreSQL. Requires v2-m2-local and v2-m3-local.
-- Deliberately separate from C1 financial_records: cash-source-v1 is not C1.

CREATE SCHEMA fingence_reconciliation;
REVOKE ALL ON SCHEMA fingence_reconciliation FROM PUBLIC;
CREATE TABLE fingence_reconciliation.documents (
 organization_id uuid NOT NULL REFERENCES fingence_db04_dev_identity.organizations,
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK (kind IN ('BANK','LEDGER')),
 classification_method text NOT NULL CHECK (classification_method='REGISTERED_SYNTHETIC_EXACT_SCHEMA'),
 classification_version text NOT NULL CHECK (classification_version='cash-source-v1'),
 original_name text NOT NULL,
 byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 512000),
 PRIMARY KEY(organization_id,sha256), UNIQUE(organization_id,sha256,kind)
);
CREATE TABLE fingence_reconciliation.jobs (
 organization_id uuid NOT NULL REFERENCES fingence_db04_dev_identity.organizations,
 processing_id text NOT NULL CHECK (processing_id ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES fingence_db04_dev_identity.users,
 pipeline_version text NOT NULL,
 policy jsonb NOT NULL CHECK (jsonb_typeof(policy)='object'),
 status text NOT NULL CHECK (status IN ('COMPLETED','COMPLETED_WITH_EXCEPTIONS')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,processing_id),
 FOREIGN KEY(created_by,organization_id) REFERENCES fingence_db04_dev_identity.memberships(user_id,organization_id)
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
 actor_id uuid NOT NULL REFERENCES fingence_db04_dev_identity.users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,processing_id,case_ordinal,version),
 FOREIGN KEY(organization_id,processing_id,case_ordinal) REFERENCES fingence_reconciliation.cases,
 FOREIGN KEY(actor_id,organization_id) REFERENCES fingence_db04_dev_identity.memberships(user_id,organization_id)
);
CREATE TABLE fingence_reconciliation.audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES fingence_db04_dev_identity.organizations,
 processing_id text NOT NULL, actor_id uuid NOT NULL REFERENCES fingence_db04_dev_identity.users,
 action text NOT NULL CHECK(action IN ('PERSISTED','READ','REUSED','REVIEWED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,processing_id) REFERENCES fingence_reconciliation.jobs,
 FOREIGN KEY(actor_id,organization_id) REFERENCES fingence_db04_dev_identity.memberships(user_id,organization_id)
);
CREATE INDEX reconciliation_jobs_created ON fingence_reconciliation.jobs(organization_id,created_at);
CREATE INDEX reconciliation_audit_processing ON fingence_reconciliation.audit(organization_id,processing_id,id);


-- Source: db04-002-reconciliation-security.sql
-- LOCAL REVIEW ONLY. Migration owner must differ from runtime. Never run on hosted FYP A.

CREATE ROLE fingence_reconciliation_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
-- The scoped claim is a SHA256 of an authenticated local session token, not a tenant GUC.
-- A restricted role cannot choose an organization by changing a setting.
CREATE FUNCTION fingence_reconciliation.principal()
RETURNS TABLE(user_id uuid, organization_id uuid)
LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path=pg_catalog AS $$
 SELECT s.user_id,s.organization_id FROM fingence_db04_dev_identity.sessions s
 JOIN fingence_db04_dev_identity.memberships m USING(user_id,organization_id)
 JOIN fingence_db04_dev_identity.organization_states o USING(organization_id)
 WHERE s.token_hash=current_setting('fingence.reconciliation_token_hash',true)
 AND NOT s.revoked AND s.expires_at>clock_timestamp() AND m.active AND o.active
 AND m.role='Finance' AND m.version=s.membership_version
 FOR SHARE OF s,m,o
$$;
REVOKE ALL ON FUNCTION fingence_reconciliation.principal() FROM PUBLIC;
-- M5 suspension is optional on legacy M2/M3; enforce it when installed.
CREATE FUNCTION fingence_reconciliation.authorized_organization() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path=pg_catalog AS $$
DECLARE p record; suspended boolean;
BEGIN
 SELECT * INTO p FROM fingence_reconciliation.principal();
 IF p.organization_id IS NULL THEN RETURN NULL; END IF;
 IF to_regclass('fingence_m5.account_suspensions') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM fingence_m5.account_suspensions WHERE user_id=$1)' INTO suspended USING p.user_id;
  IF suspended THEN RETURN NULL; END IF;
 END IF;
 RETURN p.organization_id;
END $$;
REVOKE ALL ON FUNCTION fingence_reconciliation.authorized_organization() FROM PUBLIC;
CREATE FUNCTION fingence_reconciliation.immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'immutable reconciliation evidence' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION fingence_reconciliation.immutable() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['documents','jobs','job_sources','transactions','proposals','decisions','cases','reviews','audit'] LOOP
  EXECUTE format('ALTER TABLE fingence_reconciliation.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE fingence_reconciliation.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY organization_scope ON fingence_reconciliation.%I USING (organization_id=fingence_reconciliation.authorized_organization()) WITH CHECK (organization_id=fingence_reconciliation.authorized_organization())',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fingence_reconciliation.%I FOR EACH ROW EXECUTE FUNCTION fingence_reconciliation.immutable()',t);
 END LOOP;
END $$;
CREATE POLICY actor_binding ON fingence_reconciliation.jobs AS RESTRICTIVE FOR INSERT
 WITH CHECK (created_by=(SELECT user_id FROM fingence_reconciliation.principal()));
CREATE POLICY actor_binding ON fingence_reconciliation.reviews AS RESTRICTIVE FOR INSERT
 WITH CHECK (actor_id=(SELECT user_id FROM fingence_reconciliation.principal()));
CREATE POLICY actor_binding ON fingence_reconciliation.audit AS RESTRICTIVE FOR INSERT
 WITH CHECK (actor_id=(SELECT user_id FROM fingence_reconciliation.principal()));
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_reconciliation FROM PUBLIC;
GRANT USAGE ON SCHEMA fingence_reconciliation TO fingence_reconciliation_runtime;
GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA fingence_reconciliation TO fingence_reconciliation_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA fingence_reconciliation TO fingence_reconciliation_runtime;
GRANT EXECUTE ON FUNCTION fingence_reconciliation.principal(),fingence_reconciliation.authorized_organization() TO fingence_reconciliation_runtime;


-- Source: db04-003-ranking-evidence.sql
-- Additive local review only: rankings never update deterministic decisions.

CREATE TABLE fingence_reconciliation.rankings (
 organization_id uuid NOT NULL, processing_id text NOT NULL,
 version text NOT NULL CHECK(version IN ('db04-fuzzy-proposals/1','db04-e5-proposals/1')),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array'),
 PRIMARY KEY(organization_id,processing_id,version),
 FOREIGN KEY(organization_id,processing_id) REFERENCES fingence_reconciliation.jobs,
 FOREIGN KEY(created_by,organization_id) REFERENCES fingence_db04_dev_identity.memberships(user_id,organization_id)
);
ALTER TABLE fingence_reconciliation.rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_reconciliation.rankings FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_scope ON fingence_reconciliation.rankings
 USING(organization_id=fingence_reconciliation.authorized_organization())
 WITH CHECK(organization_id=fingence_reconciliation.authorized_organization());
CREATE POLICY actor_binding ON fingence_reconciliation.rankings AS RESTRICTIVE FOR INSERT
 WITH CHECK(created_by=(SELECT user_id FROM fingence_reconciliation.principal()));
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fingence_reconciliation.rankings
 FOR EACH ROW EXECUTE FUNCTION fingence_reconciliation.immutable();
REVOKE ALL ON fingence_reconciliation.rankings FROM PUBLIC;
GRANT SELECT,INSERT ON fingence_reconciliation.rankings TO fingence_reconciliation_runtime;


-- Source: db04-004-proposal-verification.sql
-- Local additive verification snapshots. No approved assignment policy exists.

CREATE TABLE fingence_reconciliation.proposal_verifications (
 organization_id uuid NOT NULL,processing_id text NOT NULL,
 snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 policy_version text NOT NULL CHECK(policy_version='db04-independent-proposals/1'),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 outcome text NOT NULL CHECK(outcome='UNRESOLVED'),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array'),
 CHECK(jsonb_array_length(jsonb_path_query_array(evidence,'$[*] ? (@.outcome == "UNRESOLVED")'))=jsonb_array_length(evidence)),
 PRIMARY KEY(organization_id,processing_id,snapshot_sha256,policy_version),
 FOREIGN KEY(organization_id,processing_id) REFERENCES fingence_reconciliation.jobs,
 FOREIGN KEY(created_by,organization_id) REFERENCES fingence_db04_dev_identity.memberships(user_id,organization_id)
);
ALTER TABLE fingence_reconciliation.proposal_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_reconciliation.proposal_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_scope ON fingence_reconciliation.proposal_verifications
 USING(organization_id=fingence_reconciliation.authorized_organization())
 WITH CHECK(organization_id=fingence_reconciliation.authorized_organization());
CREATE POLICY actor_binding ON fingence_reconciliation.proposal_verifications AS RESTRICTIVE FOR INSERT
 WITH CHECK(created_by=(SELECT user_id FROM fingence_reconciliation.principal()));
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fingence_reconciliation.proposal_verifications
 FOR EACH ROW EXECUTE FUNCTION fingence_reconciliation.immutable();
REVOKE ALL ON fingence_reconciliation.proposal_verifications FROM PUBLIC;
GRANT SELECT,INSERT ON fingence_reconciliation.proposal_verifications TO fingence_reconciliation_runtime;


-- Source: db04-hosted-principal-v1-review.sql
-- PROPOSAL ONLY. Run after proposed hosted identity + DB04 001,002,003,004.
-- Replaces only the local-session principal; never map a JWT or browser tenant GUC.

CREATE OR REPLACE FUNCTION fingence_reconciliation.principal()
RETURNS TABLE(user_id uuid,organization_id uuid)
LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path=pg_catalog AS $$
 SELECT s.user_id,s.organization_id FROM fingence_db04_dev_identity.sessions s
 JOIN fingence_db04_dev_identity.users u ON u.id=s.user_id
 JOIN fingence_db04_dev_identity.memberships m USING(user_id,organization_id)
 JOIN fingence_db04_dev_identity.organization_states o USING(organization_id)
 WHERE s.token_hash=current_setting('fingence.reconciliation_token_hash',true)
 AND NOT s.revoked AND s.expires_at>clock_timestamp() AND m.active AND o.active AND NOT u.suspended
 AND s.contract_version='hosted-finance-admission/1'
 AND u.issuer='https://fhipzomczevbpybezzxu.supabase.co/auth/v1'
 AND m.role='Finance' AND m.version=s.membership_version
 FOR SHARE OF s,u,m,o
$$;
REVOKE ALL ON FUNCTION fingence_reconciliation.principal() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION fingence_reconciliation.principal() TO fingence_reconciliation_runtime;
CREATE FUNCTION fingence_reconciliation.current_grant_id() RETURNS uuid
LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path=pg_catalog AS $$
 SELECT s.id FROM fingence_db04_dev_identity.sessions s
 JOIN fingence_reconciliation.principal() p USING(user_id,organization_id)
 WHERE s.token_hash=current_setting('fingence.reconciliation_token_hash',true)
$$;
REVOKE ALL ON FUNCTION fingence_reconciliation.current_grant_id() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION fingence_reconciliation.current_grant_id() TO fingence_reconciliation_runtime;
ALTER TABLE fingence_reconciliation.audit ADD COLUMN session_grant_id uuid NOT NULL
 DEFAULT fingence_reconciliation.current_grant_id();
ALTER TABLE fingence_reconciliation.audit ADD CONSTRAINT audit_hosted_grant_identity
 FOREIGN KEY(session_grant_id,actor_id,organization_id) REFERENCES fingence_db04_dev_identity.sessions(id,user_id,organization_id);
-- Seal only newly created DB04 objects against hosted default grants. No public
-- financial route is enabled between migrations or before independent review.
REVOKE ALL ON SCHEMA fingence_reconciliation FROM anon,authenticated,service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_reconciliation FROM anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA fingence_reconciliation FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fingence_reconciliation FROM PUBLIC,anon,authenticated,service_role;


COMMIT;

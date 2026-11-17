-- REVIEW ONLY / NOT EXECUTED. Separate owner approval required before deployment.
-- Group zmtdozblpvtjniehwjrw / Production main only. Never rerun DB04 001-005.
-- Requires deployed workspace v1/v2/v3 and ingestion/processing contracts.
-- New private schema and execute-only role; no existing object is altered.
-- Provision a dedicated LOGIN separately, privately, only after this SQL is approved.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN IF current_user<>'postgres' THEN RAISE EXCEPTION 'Approved schema/function owner must be postgres'; END IF; END $$;

-- Deliberately fail on collisions rather than treating unknown objects as compatible.
CREATE ROLE fingence_ai06_website_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA fingence_gpt_website;
REVOKE ALL ON SCHEMA fingence_gpt_website FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE fingence_gpt_website.attempts(
 job_id uuid PRIMARY KEY, organization_id uuid NOT NULL, member_id uuid NOT NULL,
 processing_id text NOT NULL CHECK(processing_id ~ '^[a-f0-9]{8,64}$'),
 bank_sha256 text NOT NULL CHECK(bank_sha256 ~ '^[a-f0-9]{64}$'),
 ledger_sha256 text NOT NULL CHECK(ledger_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,member_id,job_id)
);
-- No FK into teammate tables: their deletion/retention behavior must not change.
-- operate() checks those authoritative relationships on EVERY operation instead.
CREATE TABLE fingence_gpt_website.evidence(
 organization_id uuid NOT NULL,member_id uuid NOT NULL,job_id uuid PRIMARY KEY,
 outcome text NOT NULL DEFAULT 'UNRESOLVED' CHECK(outcome='UNRESOLVED'),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=256000),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,member_id,job_id) REFERENCES fingence_gpt_website.attempts(organization_id,member_id,job_id)
);
CREATE TABLE fingence_gpt_website.audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id uuid NOT NULL,member_id uuid NOT NULL,job_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('CLAIM','DUPLICATE','START','SAVE_INTENT','FAILED','READ','READ_EMPTY','SAVED')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON fingence_gpt_website.audit(job_id,action);
ALTER TABLE fingence_gpt_website.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_gpt_website.attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE fingence_gpt_website.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_gpt_website.evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE fingence_gpt_website.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_gpt_website.audit FORCE ROW LEVEL SECURITY;
-- No direct policies/grants: only the reviewed owner-bound function accesses rows.
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_gpt_website FROM PUBLIC,anon,authenticated,service_role,fingence_ai06_website_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA fingence_gpt_website FROM PUBLIC,anon,authenticated,service_role,fingence_ai06_website_runtime;
CREATE FUNCTION fingence_gpt_website.immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'AI06 evidence is append only' USING ERRCODE='42501'; END $$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON fingence_gpt_website.attempts FOR EACH STATEMENT EXECUTE FUNCTION fingence_gpt_website.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON fingence_gpt_website.evidence FOR EACH STATEMENT EXECUTE FUNCTION fingence_gpt_website.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON fingence_gpt_website.audit FOR EACH STATEMENT EXECUTE FUNCTION fingence_gpt_website.immutable();

CREATE FUNCTION fingence_gpt_website.operate(p_token_hash text,p_job uuid,p_action text,p_payload jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 a record; j fingence_processing.jobs; attempt fingence_gpt_website.attempts;
 value jsonb; run jsonb; item jsonb; bsha text; lsha text; n bigint; event text;
BEGIN
 -- website-gpt/1. Hash is server-derived from a verified HttpOnly workspace cookie.
 -- Do not accept request organization/member claims or a Supabase service key.
 IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
  OR p_action IS NULL OR p_action NOT IN ('CLAIM','START','SAVE_INTENT','FAILED','READ','SAVE')
  OR (p_action<>'SAVE' AND p_payload IS NOT NULL) THEN
  RAISE EXCEPTION 'AI06 request denied' USING ERRCODE='42501';
 END IF;
 SELECT * INTO a FROM fingence_workspace.actor(p_token_hash);
 IF NOT FOUND OR a.role NOT IN ('FINANCE','ADMIN','SUPERADMIN') THEN
  RAISE EXCEPTION 'AI06 session denied' USING ERRCODE='42501';
 END IF;
 -- Short-lived locks serialize revocation with this operation, never with a model call.
 PERFORM 1 FROM fingence_workspace.members m WHERE m.id=a.member_id AND m.organization_id=a.organization_id AND m.active AND m.role=a.role FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI06 membership denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM fingence_workspace.sessions s WHERE s.id=a.session_id AND s.member_id=a.member_id AND s.ended_at IS NULL AND s.expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI06 session ended' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM fingence_processing.jobs
 WHERE id=p_job AND organization_id=a.organization_id::text AND member_id=a.member_id
  AND status='COMPLETED' AND outcome IN ('COMPLETED','COMPLETED_WITH_EXCEPTIONS') AND ingestion_run_id IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI06 job denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM fingence_ingestion.runs r WHERE r.id=j.ingestion_run_id AND r.organization_id=a.organization_id AND r.member_id=a.member_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI06 ingestion scope denied' USING ERRCODE='42501'; END IF;
 IF p_action<>'READ' AND NOT EXISTS(SELECT 1 FROM fingence_workspace.organizations o WHERE o.id=a.organization_id AND NOT o.processing_paused AND o.ai_enabled) THEN
  RAISE EXCEPTION 'AI06 processing disabled' USING ERRCODE='42501';
 END IF;
 IF p_action='CLAIM' THEN
  SELECT count(*),min(d->>'sha256') INTO n,bsha FROM fingence_processing.results r,
   LATERAL jsonb_array_elements(r.documents) d WHERE r.job_id=p_job AND d->>'role'='BANK_STATEMENT' AND d->>'decision'='AUTO_ACCEPTED';
  IF n<>1 THEN RAISE EXCEPTION 'AI06 bank source denied'; END IF;
  SELECT count(*),min(d->>'sha256') INTO n,lsha FROM fingence_processing.results r,
   LATERAL jsonb_array_elements(r.documents) d WHERE r.job_id=p_job AND d->>'role'='GENERAL_LEDGER' AND d->>'decision'='AUTO_ACCEPTED';
  IF n<>1 THEN RAISE EXCEPTION 'AI06 ledger source denied'; END IF;
  INSERT INTO fingence_gpt_website.attempts(job_id,organization_id,member_id,processing_id,bank_sha256,ledger_sha256)
  VALUES(p_job,a.organization_id,a.member_id,j.processing_id,bsha,lsha) ON CONFLICT(job_id) DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT; value=to_jsonb(n=1); event=CASE WHEN n=1 THEN 'CLAIM' ELSE 'DUPLICATE' END;
 ELSIF p_action='READ' THEN
  SELECT e.payload INTO value FROM fingence_gpt_website.evidence e
   WHERE e.job_id=p_job AND e.organization_id=a.organization_id AND e.member_id=a.member_id;
  event=CASE WHEN FOUND THEN 'READ' ELSE 'READ_EMPTY' END;
 ELSE
  SELECT * INTO attempt FROM fingence_gpt_website.attempts t WHERE t.job_id=p_job AND t.organization_id=a.organization_id AND t.member_id=a.member_id;
  IF NOT FOUND OR attempt.processing_id<>j.processing_id OR EXISTS(SELECT 1 FROM fingence_gpt_website.evidence e WHERE e.job_id=p_job)
   OR EXISTS(SELECT 1 FROM fingence_gpt_website.audit e WHERE e.job_id=p_job AND e.action='FAILED') THEN
   RAISE EXCEPTION 'AI06 attempt unavailable' USING ERRCODE='42501';
  END IF;
  IF p_action='SAVE' THEN
   IF p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>256000
    OR p_payload->>'version' IS DISTINCT FROM 'gpt-evidence-view/1' OR p_payload->>'batchId' IS DISTINCT FROM p_job::text
    OR p_payload->>'processingId' IS DISTINCT FROM j.processing_id OR jsonb_typeof(p_payload->'runs') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'AI06 evidence invalid';
   END IF;
   IF jsonb_array_length(p_payload->'runs')<>1 THEN RAISE EXCEPTION 'AI06 run invalid'; END IF;
   run=p_payload->'runs'->0;
   IF run->>'outcome' IS DISTINCT FROM 'UNRESOLVED' OR run->>'prompt' IS DISTINCT FROM 'website-job-gpt/1'
    OR run->>'bankSha256' IS DISTINCT FROM attempt.bank_sha256 OR run->>'ledgerSha256' IS DISTINCT FROM attempt.ledger_sha256
    OR jsonb_typeof(run->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'AI06 sources invalid'; END IF;
   IF jsonb_array_length(run->'items')>100 THEN RAISE EXCEPTION 'AI06 items invalid'; END IF;
   FOR item IN SELECT * FROM jsonb_array_elements(run->'items') LOOP
    IF item->>'outcome' IS DISTINCT FROM 'UNRESOLVED' OR item->>'type' IS NULL OR item->>'type' NOT IN ('SUGGESTION','ABSTENTION')
     OR item->'score' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'AI06 item invalid'; END IF;
   END LOOP;
   IF NOT EXISTS(SELECT 1 FROM fingence_gpt_website.audit e WHERE e.job_id=p_job AND e.action='START') THEN RAISE EXCEPTION 'AI06 admission missing'; END IF;
   INSERT INTO fingence_gpt_website.evidence(organization_id,member_id,job_id,payload) VALUES(a.organization_id,a.member_id,p_job,p_payload);
   value='true'::jsonb; event='SAVED';
  ELSE event=p_action; value='true'::jsonb;
  END IF;
 END IF;
 -- Same transaction as claim/save/read: audit failure prevents acknowledgement/payload.
 INSERT INTO fingence_gpt_website.audit(organization_id,member_id,job_id,action) VALUES(a.organization_id,a.member_id,p_job,event);
 RETURN jsonb_build_object('organizationId',a.organization_id,'memberId',a.member_id,'value',value);
END $$;
-- Explicit owner binding: existing auth/processing forced RLS is not changed. This
-- definer is a narrow authority boundary requiring owner review, not an app credential.
ALTER FUNCTION fingence_gpt_website.operate(text,uuid,text,jsonb) OWNER TO postgres;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fingence_gpt_website FROM PUBLIC,anon,authenticated,service_role,fingence_ai06_website_runtime;
GRANT USAGE ON SCHEMA fingence_gpt_website TO fingence_ai06_website_runtime;
GRANT EXECUTE ON FUNCTION fingence_gpt_website.operate(text,uuid,text,jsonb) TO fingence_ai06_website_runtime;
COMMIT;

-- REVIEW ONLY. Requires separate owner approval before any Production execution.
-- Human proposal decisions only. NO accounting, source-record or saved-result updates.
-- Requires the existing website-gpt/1 storage and workspace/ingestion/processing contracts.
BEGIN;
CREATE TABLE fingence_gpt_website.reviews(
 organization_id uuid NOT NULL,member_id uuid NOT NULL,job_id uuid NOT NULL,
 evidence_id text NOT NULL CHECK(evidence_id ~ '^[a-f0-9]{64}$'),ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 99),
 request_id uuid NOT NULL,decision text NOT NULL CHECK(decision IN ('APPROVE','REJECT')),
 outcome text NOT NULL DEFAULT 'UNRESOLVED' CHECK(outcome='UNRESOLVED'),
 bank_sha256 text NOT NULL,ledger_sha256 text NOT NULL,bank_id text NOT NULL,ledger_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,member_id,request_id),UNIQUE(organization_id,member_id,job_id,evidence_id,ordinal),
 FOREIGN KEY(organization_id,member_id,job_id) REFERENCES fingence_gpt_website.attempts(organization_id,member_id,job_id)
);
CREATE UNIQUE INDEX ai06_review_bank_once ON fingence_gpt_website.reviews(organization_id,member_id,bank_sha256,bank_id) WHERE decision='APPROVE';
CREATE UNIQUE INDEX ai06_review_ledger_once ON fingence_gpt_website.reviews(organization_id,member_id,ledger_sha256,ledger_id) WHERE decision='APPROVE';
CREATE TABLE fingence_gpt_website.review_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organization_id uuid NOT NULL,member_id uuid NOT NULL,job_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('READ','APPROVE','REJECT','REPLAY')),request_id uuid,ordinal integer,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,member_id,job_id) REFERENCES fingence_gpt_website.attempts(organization_id,member_id,job_id)
);
ALTER TABLE fingence_gpt_website.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_gpt_website.reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE fingence_gpt_website.review_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_gpt_website.review_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fingence_gpt_website.reviews,fingence_gpt_website.review_audit FROM PUBLIC,anon,authenticated,service_role,fingence_ai06_website_runtime;
REVOKE ALL ON SEQUENCE fingence_gpt_website.review_audit_id_seq FROM PUBLIC,anon,authenticated,service_role,fingence_ai06_website_runtime;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON fingence_gpt_website.reviews FOR EACH STATEMENT EXECUTE FUNCTION fingence_gpt_website.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON fingence_gpt_website.review_audit FOR EACH STATEMENT EXECUTE FUNCTION fingence_gpt_website.immutable();

CREATE FUNCTION fingence_gpt_website.review(p_token_hash text,p_job uuid,p_action text,p_payload jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 a record;j fingence_processing.jobs;e jsonb;r jsonb;i jsonb;v jsonb;prior fingence_gpt_website.reviews;
 b record;l record;pr jsonb;rid uuid;ord integer;event text;counted bigint;
BEGIN
 -- website-gpt-review/1: approval records a human decision; financial outcome remains UNRESOLVED.
 IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' OR p_action IS NULL OR p_action NOT IN ('READ','APPROVE','REJECT') THEN RAISE EXCEPTION 'AI06 request denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM fingence_workspace.actor(p_token_hash);
 IF NOT FOUND OR a.role NOT IN ('FINANCE','ADMIN','SUPERADMIN') THEN RAISE EXCEPTION 'AI06 session denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM fingence_workspace.members m WHERE m.id=a.member_id AND m.organization_id=a.organization_id AND m.active AND m.role=a.role FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI06 membership denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM fingence_workspace.sessions s WHERE s.id=a.session_id AND s.ended_at IS NULL AND s.expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI06 session ended' USING ERRCODE='42501'; END IF;
 -- Serializes every decision/replay for this job. Never held across model calls.
 SELECT * INTO j FROM fingence_processing.jobs WHERE id=p_job AND organization_id=a.organization_id::text AND member_id=a.member_id
  AND status='COMPLETED' AND outcome IN ('COMPLETED','COMPLETED_WITH_EXCEPTIONS') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI06 job denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM fingence_ingestion.runs WHERE id=j.ingestion_run_id AND organization_id=a.organization_id AND member_id=a.member_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI06 ingestion scope denied' USING ERRCODE='42501'; END IF;
 SELECT payload INTO e FROM fingence_gpt_website.evidence WHERE job_id=p_job AND organization_id=a.organization_id AND member_id=a.member_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI06 job denied' USING ERRCODE='42501'; END IF;
 r=e->'runs'->0;
 IF e->>'processingId' IS DISTINCT FROM j.processing_id OR r->>'outcome' IS DISTINCT FROM 'UNRESOLVED' THEN RAISE EXCEPTION 'AI06 review stale' USING ERRCODE='23505'; END IF;
 IF p_action='READ' THEN
  IF p_payload IS NOT NULL THEN RAISE EXCEPTION 'AI06 request denied' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('version','website-gpt-review/1','evidenceId',r->>'evidenceId','accountingEffect','NONE','items',coalesce(jsonb_agg(jsonb_build_object(
   'ordinal',(x->>'ordinal')::integer,'decision',coalesce(d.decision,'PENDING'),
   'canApprove',coalesce(d.decision IS NULL AND x->'verification'->>'proposalPolicy'='website-unexplained/1' AND x->'verification'->>'equalSignedCents'='true'
    AND x->'verification'->>'sameCurrency'='true' AND x->'verification'->>'dateWithinSevenDays'='true' AND x->'verification'->>'referenceAgreement'='true'
    AND x->'verification'->>'uniqueFinancialPartner'='true'
    AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['authoritativeRecordIds','pairTopology','uniqueSourceIdentities','finalUnexplained','distinctRoles','bankSourceIdentity','bankSourceFingerprint','bankEligibility','bankTransactionIdentity','bankMonetaryBasis','bankDateBasis','ledgerSourceIdentity','ledgerSourceFingerprint','ledgerEligibility','ledgerTransactionIdentity','ledgerMonetaryBasis','ledgerDateBasis','equalSignedCents','sameCurrency','sameDirection','dateWithinSevenDays','referenceAgreement','businessScope','authoritativeReferences','uniqueFinancialPartner','uniqueAssignment']) k WHERE x->'verification'->>k IS DISTINCT FROM 'true'),false),'canReject',d.decision IS NULL) ORDER BY (x->>'ordinal')::integer),'[]')) INTO v
   FROM jsonb_array_elements(r->'items') x LEFT JOIN fingence_gpt_website.reviews d ON d.organization_id=a.organization_id AND d.member_id=a.member_id
    AND d.job_id=p_job AND d.evidence_id=r->>'evidenceId' AND d.ordinal=(x->>'ordinal')::integer WHERE x->>'type'='SUGGESTION';
  event='READ';
 ELSE
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>1024
   OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k) IS DISTINCT FROM ARRAY['expectedEvidenceId','ordinal','requestId']
   OR p_payload->>'expectedEvidenceId' IS DISTINCT FROM r->>'evidenceId' THEN RAISE EXCEPTION 'AI06 review stale' USING ERRCODE='23505'; END IF;
  rid=(p_payload->>'requestId')::uuid;ord=(p_payload->>'ordinal')::integer;
  IF ord NOT BETWEEN 0 AND 99 THEN RAISE EXCEPTION 'AI06 request denied' USING ERRCODE='42501'; END IF;
  SELECT count(*) INTO counted FROM jsonb_array_elements(r->'items') x WHERE (x->>'ordinal')::integer=ord AND x->>'type'='SUGGESTION';
  IF counted<>1 THEN RAISE EXCEPTION 'AI06 request denied' USING ERRCODE='42501'; END IF;
  SELECT x INTO i FROM jsonb_array_elements(r->'items') x WHERE (x->>'ordinal')::integer=ord AND x->>'type'='SUGGESTION';
  SELECT * INTO prior FROM fingence_gpt_website.reviews WHERE organization_id=a.organization_id AND member_id=a.member_id AND request_id=rid;
  IF FOUND THEN
   IF prior.job_id<>p_job OR prior.evidence_id<>r->>'evidenceId' OR prior.ordinal<>ord OR prior.decision<>p_action THEN RAISE EXCEPTION 'AI06 review replay denied' USING ERRCODE='23505'; END IF;
   event='REPLAY';
  ELSE
   IF p_action='APPROVE' THEN
    IF i->'verification'->>'proposalPolicy' IS DISTINCT FROM 'website-unexplained/1'
     OR jsonb_typeof(i->'verification') IS DISTINCT FROM 'object'
     OR EXISTS(SELECT 1 FROM unnest(ARRAY['authoritativeRecordIds','pairTopology','uniqueSourceIdentities','finalUnexplained','distinctRoles','bankSourceIdentity','bankSourceFingerprint','bankEligibility','bankTransactionIdentity','bankMonetaryBasis','bankDateBasis','ledgerSourceIdentity','ledgerSourceFingerprint','ledgerEligibility','ledgerTransactionIdentity','ledgerMonetaryBasis','ledgerDateBasis','equalSignedCents','sameCurrency','sameDirection','dateWithinSevenDays','referenceAgreement','businessScope','authoritativeReferences','uniqueFinancialPartner','uniqueAssignment']) k WHERE i->'verification'->>k IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'AI06 review denied' USING ERRCODE='42501'; END IF;
    SELECT q.* INTO b FROM fingence_ingestion.records q JOIN fingence_ingestion.documents d ON d.id=q.document_id
     WHERE d.run_id=j.ingestion_run_id AND d.role='BANK_STATEMENT' AND d.decision='AUTO_ACCEPTED' AND d.file_sha256=r->>'bankSha256' AND q.record_id=i->>'bankId';
    IF NOT FOUND THEN RAISE EXCEPTION 'AI06 review denied' USING ERRCODE='42501'; END IF;
    SELECT count(*) INTO counted FROM fingence_ingestion.records q JOIN fingence_ingestion.documents d ON d.id=q.document_id WHERE d.run_id=j.ingestion_run_id AND d.role='BANK_STATEMENT' AND q.record_id=i->>'bankId';
    IF counted<>1 THEN RAISE EXCEPTION 'AI06 review denied' USING ERRCODE='42501'; END IF;
    SELECT q.* INTO l FROM fingence_ingestion.records q JOIN fingence_ingestion.documents d ON d.id=q.document_id
     WHERE d.run_id=j.ingestion_run_id AND d.role='GENERAL_LEDGER' AND d.decision='AUTO_ACCEPTED' AND d.file_sha256=r->>'ledgerSha256' AND q.record_id=i->>'ledgerId';
    IF NOT FOUND THEN RAISE EXCEPTION 'AI06 review denied' USING ERRCODE='42501'; END IF;
    SELECT count(*) INTO counted FROM fingence_ingestion.records q JOIN fingence_ingestion.documents d ON d.id=q.document_id WHERE d.run_id=j.ingestion_run_id AND d.role='GENERAL_LEDGER' AND q.record_id=i->>'ledgerId';
    IF counted<>1 OR b.signed_cents=0 OR b.signed_cents<>l.signed_cents OR b.currency<>l.currency OR b.business_id<>l.business_id OR abs(b.transaction_date-l.transaction_date)>2
     OR nullif(btrim(normalize(b.reference)),'') IS NULL OR btrim(normalize(b.reference)) IS DISTINCT FROM btrim(normalize(l.reference))
     OR i->>'bankReference' IS DISTINCT FROM b.reference OR i->>'ledgerReference' IS DISTINCT FROM l.reference THEN RAISE EXCEPTION 'AI06 review denied' USING ERRCODE='42501'; END IF;
    IF EXISTS(SELECT 1 FROM fingence_ingestion.records q JOIN fingence_ingestion.documents d ON d.id=q.document_id WHERE d.run_id=j.ingestion_run_id
      AND ((d.role='BANK_STATEMENT' AND q.record_id<>b.record_id AND abs(q.transaction_date-l.transaction_date)<=2)
       OR (d.role='GENERAL_LEDGER' AND q.record_id<>l.record_id AND abs(q.transaction_date-b.transaction_date)<=2))
      AND q.currency=b.currency AND q.signed_cents=b.signed_cents) THEN RAISE EXCEPTION 'AI06 review denied' USING ERRCODE='42501'; END IF;
    SELECT reconciliation INTO pr FROM fingence_processing.results WHERE job_id=p_job;
    IF pr->>'version' IS DISTINCT FROM 'fingence-reconciliation-layer-v1' OR pr->'scope'->>'businessId' IS DISTINCT FROM b.business_id
     OR pr->>'origin' IS DISTINCT FROM 'DETERMINISTIC_RULES' OR pr->>'status'='CHECKS_FAILED'
     OR pr->'sources'->'bank'->>'sha256' IS DISTINCT FROM r->>'bankSha256' OR pr->'sources'->'ledger'->>'sha256' IS DISTINCT FROM r->>'ledgerSha256'
     OR coalesce(jsonb_array_length(pr->'checks'),0)=0
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(pr->'checks') c WHERE c->>'passed' IS DISTINCT FROM 'true')
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(pr->'periods') p,jsonb_array_elements(p->'checks') c WHERE c->>'passed' IS DISTINCT FROM 'true')
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pr->'periods') p,jsonb_array_elements(p->'items') x WHERE x->>'resolution'='UNEXPLAINED' AND x->>'bankRecordId'=b.record_id)
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pr->'periods') p,jsonb_array_elements(p->'items') x WHERE x->>'resolution'='UNEXPLAINED' AND x->'ledgerRecordIds' ? l.record_id)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(pr->'periods') p,jsonb_array_elements(p->'items') x WHERE x->>'resolution'<>'UNEXPLAINED' AND
      (x->>'bankRecordId'=b.record_id OR x->'ledgerRecordIds' ? l.record_id OR x->'link'->>'recordId' IN (b.record_id,l.record_id)))
     OR (SELECT count(*) FROM jsonb_array_elements(pr->'periods') p,jsonb_array_elements(p->'items') x WHERE x->>'bankRecordId'=b.record_id)<>1
     OR (SELECT count(*) FROM jsonb_array_elements(pr->'periods') p,jsonb_array_elements(p->'items') x WHERE x->'ledgerRecordIds' ? l.record_id)<>1
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(pr->'periods') p,jsonb_array_elements(p->'items') x WHERE
      (x->>'bankRecordId'=b.record_id OR x->'ledgerRecordIds' ? l.record_id) AND
      (x->'link' IS DISTINCT FROM 'null'::jsonb OR x->'entryIds' IS DISTINCT FROM '[]'::jsonb OR jsonb_array_length(x->'ledgerRecordIds')>1))
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(pr->'entries') x WHERE x->'sourceRecordIds' ?| ARRAY[b.record_id,l.record_id]) THEN RAISE EXCEPTION 'AI06 review denied' USING ERRCODE='42501'; END IF;
   END IF;
   INSERT INTO fingence_gpt_website.reviews(organization_id,member_id,job_id,evidence_id,ordinal,request_id,decision,bank_sha256,ledger_sha256,bank_id,ledger_id)
    VALUES(a.organization_id,a.member_id,p_job,r->>'evidenceId',ord,rid,p_action,r->>'bankSha256',r->>'ledgerSha256',i->>'bankId',i->>'ledgerId');
   event=p_action;
  END IF;
  v=jsonb_build_object('version','website-gpt-review/1','ordinal',ord,'decision',p_action,'financialOutcome','UNRESOLVED','accountingEffect','NONE');
 END IF;
 INSERT INTO fingence_gpt_website.review_audit(organization_id,member_id,job_id,action,request_id,ordinal) VALUES(a.organization_id,a.member_id,p_job,event,rid,ord);
 RETURN jsonb_build_object('organizationId',a.organization_id,'memberId',a.member_id,'value',v);
END $$;
ALTER FUNCTION fingence_gpt_website.review(text,uuid,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION fingence_gpt_website.review(text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION fingence_gpt_website.review(text,uuid,text,jsonb) TO fingence_ai06_website_runtime;
COMMIT;

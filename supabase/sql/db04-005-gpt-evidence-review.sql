-- REVIEW ONLY. Do not execute without separate database approval.
-- Apply after db04-001 through db04-004, under the migration owner, never runtime.
BEGIN;
CREATE TABLE fingence_reconciliation.gpt_runs (
 organization_id uuid NOT NULL, processing_id text NOT NULL,
 evidence_id text NOT NULL CHECK(evidence_id ~ '^[a-f0-9]{64}$'),
 bank_kind text NOT NULL DEFAULT 'BANK' CHECK(bank_kind='BANK'),
 ledger_kind text NOT NULL DEFAULT 'LEDGER' CHECK(ledger_kind='LEDGER'),
 bank_sha256 text NOT NULL, ledger_sha256 text NOT NULL CHECK(bank_sha256<>ledger_sha256),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 model_version text NOT NULL CHECK(model_version='openai/gpt-oss-120b'),
 prompt_version text NOT NULL CHECK(prompt_version='db04-gpt-prompt/1'),
 schema_version text NOT NULL CHECK(schema_version='llm-reconciliation-suggestion/1'),
 proposal_version text NOT NULL CHECK(proposal_version='db04-gpt-proposals/1'),
 verification_policy text NOT NULL CHECK(verification_policy='db04-independent-proposals/1'),
 financial_policy text NOT NULL CHECK(financial_policy IN ('synthetic-cash-same-day/1','synthetic-cash-two-day/1')),
 source_fingerprint text NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'),
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 proposal_fingerprint text NOT NULL CHECK(proposal_fingerprint ~ '^[a-f0-9]{64}$'),
 verification_fingerprint text NOT NULL CHECK(verification_fingerprint ~ '^[a-f0-9]{64}$'),
 outcome text NOT NULL DEFAULT 'UNRESOLVED' CHECK(outcome='UNRESOLVED'),
 suggestion_count integer NOT NULL CHECK(suggestion_count BETWEEN 0 AND 20),
 abstention_count integer NOT NULL CHECK(abstention_count BETWEEN 0 AND 50),
 PRIMARY KEY(organization_id,processing_id,evidence_id),
 UNIQUE(organization_id,processing_id,model_version,prompt_version,schema_version,source_fingerprint,request_fingerprint,proposal_fingerprint,verification_fingerprint),
 FOREIGN KEY(organization_id,processing_id) REFERENCES fingence_reconciliation.jobs,
 FOREIGN KEY(created_by,organization_id) REFERENCES fingence_m2.memberships(user_id,organization_id),
 FOREIGN KEY(organization_id,processing_id,bank_sha256,bank_kind) REFERENCES fingence_reconciliation.job_sources(organization_id,processing_id,sha256,kind),
 FOREIGN KEY(organization_id,processing_id,ledger_sha256,ledger_kind) REFERENCES fingence_reconciliation.job_sources(organization_id,processing_id,sha256,kind)
);
CREATE TABLE fingence_reconciliation.gpt_items (
 organization_id uuid NOT NULL, processing_id text NOT NULL, evidence_id text NOT NULL,
 item_type text NOT NULL CHECK(item_type IN ('SUGGESTION','ABSTENTION')),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 49),
 bank_kind text NOT NULL DEFAULT 'BANK' CHECK(bank_kind='BANK'),
 ledger_kind text NOT NULL DEFAULT 'LEDGER' CHECK(ledger_kind='LEDGER'),
 bank_claim text, ledger_claim text, record_claim text,
 bank_record_id text, ledger_record_id text, abstention_kind text CHECK(abstention_kind IN ('BANK','LEDGER')), abstention_record_id text,
 explanation text NOT NULL CHECK(length(btrim(explanation)) BETWEEN 1 AND 512),
 outcome text NOT NULL DEFAULT 'UNRESOLVED' CHECK(outcome='UNRESOLVED'),
 reasons jsonb NOT NULL CHECK(jsonb_typeof(reasons)='array' AND jsonb_array_length(reasons) BETWEEN 1 AND 64),
 verification jsonb NOT NULL CHECK(jsonb_typeof(verification)='object' AND octet_length(verification::text)<=16384),
 CHECK(verification - ARRAY['checks','identity','conflicts','rankingLineage','financialEligible','referenceClaims','uniqueEligiblePartner']='{}'::jsonb),
 CHECK(reasons @> '["ASSIGNMENT_POLICY_NOT_APPROVED"]'::jsonb),
 CHECK(NOT jsonb_path_exists(reasons,'$[*] ? (@.type() != "string")')),
 CHECK(item_type<>'SUGGESTION' OR verification ?& ARRAY['checks','identity','conflicts','rankingLineage','financialEligible','referenceClaims','uniqueEligiblePartner']),
 CHECK(item_type<>'ABSTENTION' OR verification='{}'::jsonb),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,processing_id,evidence_id,item_type,ordinal),
 CHECK((item_type='SUGGESTION' AND ordinal<20 AND bank_claim IS NOT NULL AND ledger_claim IS NOT NULL AND record_claim IS NULL AND abstention_kind IS NULL AND abstention_record_id IS NULL)
 OR (item_type='ABSTENTION' AND bank_claim IS NULL AND ledger_claim IS NULL AND bank_record_id IS NULL AND ledger_record_id IS NULL AND record_claim IS NOT NULL AND abstention_kind IS NOT NULL AND abstention_record_id IS NOT NULL)),
 CHECK(bank_claim IS NULL OR length(bank_claim) BETWEEN 1 AND 128),
 CHECK(ledger_claim IS NULL OR length(ledger_claim) BETWEEN 1 AND 128),
 CHECK(record_claim IS NULL OR length(record_claim) BETWEEN 1 AND 128),
 CHECK(bank_record_id IS NULL OR bank_record_id=bank_claim),
 CHECK(ledger_record_id IS NULL OR ledger_record_id=ledger_claim),
 CHECK(abstention_record_id IS NULL OR abstention_record_id=record_claim),
 FOREIGN KEY(organization_id,processing_id,evidence_id) REFERENCES fingence_reconciliation.gpt_runs,
 FOREIGN KEY(organization_id,processing_id,bank_kind,bank_record_id) REFERENCES fingence_reconciliation.transactions(organization_id,processing_id,kind,record_id),
 FOREIGN KEY(organization_id,processing_id,ledger_kind,ledger_record_id) REFERENCES fingence_reconciliation.transactions(organization_id,processing_id,kind,record_id),
 FOREIGN KEY(organization_id,processing_id,abstention_kind,abstention_record_id) REFERENCES fingence_reconciliation.transactions(organization_id,processing_id,kind,record_id)
);
-- Completion check runs at commit, allowing atomic parent + ordered children insertion.
CREATE FUNCTION fingence_reconciliation.gpt_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE r record; n integer; m integer; top integer;
BEGIN
 SELECT * INTO STRICT r FROM fingence_reconciliation.gpt_runs
 WHERE organization_id=NEW.organization_id AND processing_id=NEW.processing_id AND evidence_id=NEW.evidence_id;
 SELECT count(*) FILTER(WHERE item_type='SUGGESTION'),count(*) FILTER(WHERE item_type='ABSTENTION') INTO n,m
 FROM fingence_reconciliation.gpt_items WHERE organization_id=r.organization_id AND processing_id=r.processing_id AND evidence_id=r.evidence_id;
 IF n<>r.suggestion_count OR m<>r.abstention_count THEN RAISE EXCEPTION 'GPT_INCOMPLETE_EVIDENCE' USING ERRCODE='23514'; END IF;
 SELECT max(ordinal) INTO top FROM fingence_reconciliation.gpt_items WHERE organization_id=r.organization_id AND processing_id=r.processing_id AND evidence_id=r.evidence_id AND item_type='SUGGESTION';
 IF n>0 AND top<>n-1 THEN RAISE EXCEPTION 'GPT_ORDINAL_GAP' USING ERRCODE='23514'; END IF;
 SELECT max(ordinal) INTO top FROM fingence_reconciliation.gpt_items WHERE organization_id=r.organization_id AND processing_id=r.processing_id AND evidence_id=r.evidence_id AND item_type='ABSTENTION';
 IF m>0 AND top<>m-1 THEN RAISE EXCEPTION 'GPT_ORDINAL_GAP' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
-- SECURITY INVOKER: audit denial aborts the entire insert/transaction; no elevated bypass.
CREATE FUNCTION fingence_reconciliation.gpt_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 INSERT INTO fingence_reconciliation.audit(organization_id,processing_id,actor_id,action)
 VALUES(NEW.organization_id,NEW.processing_id,NEW.created_by,'PERSISTED');
 RETURN NULL;
END $$;
CREATE TRIGGER gpt_run_audit AFTER INSERT ON fingence_reconciliation.gpt_runs FOR EACH ROW EXECUTE FUNCTION fingence_reconciliation.gpt_audit();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['gpt_runs','gpt_items'] LOOP
  EXECUTE format('ALTER TABLE fingence_reconciliation.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE fingence_reconciliation.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY organization_scope ON fingence_reconciliation.%I USING(organization_id=fingence_reconciliation.authorized_organization()) WITH CHECK(organization_id=fingence_reconciliation.authorized_organization())',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fingence_reconciliation.%I FOR EACH ROW EXECUTE FUNCTION fingence_reconciliation.immutable()',t);
  EXECUTE format('CREATE CONSTRAINT TRIGGER gpt_complete AFTER INSERT ON fingence_reconciliation.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fingence_reconciliation.gpt_complete()',t);
 END LOOP;
END $$;
CREATE POLICY actor_binding ON fingence_reconciliation.gpt_runs AS RESTRICTIVE FOR INSERT
 WITH CHECK(created_by=(SELECT user_id FROM fingence_reconciliation.principal()));
REVOKE ALL ON fingence_reconciliation.gpt_runs,fingence_reconciliation.gpt_items FROM PUBLIC;
REVOKE ALL ON FUNCTION fingence_reconciliation.gpt_complete(),fingence_reconciliation.gpt_audit() FROM PUBLIC;
-- Managed default ACLs may grant roles directly, independently of PUBLIC.
-- Seal only these new objects; never change global defaults or existing ACLs.
DO $$ DECLARE t text; g record; BEGIN
 FOREACH t IN ARRAY ARRAY['gpt_runs','gpt_items'] LOOP
  FOR g IN SELECT DISTINCT pg_get_userbyid(a.grantee) AS role_name
   FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE c.oid=format('fingence_reconciliation.%I',t)::regclass AND a.grantee<>0 AND a.grantee<>c.relowner LOOP
   EXECUTE format('REVOKE ALL ON TABLE fingence_reconciliation.%I FROM %I',t,g.role_name);
  END LOOP;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['gpt_complete','gpt_audit'] LOOP
  FOR g IN SELECT DISTINCT pg_get_userbyid(a.grantee) AS role_name
   FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
   WHERE p.oid=format('fingence_reconciliation.%I()',t)::regprocedure AND a.grantee<>0 AND a.grantee<>p.proowner LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION fingence_reconciliation.%I() FROM %I',t,g.role_name);
  END LOOP;
 END LOOP;
END $$;
GRANT SELECT,INSERT ON fingence_reconciliation.gpt_runs,fingence_reconciliation.gpt_items TO fingence_reconciliation_runtime;
COMMIT;

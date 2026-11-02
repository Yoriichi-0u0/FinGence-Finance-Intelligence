-- PROPOSAL ONLY. No hosted execution or automatic account mapping authorized.
-- Minimal FK compatibility namespaces; NOT the local password/auth/V2 bootstrap.
-- Target personal FYP A fhipzomczevbpybezzxu. Jason must approve authority/SLA first.
BEGIN;
CREATE ROLE fingence_identity_broker NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE SCHEMA fingence_m2;
CREATE SCHEMA fingence_m3;
REVOKE ALL ON SCHEMA fingence_m2,fingence_m3 FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE fingence_m2.organizations(id uuid PRIMARY KEY,name text NOT NULL);
CREATE TABLE fingence_m2.users(
 id uuid PRIMARY KEY,issuer text NOT NULL CHECK(issuer='https://fhipzomczevbpybezzxu.supabase.co/auth/v1'),
 subject uuid NOT NULL,suspended boolean NOT NULL DEFAULT false,UNIQUE(issuer,subject));
CREATE TABLE fingence_m2.memberships(
 user_id uuid REFERENCES fingence_m2.users,organization_id uuid REFERENCES fingence_m2.organizations,
 role text NOT NULL CHECK(role IN ('Finance','Technical (Management)','Admin')),
 active boolean NOT NULL DEFAULT true,version integer NOT NULL CHECK(version>0),
 PRIMARY KEY(user_id,organization_id));
CREATE TABLE fingence_m3.organization_states(
 organization_id uuid PRIMARY KEY REFERENCES fingence_m2.organizations,active boolean NOT NULL);
CREATE TABLE fingence_m2.sessions(
 id uuid NOT NULL UNIQUE,token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid NOT NULL,organization_id uuid NOT NULL,upstream_session_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,revoked boolean NOT NULL DEFAULT false,
 membership_version integer NOT NULL,contract_version text NOT NULL CHECK(contract_version='hosted-finance-admission/1'),
 FOREIGN KEY(user_id,organization_id) REFERENCES fingence_m2.memberships,
 UNIQUE(id,user_id,organization_id));
-- No email/password, auth.users trigger, invented membership or default tenant.
ALTER TABLE fingence_m2.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_m2.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_m2.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_m2.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_m3.organization_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_m2,fingence_m3 FROM PUBLIC,anon,authenticated,service_role;
-- Serialize membership insertion/deletion with admission's locked subject, too:
-- row locks on existing memberships alone cannot prevent a phantom new tenant.
CREATE FUNCTION fingence_m2.membership_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM id FROM fingence_m2.users WHERE id=NEW.user_id FOR UPDATE;
 ELSIF TG_OP='DELETE' THEN
  PERFORM id FROM fingence_m2.users WHERE id=OLD.user_id FOR UPDATE;
 ELSE
  PERFORM id FROM fingence_m2.users WHERE id IN (OLD.user_id,NEW.user_id) ORDER BY id FOR UPDATE;
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.active IS DISTINCT FROM OLD.active THEN NEW.version=OLD.version+1;
  ELSIF NEW.version<OLD.version THEN RAISE EXCEPTION 'membership version cannot decrease' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION fingence_m2.membership_lifecycle() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER membership_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON fingence_m2.memberships
 FOR EACH ROW EXECUTE FUNCTION fingence_m2.membership_lifecycle();

-- Only the trusted server broker may issue short-lived opaque capabilities AFTER
-- cryptographic identity AND authoritative session-lifecycle verification.
CREATE FUNCTION fingence_m2.issue_hosted_grant(hash text,lease_id uuid,iss text,sub uuid,sid uuid,deadline timestamptz)
RETURNS TABLE(user_id uuid,organization_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u record;m record;
BEGIN
 IF iss<>'https://fhipzomczevbpybezzxu.supabase.co/auth/v1'
  OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '30 seconds'
  OR hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO u FROM fingence_m2.users x WHERE x.issuer=iss AND x.subject=sub AND NOT x.suspended FOR SHARE;
 IF u.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 -- More than one eligible membership is ambiguous: no browser-selected tenant.
 IF (SELECT count(*) FROM fingence_m2.memberships x JOIN fingence_m3.organization_states o USING(organization_id)
  WHERE x.user_id=u.id AND x.role='Finance' AND x.active AND o.active)<>1 THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT x.* INTO m FROM fingence_m2.memberships x JOIN fingence_m3.organization_states o USING(organization_id)
  WHERE x.user_id=u.id AND x.role='Finance' AND x.active AND o.active FOR SHARE OF x,o;
 IF m.user_id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 INSERT INTO fingence_m2.sessions VALUES(lease_id,hash,u.id,m.organization_id,sid,deadline,false,m.version,'hosted-finance-admission/1');
 RETURN QUERY SELECT u.id::uuid,m.organization_id::uuid;
END $$;
CREATE FUNCTION fingence_m2.revoke_hosted_grant(hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE fingence_m2.sessions SET revoked=true WHERE token_hash=hash;
$$;
REVOKE ALL ON FUNCTION fingence_m2.issue_hosted_grant(text,uuid,text,uuid,uuid,timestamptz),fingence_m2.revoke_hosted_grant(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA fingence_m2 TO fingence_identity_broker;
GRANT EXECUTE ON FUNCTION fingence_m2.issue_hosted_grant(text,uuid,text,uuid,uuid,timestamptz),fingence_m2.revoke_hosted_grant(text) TO fingence_identity_broker;
COMMIT;

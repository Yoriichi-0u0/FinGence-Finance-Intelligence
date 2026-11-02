-- Approval required. Synthetic identities only, not Supabase Auth users.
BEGIN;
CREATE ROLE db04_dev_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 4 IN ROLE fingence_reconciliation_runtime;
CREATE ROLE db04_dev_broker_login LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2 IN ROLE fingence_db04_dev_broker;
INSERT INTO fingence_db04_dev_identity.organizations VALUES
 ('00000000-0000-4000-8000-000000000001','DB04 synthetic development'),
 ('00000000-0000-4000-8000-000000000002','DB04 isolation negative test');
INSERT INTO fingence_db04_dev_identity.organization_states VALUES
 ('00000000-0000-4000-8000-000000000001',true),('00000000-0000-4000-8000-000000000002',true);
INSERT INTO fingence_db04_dev_identity.users(id,issuer,subject) VALUES
 ('00000000-0000-4000-8000-000000000003','https://fhipzomczevbpybezzxu.supabase.co/auth/v1','00000000-0000-4000-8000-000000000005'),
 ('00000000-0000-4000-8000-000000000004','https://fhipzomczevbpybezzxu.supabase.co/auth/v1','00000000-0000-4000-8000-000000000006');
INSERT INTO fingence_db04_dev_identity.memberships VALUES
 ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','Finance',true,1),
 ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','Finance',true,1);
COMMIT;
-- Passwords require separately approved private masked provisioning; no literals.

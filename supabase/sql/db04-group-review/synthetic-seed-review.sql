-- REVIEW ONLY: synthetic fixtures and disabled test logins, not Production users.
-- Separate approval and private password/LOGIN provisioning required before hosted testing.
BEGIN;
CREATE ROLE db04_group_test_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 4 IN ROLE fingence_db04_group_runtime;
CREATE ROLE db04_group_test_broker NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2 IN ROLE fingence_db04_group_broker;
INSERT INTO fingence_db04_group_synthetic.organizations VALUES
 ('00000000-0000-4000-8000-000000000001','DB04 synthetic development'),
 ('00000000-0000-4000-8000-000000000002','DB04 isolation negative test');
INSERT INTO fingence_db04_group_synthetic.organization_states VALUES
 ('00000000-0000-4000-8000-000000000001',true),('00000000-0000-4000-8000-000000000002',true);
INSERT INTO fingence_db04_group_synthetic.users(id,issuer,subject) VALUES
 ('00000000-0000-4000-8000-000000000003','urn:fingence:db04:group-synthetic:1','00000000-0000-4000-8000-000000000005'),
 ('00000000-0000-4000-8000-000000000004','urn:fingence:db04:group-synthetic:1','00000000-0000-4000-8000-000000000006');
INSERT INTO fingence_db04_group_synthetic.memberships VALUES
 ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','Finance',true,1),
 ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','Finance',true,1);
COMMIT;

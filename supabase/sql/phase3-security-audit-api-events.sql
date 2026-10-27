-- Extend the audit action allowlist for transaction API events.
-- Requires phase3-security-audit-upgrade.sql to have been applied first.
BEGIN;
ALTER TABLE public.security_audit_events
  DROP CONSTRAINT IF EXISTS security_audit_events_action_check;
ALTER TABLE public.security_audit_events
  ADD CONSTRAINT security_audit_events_action_check CHECK (action IN (
    'auth.sign_in', 'auth.sign_in_failed', 'ingestion.upload_attempt',
    'ingestion.validation_completed', 'ingestion.persisted', 'ingestion.rejected',
    'persistence_attempt.created', 'persistence_attempt.investigated',
    'transactions.list', 'transaction.read', 'batch.read',
    'financial_record.read', 'financial_record.changed', 'financial_record.reconciled',
    'rejected_evidence.read', 'report.generated', 'report.read', 'report.downloaded',
    'dashboard.read', 'security_logs.read', 'authorization.role_changed',
    'authorization.denied', 'admin.exceptional_access', 'admin.configuration_changed',
    'request.rate_limited'
  ));
ALTER TABLE public.security_audit_events
  DROP CONSTRAINT IF EXISTS security_audit_events_target_type_check;
ALTER TABLE public.security_audit_events
  ADD CONSTRAINT security_audit_events_target_type_check CHECK (target_type IS NULL OR target_type IN (
    'ingestion_batch', 'transaction_collection', 'persistence_attempt', 'financial_record',
    'rejected_evidence', 'report', 'organization_user', 'organization_settings',
    'security_log', 'auth_session'
  ));
COMMIT;

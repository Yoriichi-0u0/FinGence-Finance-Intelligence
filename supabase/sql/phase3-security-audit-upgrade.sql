-- Additive, server-only storage for the allowlisted security audit events.
-- Apply after the Phase 1 source-file foundation. Hosted execution requires separate approval.
BEGIN;
CREATE TABLE public.security_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  actor_id text,
  organization_id text,
  action text NOT NULL CHECK (action IN (
    'auth.sign_in', 'auth.sign_in_failed', 'ingestion.upload_attempt',
    'ingestion.validation_completed', 'ingestion.persisted', 'ingestion.rejected',
    'persistence_attempt.created', 'persistence_attempt.investigated',
    'financial_record.read', 'financial_record.changed', 'financial_record.reconciled',
    'rejected_evidence.read', 'report.generated', 'report.read', 'report.downloaded',
    'dashboard.read', 'security_logs.read', 'authorization.role_changed',
    'authorization.denied', 'admin.exceptional_access', 'admin.configuration_changed',
    'request.rate_limited'
  )),
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  target_type text CHECK (target_type IS NULL OR target_type IN (
    'ingestion_batch', 'persistence_attempt', 'financial_record', 'rejected_evidence',
    'report', 'organization_user', 'organization_settings', 'security_log', 'auth_session'
  )),
  target_id text,
  request_id text,
  approval_id text,
  attempt_outcome text CHECK (attempt_outcome IS NULL OR attempt_outcome IN (
    'CONFIRMED_COMMITTED', 'CONFIRMED_NOT_COMMITTED', 'UNRESOLVED'
  )),
  CHECK ((target_type IS NULL) = (target_id IS NULL)),
  CHECK ((action = 'persistence_attempt.investigated') = (attempt_outcome IS NOT NULL)),
  CHECK (action <> 'persistence_attempt.created' OR target_type = 'persistence_attempt')
);
CREATE INDEX security_audit_events_time_idx
  ON public.security_audit_events (occurred_at DESC, id DESC);
CREATE INDEX security_audit_events_org_time_idx
  ON public.security_audit_events (organization_id, occurred_at DESC, id DESC)
  WHERE organization_id IS NOT NULL;
ALTER TABLE public.security_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_audit_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.security_audit_events_id_seq FROM PUBLIC, anon, authenticated;
COMMIT;
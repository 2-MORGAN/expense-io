-- Up Migration
-- Analyses de reçus (OCR asynchrone, ADR-003 §2). La file est la table
-- `outbox_events` du socle commun (migration 1792684368830, 2-484).
CREATE TABLE receipt_analyses (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  receipt_key text NOT NULL,
  mime_type text NOT NULL,
  fingerprint text NOT NULL,
  idempotency_key uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  result jsonb,
  error_code text,
  receipt_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX receipt_analyses_pending_idx ON receipt_analyses (created_at) WHERE status IN ('queued', 'running');
ALTER TABLE receipt_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_analyses FORCE ROW LEVEL SECURITY;
CREATE POLICY receipt_analysis_owner ON receipt_analyses
  USING (
    user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    AND company_id = (SELECT company_id FROM users WHERE id = user_id)
  )
  WITH CHECK (
    user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    AND company_id = (SELECT company_id FROM users WHERE id = user_id)
  );

-- Down Migration
DROP TABLE receipt_analyses;

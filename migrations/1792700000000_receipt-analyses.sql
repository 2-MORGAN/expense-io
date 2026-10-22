-- Up Migration
-- Contrat commun ADR-003 : cette outbox peut accueillir les notifications de 2-484.
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_due_idx ON outbox_events (type, next_attempt_at) WHERE status = 'pending';

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
DROP TABLE outbox_events;

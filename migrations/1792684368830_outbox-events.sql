-- Up Migration
-- Outbox transactionnelle (ADR-003 §5) : l'événement est inséré dans la même
-- transaction que la note ou la décision, puis consommé par le worker
-- (`npm run worker`).
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'dead')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbox_events_due_idx ON outbox_events (next_attempt_at) WHERE status = 'pending';

-- ADR-001, point de coordination avec l'ADR-003 : l'application n'a que
-- l'INSERT, dans l'entreprise de l'utilisateur courant. Le rôle du worker
-- arrive avec la bascule de connexion (2-481).
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;

CREATE POLICY outbox_events_insert_own_company ON outbox_events
  FOR INSERT
  WITH CHECK (
    company_id = (
      SELECT company_id FROM users
      WHERE id = nullif(current_setting('app.current_user_id', true), '')::uuid
    )
  );

-- Down Migration
DROP TABLE outbox_events;

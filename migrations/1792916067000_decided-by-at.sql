-- Up Migration
-- Traçabilité de la décision (B16) : qui a tranché la note et quand.
-- Interne uniquement : non exposé dans le JSON des routes approve/reject
-- (non-régression E2E). NULL tant que la note est en attente.
ALTER TABLE expense_notes
  ADD COLUMN decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN decided_at timestamptz;

-- Down Migration
ALTER TABLE expense_notes DROP COLUMN decided_at;
ALTER TABLE expense_notes DROP COLUMN decided_by;

-- Up Migration
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email_domain text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL DEFAULT '',
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'manager', 'hr_admin')),
  manager_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE expense_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Compteur de reçu séquentiel, utilisé pour nommer le fichier dans le
  -- stockage objet (src/lib/storage.ts) plutôt que l'UUID de la note.
  receipt_seq serial,
  user_id uuid NOT NULL REFERENCES users(id),
  amount numeric(10, 2) NOT NULL,
  expense_date date NOT NULL,
  description text NOT NULL,
  receipt_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Isolation appliquée par PostgreSQL (Row Level Security) — voir
-- src/lib/db.ts pour le contexte de session (`app.current_user_id`) que ces
-- policies utilisent.
ALTER TABLE expense_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_notes FORCE ROW LEVEL SECURITY;

CREATE POLICY expense_notes_owner_select ON expense_notes
  FOR SELECT
  USING (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY expense_notes_owner_insert ON expense_notes
  FOR INSERT
  WITH CHECK (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY expense_notes_manager_select ON expense_notes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = expense_notes.user_id
        AND u.manager_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY expense_notes_manager_update ON expense_notes
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = expense_notes.user_id
        AND u.manager_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY expense_notes_hr_root_manager_select ON expense_notes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = expense_notes.user_id
        AND u.role = 'manager'
        AND u.manager_id IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM users hr
      WHERE hr.id = nullif(current_setting('app.current_user_id', true), '')::uuid
        AND hr.role = 'hr_admin'
    )
  );

CREATE POLICY expense_notes_hr_root_manager_update ON expense_notes
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = expense_notes.user_id
        AND u.role = 'manager'
        AND u.manager_id IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM users hr
      WHERE hr.id = nullif(current_setting('app.current_user_id', true), '')::uuid
        AND hr.role = 'hr_admin'
    )
  );

-- Down Migration
DROP TABLE expense_notes;
DROP TABLE users;
DROP TABLE companies;

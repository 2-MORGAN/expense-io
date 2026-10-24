-- Up Migration
-- Isolation par la base (ADR-001 §2 et annexe B, 2-478) : rôle applicatif
-- restreint, policies bornées par l'entreprise, RLS sur `users`, fonctions
-- d'authentification et d'inscription à surface étroite. La connexion de
-- l'application ne change pas ici : `DATABASE_URL` passe sur `expense_app`
-- avec 2-481 (login, mot de passe, contrôle du rôle au démarrage).
--
-- Contexte de session posé par `withUserScope` (src/lib/db.ts), toujours lu
-- en base depuis la ligne de l'utilisateur : `app.current_user_id`,
-- `app.current_company_id`, `app.current_role`. Les policies le lisent dans
-- une sous-requête `(SELECT …)`, évaluée une fois par requête.

-- Rôles (globaux au cluster, d'où la création idempotente).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'expense_app') THEN
    CREATE ROLE expense_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'expense_definer') THEN
    CREATE ROLE expense_definer NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Droits de l'application : le minimum lu dans ses requêtes. Aucun droit sur
-- `companies` (l'inscription passe par `register_user`), ni sur
-- `users.password_hash` (la connexion passe par `auth_find_user`). Une table
-- future n'ouvre aucun droit tant que sa migration ne le donne pas.
GRANT SELECT, INSERT ON expense_notes TO expense_app;
GRANT UPDATE (status) ON expense_notes TO expense_app;
GRANT USAGE ON SEQUENCE expense_notes_receipt_seq_seq TO expense_app;
GRANT SELECT (id, company_id, name, email, role, manager_id, created_at) ON users TO expense_app;
GRANT UPDATE (manager_id) ON users TO expense_app;
GRANT INSERT ON outbox_events TO expense_app;
GRANT SELECT, INSERT, UPDATE ON receipt_analyses TO expense_app;

-- Index utilisés par les policies et les listes.
CREATE INDEX IF NOT EXISTS expense_notes_user_id_idx ON expense_notes (user_id);
CREATE INDEX IF NOT EXISTS users_company_id_idx ON users (company_id);
CREATE INDEX IF NOT EXISTS users_manager_id_idx ON users (manager_id);

-- S3 : un manager d'une autre entreprise devient impossible dans le schéma.
-- Un lien inter-entreprises déjà présent (reliquat d'un exploit de S3) fait
-- échouer la migration : à examiner, pas à corriger en silence.
DO $$
DECLARE
  cross_links integer;
BEGIN
  SELECT count(*) INTO cross_links
  FROM users e JOIN users m ON m.id = e.manager_id
  WHERE m.company_id <> e.company_id;
  IF cross_links > 0 THEN
    RAISE EXCEPTION '% rattachement(s) à un manager d''une autre entreprise', cross_links
      USING HINT = 'SELECT e.id, e.email, m.email FROM users e JOIN users m ON m.id = e.manager_id WHERE m.company_id <> e.company_id';
  END IF;
END
$$;

ALTER TABLE users ADD CONSTRAINT users_id_company_id_key UNIQUE (id, company_id);
ALTER TABLE users ADD CONSTRAINT users_manager_same_company_fkey
  FOREIGN KEY (manager_id, company_id) REFERENCES users (id, company_id);

-- Notes : la visibilité manager et RH est bornée par l'entreprise de
-- l'auteur. Les policies propriétaire sont inchangées ; aucune policy UPDATE
-- propriétaire (un employé ne tranche pas sa propre note).
DROP POLICY expense_notes_manager_select ON expense_notes;
DROP POLICY expense_notes_manager_update ON expense_notes;
DROP POLICY expense_notes_hr_root_manager_select ON expense_notes;
DROP POLICY expense_notes_hr_root_manager_update ON expense_notes;

CREATE POLICY expense_notes_manager_select ON expense_notes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = expense_notes.user_id
        AND u.manager_id = (SELECT nullif(current_setting('app.current_user_id', true), '')::uuid)
        AND u.company_id = (SELECT nullif(current_setting('app.current_company_id', true), '')::uuid)
    )
  );

CREATE POLICY expense_notes_manager_update ON expense_notes
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = expense_notes.user_id
        AND u.manager_id = (SELECT nullif(current_setting('app.current_user_id', true), '')::uuid)
        AND u.company_id = (SELECT nullif(current_setting('app.current_company_id', true), '')::uuid)
    )
  );

CREATE POLICY expense_notes_hr_root_manager_select ON expense_notes
  FOR SELECT
  USING (
    (SELECT current_setting('app.current_role', true)) = 'hr_admin'
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = expense_notes.user_id
        AND u.role = 'manager'
        AND u.manager_id IS NULL
        AND u.company_id = (SELECT nullif(current_setting('app.current_company_id', true), '')::uuid)
    )
  );

CREATE POLICY expense_notes_hr_root_manager_update ON expense_notes
  FOR UPDATE
  USING (
    (SELECT current_setting('app.current_role', true)) = 'hr_admin'
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = expense_notes.user_id
        AND u.role = 'manager'
        AND u.manager_id IS NULL
        AND u.company_id = (SELECT nullif(current_setting('app.current_company_id', true), '')::uuid)
    )
  );

-- Utilisateurs : sa propre ligne (lue par `withUserScope` pour poser le
-- contexte) et celles de son entreprise. Rattachement réservé à la RH, dans
-- son entreprise. Aucune policy de `users` ne lit `users` (récursion), d'où
-- les contextes d'entreprise et de rôle.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_select_self_or_company ON users
  FOR SELECT
  USING (
    id = (SELECT nullif(current_setting('app.current_user_id', true), '')::uuid)
    OR company_id = (SELECT nullif(current_setting('app.current_company_id', true), '')::uuid)
  );

CREATE POLICY users_update_by_company_hr ON users
  FOR UPDATE
  USING (
    company_id = (SELECT nullif(current_setting('app.current_company_id', true), '')::uuid)
    AND (SELECT current_setting('app.current_role', true)) = 'hr_admin'
  )
  WITH CHECK (
    company_id = (SELECT nullif(current_setting('app.current_company_id', true), '')::uuid)
  );

-- Fonctions à surface étroite pour les deux lectures faites avant de
-- connaître l'utilisateur. Propriétaire `expense_definer` (BYPASSRLS, jamais
-- superuser), `search_path` figé, exécution réservée à l'application.
GRANT SELECT, INSERT ON companies, users TO expense_definer;

-- Connexion : une seule ligne, par email exact. Branchée dans `authorize()`
-- par 2-481.
CREATE FUNCTION auth_find_user(p_email text)
RETURNS TABLE (id uuid, email text, password_hash text, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email, u.password_hash, u.role FROM users u WHERE u.email = p_email
$$;

-- Inscription : crée l'entreprise et sa RH dans la même instruction, donc
-- atomiquement (une entreprise ne reste jamais sans RH). Rend NULL si une
-- entreprise a déjà ce domaine, sans rien écrire. 2-496 y ajoute
-- l'acceptation d'une invitation.
CREATE FUNCTION register_user(
  p_name text,
  p_email text,
  p_password_hash text,
  p_company_name text,
  p_email_domain text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_user_id uuid;
BEGIN
  INSERT INTO companies (name, email_domain)
  VALUES (p_company_name, p_email_domain)
  ON CONFLICT (email_domain) DO NOTHING
  RETURNING companies.id INTO v_company_id;

  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO users (company_id, name, email, password_hash, role)
  VALUES (v_company_id, p_name, p_email, p_password_hash, 'hr_admin')
  RETURNING users.id INTO v_user_id;

  RETURN v_user_id;
END
$$;

ALTER FUNCTION auth_find_user(text) OWNER TO expense_definer;
ALTER FUNCTION register_user(text, text, text, text, text) OWNER TO expense_definer;
REVOKE EXECUTE ON FUNCTION auth_find_user(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION register_user(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user(text) TO expense_app;
GRANT EXECUTE ON FUNCTION register_user(text, text, text, text, text) TO expense_app;

-- Down Migration
DROP FUNCTION register_user(text, text, text, text, text);
DROP FUNCTION auth_find_user(text);

DROP POLICY users_update_by_company_hr ON users;
DROP POLICY users_select_self_or_company ON users;
ALTER TABLE users NO FORCE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

DROP POLICY expense_notes_manager_select ON expense_notes;
DROP POLICY expense_notes_manager_update ON expense_notes;
DROP POLICY expense_notes_hr_root_manager_select ON expense_notes;
DROP POLICY expense_notes_hr_root_manager_update ON expense_notes;

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

ALTER TABLE users DROP CONSTRAINT users_manager_same_company_fkey;
ALTER TABLE users DROP CONSTRAINT users_id_company_id_key;

DROP INDEX IF EXISTS users_manager_id_idx;
DROP INDEX IF EXISTS users_company_id_idx;
DROP INDEX IF EXISTS expense_notes_user_id_idx;

-- Les rôles sont globaux au cluster : retirer leurs droits dans cette base,
-- puis les supprimer.
DROP OWNED BY expense_app, expense_definer;
DROP ROLE expense_app;
DROP ROLE expense_definer;

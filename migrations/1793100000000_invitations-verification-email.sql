-- Up Migration
-- S7 (ADR-001 §3, 2-496) : le domaine de l'email ne donne plus aucun droit.
-- S'inscrire sans invitation crée sa propre entreprise, dont on devient RH
-- après vérification de son email ; rejoindre une entreprise passe par une
-- invitation de sa RH, dont le lien à usage unique vaut vérification d'email.
--
-- Les jetons ne sont jamais stockés en clair : seule leur empreinte SHA-256
-- (hex) est en base. Le worker génère le jeton au moment d'envoyer l'email,
-- l'outbox ne transporte que des ids.

-- Plusieurs entreprises peuvent partager un domaine.
ALTER TABLE companies DROP CONSTRAINT companies_email_domain_key;
CREATE INDEX companies_email_domain_idx ON companies (email_domain);

-- Vérification d'email. Défaut `now()` : les comptes existants, le seed et
-- les comptes créés en base par les tests restent vérifiés ; seule
-- l'inscription sans invitation écrit NULL. Aucun droit pour `expense_app` :
-- ces colonnes ne passent que par les fonctions ci-dessous.
ALTER TABLE users
  ADD COLUMN email_verified_at timestamptz DEFAULT now(),
  ADD COLUMN verification_token_hash text,
  ADD COLUMN verification_expires_at timestamptz;

CREATE UNIQUE INDEX users_verification_token_hash_key
  ON users (verification_token_hash) WHERE verification_token_hash IS NOT NULL;

-- Invitations : une seule en attente par adresse et par entreprise. La RH
-- les crée et les relance ; tout le reste passe par les fonctions.
CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  email text NOT NULL,
  invited_by uuid NOT NULL,
  token_hash text,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (invited_by, company_id) REFERENCES users (id, company_id)
);

CREATE UNIQUE INDEX invitations_pending_email_key
  ON invitations (company_id, lower(email)) WHERE accepted_at IS NULL;
CREATE UNIQUE INDEX invitations_token_hash_key
  ON invitations (token_hash) WHERE token_hash IS NOT NULL;

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY invitations_company_hr ON invitations
  FOR ALL
  USING (
    company_id = (SELECT nullif(current_setting('app.current_company_id', true), '')::uuid)
    AND (SELECT current_setting('app.current_role', true)) = 'hr_admin'
  )
  WITH CHECK (
    company_id = (SELECT nullif(current_setting('app.current_company_id', true), '')::uuid)
    AND (SELECT current_setting('app.current_role', true)) = 'hr_admin'
  );

GRANT SELECT (id, company_id, email, invited_by, expires_at, accepted_at, created_at),
  INSERT (company_id, email, invited_by, expires_at),
  UPDATE (expires_at, token_hash)
  ON invitations TO expense_app;

-- Droits des fonctions ci-dessous (propriétaire `expense_definer`).
GRANT SELECT, UPDATE ON invitations TO expense_definer;
GRANT UPDATE ON users TO expense_definer;
GRANT INSERT ON outbox_events TO expense_definer;

-- Inscription sans invitation : crée toujours une nouvelle entreprise et sa
-- RH, non vérifiée, et demande l'email de vérification, dans la même
-- instruction (atomique). Ne rend plus NULL : le domaine ne regroupe
-- personne. Un email déjà pris lève 23505 sans rien laisser derrière.
CREATE OR REPLACE FUNCTION register_user(
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
  RETURNING companies.id INTO v_company_id;

  INSERT INTO users (company_id, name, email, password_hash, role, email_verified_at)
  VALUES (v_company_id, p_name, p_email, p_password_hash, 'hr_admin', NULL)
  RETURNING users.id INTO v_user_id;

  INSERT INTO outbox_events (company_id, type, payload)
  VALUES (v_company_id, 'email.verification.requested', jsonb_build_object('userId', v_user_id));

  RETURN v_user_id;
END
$$;

-- Formulaire d'inscription par invitation : adresse et entreprise d'une
-- invitation encore utilisable, sinon aucune ligne.
CREATE FUNCTION invitation_preview(p_token_hash text)
RETURNS TABLE (email text, company_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.email, c.name
  FROM invitations i JOIN companies c ON c.id = i.company_id
  WHERE i.token_hash = p_token_hash
    AND i.accepted_at IS NULL
    AND i.expires_at > now()
$$;

-- Acceptation : l'invitation est verrouillée, puis l'employé créé (vérifié,
-- sans manager) et l'invitation marquée acceptée, dans la même transaction.
-- `failure` vaut 'invalid' (inconnue, expirée, déjà utilisée ou pour une
-- autre adresse) ou 'email_taken' ; sinon `user_id` est rempli.
CREATE FUNCTION accept_invitation(
  p_name text,
  p_email text,
  p_password_hash text,
  p_token_hash text,
  OUT user_id uuid,
  OUT failure text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invitation invitations%ROWTYPE;
BEGIN
  SELECT * INTO v_invitation FROM invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND
    OR v_invitation.accepted_at IS NOT NULL
    OR v_invitation.expires_at <= now()
    OR lower(v_invitation.email) <> lower(p_email) THEN
    failure := 'invalid';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM users u WHERE u.email = p_email) THEN
    failure := 'email_taken';
    RETURN;
  END IF;

  INSERT INTO users (company_id, name, email, password_hash, role, email_verified_at)
  VALUES (v_invitation.company_id, p_name, p_email, p_password_hash, 'employee', now())
  RETURNING users.id INTO user_id;

  UPDATE invitations SET accepted_at = now(), token_hash = NULL WHERE id = v_invitation.id;
END
$$;

-- Lien de vérification : à usage unique, valide jusqu'à son expiration.
CREATE FUNCTION verify_email(p_token_hash text)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH verified AS (
    UPDATE users
    SET email_verified_at = now(), verification_token_hash = NULL, verification_expires_at = NULL
    WHERE verification_token_hash = p_token_hash
      AND verification_expires_at > now()
      AND email_verified_at IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM verified)
$$;

-- Worker : enregistre l'empreinte du jeton qu'il va envoyer et rend
-- l'adresse. Aucune ligne si l'invitation est acceptée, expirée ou absente,
-- ou si le compte est déjà vérifié : rien à envoyer (idempotence).
CREATE FUNCTION issue_invitation_token(p_invitation_id uuid, p_token_hash text)
RETURNS TABLE (email text, company_name text, expires_at timestamptz)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE invitations i
  SET token_hash = p_token_hash
  FROM companies c
  WHERE i.id = p_invitation_id
    AND c.id = i.company_id
    AND i.accepted_at IS NULL
    AND i.expires_at > now()
  RETURNING i.email, c.name, i.expires_at
$$;

CREATE FUNCTION issue_verification_token(p_user_id uuid, p_token_hash text, p_ttl interval)
RETURNS TABLE (email text, name text)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE users u
  SET verification_token_hash = p_token_hash, verification_expires_at = now() + p_ttl
  WHERE u.id = p_user_id
    AND u.email_verified_at IS NULL
  RETURNING u.email, u.name
$$;

-- Connexion : la vérification d'email s'ajoute à la ligne (branchée par 2-481).
DROP FUNCTION auth_find_user(text);
CREATE FUNCTION auth_find_user(p_email text)
RETURNS TABLE (id uuid, email text, password_hash text, role text, email_verified_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email, u.password_hash, u.role, u.email_verified_at FROM users u WHERE u.email = p_email
$$;

ALTER FUNCTION invitation_preview(text) OWNER TO expense_definer;
ALTER FUNCTION accept_invitation(text, text, text, text) OWNER TO expense_definer;
ALTER FUNCTION verify_email(text) OWNER TO expense_definer;
ALTER FUNCTION issue_invitation_token(uuid, text) OWNER TO expense_definer;
ALTER FUNCTION issue_verification_token(uuid, text, interval) OWNER TO expense_definer;
ALTER FUNCTION auth_find_user(text) OWNER TO expense_definer;
REVOKE EXECUTE ON FUNCTION invitation_preview(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION accept_invitation(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION verify_email(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION issue_invitation_token(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION issue_verification_token(uuid, text, interval) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_find_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invitation_preview(text) TO expense_app;
GRANT EXECUTE ON FUNCTION accept_invitation(text, text, text, text) TO expense_app;
GRANT EXECUTE ON FUNCTION verify_email(text) TO expense_app;
-- Le worker n'a pas encore de rôle propre (2-481) : il partage celui de
-- l'application.
GRANT EXECUTE ON FUNCTION issue_invitation_token(uuid, text) TO expense_app;
GRANT EXECUTE ON FUNCTION issue_verification_token(uuid, text, interval) TO expense_app;
GRANT EXECUTE ON FUNCTION auth_find_user(text) TO expense_app;

-- Down Migration
DROP FUNCTION auth_find_user(text);
CREATE FUNCTION auth_find_user(p_email text)
RETURNS TABLE (id uuid, email text, password_hash text, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email, u.password_hash, u.role FROM users u WHERE u.email = p_email
$$;
ALTER FUNCTION auth_find_user(text) OWNER TO expense_definer;
REVOKE EXECUTE ON FUNCTION auth_find_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user(text) TO expense_app;

DROP FUNCTION issue_verification_token(uuid, text, interval);
DROP FUNCTION issue_invitation_token(uuid, text);
DROP FUNCTION verify_email(text);
DROP FUNCTION accept_invitation(text, text, text, text);
DROP FUNCTION invitation_preview(text);

-- Échoue si plusieurs entreprises partagent un domaine : à examiner, pas à
-- fusionner en silence.
ALTER TABLE companies ADD CONSTRAINT companies_email_domain_key UNIQUE (email_domain);
DROP INDEX companies_email_domain_idx;

CREATE OR REPLACE FUNCTION register_user(
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

REVOKE INSERT ON outbox_events FROM expense_definer;
REVOKE UPDATE ON users FROM expense_definer;
REVOKE SELECT, UPDATE ON invitations FROM expense_definer;
DROP TABLE invitations;

DROP INDEX users_verification_token_hash_key;
ALTER TABLE users
  DROP COLUMN verification_expires_at,
  DROP COLUMN verification_token_hash,
  DROP COLUMN email_verified_at;

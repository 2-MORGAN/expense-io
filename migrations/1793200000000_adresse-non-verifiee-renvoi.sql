-- Up Migration
-- S7 (ADR-001 §3, 2-496), suite : un compte non vérifié ne bloque plus son
-- adresse. Seule une adresse prouvée (lien de vérification ou d'invitation)
-- la garde : une nouvelle inscription ou une invitation acceptée pour cette
-- adresse supprime le compte non vérifié et son entreprise, restée vide.
-- Le créateur peut aussi redemander l'email de vérification.
--
-- Un compte non vérifié n'a jamais pu se connecter : ni note, ni invitation,
-- ni rattachement ne le référencent. S'il en existait, la suppression
-- échouerait sur la clé étrangère (échec fermé, rien n'est perdu en silence).
-- L'événement de vérification en attente part avec l'entreprise
-- (`outbox_events` en ON DELETE CASCADE).

GRANT DELETE ON users, companies TO expense_definer;
GRANT SELECT ON outbox_events TO expense_definer;

-- Interne : appelée par `register_user` et `accept_invitation` seulement,
-- aucun droit d'exécution pour l'application.
CREATE FUNCTION purge_unverified_account(p_email text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  DELETE FROM users
  WHERE email = p_email AND email_verified_at IS NULL
  RETURNING company_id INTO v_company_id;

  IF v_company_id IS NOT NULL THEN
    DELETE FROM companies c
    WHERE c.id = v_company_id
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.company_id = c.id);
  END IF;
END
$$;

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
  -- Une inscription non confirmée sur la même adresse est remplacée ; une
  -- adresse vérifiée lève toujours 23505.
  PERFORM purge_unverified_account(p_email);

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

CREATE OR REPLACE FUNCTION accept_invitation(
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

  -- Invitation valide : le lien prouve l'adresse, il l'emporte sur une
  -- inscription non confirmée.
  PERFORM purge_unverified_account(p_email);

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

-- Renvoi de l'email de vérification : un événement pour le compte non
-- vérifié de cette adresse, sauf s'il en a déjà un en attente. Ne rend rien,
-- que le compte existe ou non : la réponse ne révèle aucune adresse. Le
-- worker crée un nouveau jeton à l'envoi, l'ancien lien devient invalide.
CREATE FUNCTION request_email_verification(p_email text)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO outbox_events (company_id, type, payload)
  SELECT u.company_id, 'email.verification.requested', jsonb_build_object('userId', u.id)
  FROM users u
  WHERE u.email = p_email
    AND u.email_verified_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM outbox_events e
      WHERE e.type = 'email.verification.requested'
        AND e.status = 'pending'
        AND e.payload->>'userId' = u.id::text
    )
$$;

ALTER FUNCTION purge_unverified_account(text) OWNER TO expense_definer;
ALTER FUNCTION request_email_verification(text) OWNER TO expense_definer;
REVOKE EXECUTE ON FUNCTION purge_unverified_account(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION request_email_verification(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_email_verification(text) TO expense_app;

-- Down Migration
DROP FUNCTION request_email_verification(text);

CREATE OR REPLACE FUNCTION accept_invitation(
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

DROP FUNCTION purge_unverified_account(text);

REVOKE SELECT ON outbox_events FROM expense_definer;
REVOKE DELETE ON users, companies FROM expense_definer;

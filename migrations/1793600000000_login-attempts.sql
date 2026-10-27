-- Up Migration
-- Limite de tentatives de connexion (ADR-001 §4 point 3, AUTH-11). Un
-- compteur d'échecs par clé, dans une fenêtre fixe : la clé est l'empreinte
-- SHA-256 de `email:<adresse>` ou de `ip:<adresse>`, jamais l'adresse en
-- clair. La table ne porte aucune donnée d'entreprise, d'où l'absence de RLS ;
-- elle est lue avant toute session. L'application n'y a aucun droit direct :
-- deux fonctions `SECURITY DEFINER` à surface étroite, comme `auth_find_user`.
CREATE TABLE login_attempts (
  key text PRIMARY KEY,
  failures int NOT NULL CHECK (failures > 0),
  window_end timestamptz NOT NULL
);

CREATE INDEX login_attempts_window_end_idx ON login_attempts (window_end);

GRANT SELECT, INSERT, UPDATE, DELETE ON login_attempts TO expense_definer;

-- Lecture : les fenêtres en cours de ces clés, avec l'heure de la base (le
-- seuil est appliqué par l'application, réglable par l'environnement).
CREATE FUNCTION login_attempts_for(p_keys text[])
RETURNS TABLE (key text, failures int, window_end timestamptz, checked_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.key, a.failures, a.window_end, now() FROM login_attempts a
  WHERE a.key = ANY(p_keys) AND a.window_end > now()
$$;

-- Écriture, seulement en cas d'échec : un échec de plus sur chaque clé ; une
-- fenêtre expirée repart de 1. Purge bornée des fenêtres expirées depuis plus
-- d'une heure : la table ne grossit pas avec les adresses essayées une fois.
CREATE FUNCTION record_login_failure(p_keys text[], p_window_seconds int)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO login_attempts AS a (key, failures, window_end)
  SELECT k, 1, now() + make_interval(secs => p_window_seconds) FROM unnest(p_keys) AS k
  ON CONFLICT (key) DO UPDATE SET
    failures = CASE WHEN a.window_end <= now() THEN 1 ELSE a.failures + 1 END,
    window_end = CASE WHEN a.window_end <= now() THEN EXCLUDED.window_end ELSE a.window_end END;
  DELETE FROM login_attempts WHERE key IN (
    SELECT key FROM login_attempts WHERE window_end < now() - interval '1 hour' LIMIT 100
  );
$$;

ALTER FUNCTION login_attempts_for(text[]) OWNER TO expense_definer;
ALTER FUNCTION record_login_failure(text[], int) OWNER TO expense_definer;
REVOKE EXECUTE ON FUNCTION login_attempts_for(text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_login_failure(text[], int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION login_attempts_for(text[]) TO expense_app;
GRANT EXECUTE ON FUNCTION record_login_failure(text[], int) TO expense_app;

-- Down Migration
DROP FUNCTION record_login_failure(text[], int);
DROP FUNCTION login_attempts_for(text[]);
DROP TABLE login_attempts;

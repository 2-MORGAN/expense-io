-- Up Migration
-- Bascule sur les rôles restreints (ADR-001 §3 point 7 et point de
-- coordination avec l'ADR-003, 2-481). L'application se connecte sous
-- `expense_app`, le worker de l'outbox et la réconciliation des reçus sous
-- `expense_worker` ; le propriétaire ne sert plus qu'aux migrations, au seed
-- et au nettoyage ponctuel (`MIGRATION_DATABASE_URL`).
--
-- Aucun mot de passe ici : `scripts/provision-db-roles.mjs`, lancé par
-- `npm run migrate:up`, pose ceux de `DATABASE_URL` et `WORKER_DATABASE_URL`.

ALTER ROLE expense_app LOGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'expense_worker') THEN
    CREATE ROLE expense_worker LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Outbox : le worker traite par nature les événements de toutes les
-- entreprises. Il les lit et met à jour leur état ; il n'en crée ni n'en
-- supprime (la purge passe par `purge_expired_receipt_analyses`).
GRANT SELECT, UPDATE ON outbox_events TO expense_worker;

CREATE POLICY outbox_events_worker_select ON outbox_events
  FOR SELECT TO expense_worker
  USING (true);

CREATE POLICY outbox_events_worker_update ON outbox_events
  FOR UPDATE TO expense_worker
  USING (true)
  WITH CHECK (true);

-- Le reste sous un contexte posé par le worker : l'entreprise de l'événement
-- (`scopeToCompany`) pour les destinataires, l'utilisateur de l'analyse pour
-- `receipt_analyses`. Les policies existantes s'appliquent telles quelles.
GRANT SELECT (id, company_id, name, email, role, manager_id, created_at) ON users TO expense_worker;
GRANT SELECT, UPDATE ON receipt_analyses TO expense_worker;

-- Jetons des emails d'invitation et de vérification : seul le worker les
-- crée, à l'envoi (2-496). L'application n'en a plus besoin.
REVOKE EXECUTE ON FUNCTION issue_invitation_token(uuid, text) FROM expense_app;
REVOKE EXECUTE ON FUNCTION issue_verification_token(uuid, text, interval) FROM expense_app;
GRANT EXECUTE ON FUNCTION issue_invitation_token(uuid, text) TO expense_worker;
GRANT EXECUTE ON FUNCTION issue_verification_token(uuid, text, interval) TO expense_worker;

-- Quatre lectures portent sur toutes les entreprises, hors de tout contexte.
-- Plutôt qu'un rôle de connexion `BYPASSRLS` (écarté pour la même raison
-- qu'à l'ADR-001 §4), quatre fonctions à surface étroite, propriété de
-- `expense_definer`.
GRANT SELECT, DELETE ON receipt_analyses TO expense_definer;
GRANT DELETE ON outbox_events TO expense_definer;
GRANT SELECT (receipt_key) ON expense_notes TO expense_definer;

-- Nettoyage des analyses OCR (PR #13) : reçus encore présents sur S3 des
-- analyses terminées. L'écriture qui suit (`receipt_deleted`) se fait sous
-- l'utilisateur de l'analyse.
CREATE FUNCTION receipt_cleanup_candidates(p_limit integer)
RETURNS TABLE (id uuid, receipt_key text, user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.receipt_key, a.user_id FROM receipt_analyses a
  WHERE a.status IN ('succeeded', 'failed') AND a.receipt_deleted = false
  LIMIT least(p_limit, 100)
$$;

-- Analyses expirées (24 h) dont le reçu est supprimé, et leurs événements.
CREATE FUNCTION purge_expired_receipt_analyses()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM outbox_events
  WHERE type = 'receipt.analysis.requested' AND status IN ('sent', 'dead')
    AND payload->>'analysisId' IN (
      SELECT a.id::text FROM receipt_analyses a WHERE a.expires_at < now() AND a.receipt_deleted
    );
  DELETE FROM receipt_analyses WHERE expires_at < now() AND receipt_deleted;
END
$$;

-- Réconciliation des reçus orphelins (2-476) : parmi `p_keys`, celles qu'une
-- note ou une analyse référence encore. Ne rend que des clés déjà connues de
-- l'appelant.
CREATE FUNCTION referenced_receipt_keys(p_keys text[])
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.receipt_key FROM expense_notes e WHERE e.receipt_key = ANY(p_keys)
  UNION
  SELECT a.receipt_key FROM receipt_analyses a WHERE a.receipt_key = ANY(p_keys)
$$;

-- Garde-fou de capacité de l'OCR (ADR-003 §1) : nombre d'analyses en attente,
-- toutes entreprises, lu par l'application avant d'en accepter une. Ne rend
-- qu'un nombre.
CREATE FUNCTION pending_receipt_analyses()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*) FROM outbox_events o
  WHERE o.type = 'receipt.analysis.requested' AND o.status = 'pending'
$$;

ALTER FUNCTION pending_receipt_analyses() OWNER TO expense_definer;
REVOKE EXECUTE ON FUNCTION pending_receipt_analyses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pending_receipt_analyses() TO expense_app;

ALTER FUNCTION receipt_cleanup_candidates(integer) OWNER TO expense_definer;
ALTER FUNCTION purge_expired_receipt_analyses() OWNER TO expense_definer;
ALTER FUNCTION referenced_receipt_keys(text[]) OWNER TO expense_definer;
REVOKE EXECUTE ON FUNCTION receipt_cleanup_candidates(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION purge_expired_receipt_analyses() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION referenced_receipt_keys(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION receipt_cleanup_candidates(integer) TO expense_worker;
GRANT EXECUTE ON FUNCTION purge_expired_receipt_analyses() TO expense_worker;
GRANT EXECUTE ON FUNCTION referenced_receipt_keys(text[]) TO expense_worker;

-- Down Migration
DROP FUNCTION pending_receipt_analyses();
DROP FUNCTION referenced_receipt_keys(text[]);
DROP FUNCTION purge_expired_receipt_analyses();
DROP FUNCTION receipt_cleanup_candidates(integer);
REVOKE SELECT (receipt_key) ON expense_notes FROM expense_definer;
REVOKE DELETE ON outbox_events FROM expense_definer;
REVOKE SELECT, DELETE ON receipt_analyses FROM expense_definer;

GRANT EXECUTE ON FUNCTION issue_invitation_token(uuid, text) TO expense_app;
GRANT EXECUTE ON FUNCTION issue_verification_token(uuid, text, interval) TO expense_app;

DROP POLICY outbox_events_worker_update ON outbox_events;
DROP POLICY outbox_events_worker_select ON outbox_events;

-- Le rôle est global au cluster : retirer ses droits dans cette base, puis
-- le supprimer.
DROP OWNED BY expense_worker;
DROP ROLE expense_worker;

ALTER ROLE expense_app NOLOGIN PASSWORD NULL;

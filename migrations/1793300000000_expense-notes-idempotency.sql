-- Up Migration
-- Renvoi du formulaire (2-476 étape 2, ADR-003 §4) : la clé `Idempotency-Key`
-- et l'empreinte de la requête vivent sur la note, sans table ni TTL dédiés.
-- Les deux colonnes sont NULL pour les notes créées sans l'en-tête.
ALTER TABLE expense_notes
  ADD COLUMN idempotency_key uuid,
  ADD COLUMN request_fingerprint text;

-- Portée par utilisateur : pas de collision ni de fuite entre tenants. L'index
-- arbitre deux requêtes concurrentes portant la même clé.
CREATE UNIQUE INDEX expense_notes_user_idempotency_key
  ON expense_notes (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Down Migration
DROP INDEX expense_notes_user_idempotency_key;
ALTER TABLE expense_notes DROP COLUMN request_fingerprint;
ALTER TABLE expense_notes DROP COLUMN idempotency_key;

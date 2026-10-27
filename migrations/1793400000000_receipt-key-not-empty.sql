-- Up Migration
-- 2-476 étape 3 (ADR-003 §3) : plus jamais de note sans reçu. La contrainte est
-- posée NOT VALID : elle refuse toute nouvelle ligne ou mise à jour avec une
-- clé vide sans parcourir l'existant, que le script
-- `scripts/clean-notes-without-receipt.mjs` nettoie puis valide (VALIDATE
-- CONSTRAINT) une fois qu'aucune note sans reçu ne subsiste.
ALTER TABLE expense_notes
  ADD CONSTRAINT expense_notes_receipt_key_not_empty CHECK (receipt_key <> '') NOT VALID;

-- Down Migration
ALTER TABLE expense_notes DROP CONSTRAINT expense_notes_receipt_key_not_empty;

# migrations — schéma de la base

Consignes du dossier, en complément du [CLAUDE.md](../CLAUDE.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

SQL versionné, seule source de vérité du schéma, appliqué par `node-pg-migrate` sous le rôle propriétaire (`MIGRATION_DATABASE_URL`). L'application (`expense_app`) et le worker (`expense_worker`) sont soumis à la RLS et n'ont que les droits accordés ici.

## Ajouter une migration

1. **Ne jamais modifier une migration déjà fusionnée dans `main`** : elle a tourné sur d'autres bases. Une correction est une migration nouvelle. Le hook `.claude/hooks/guard-frozen.mjs` refuse l'écriture, et la CI la PR (`make frozen` en local).
2. Un fichier `<horodatage>_<nom-court>.sql` dans ce dossier, horodatage en millisecondes **plus grand que le dernier** (lister le dossier), nom en minuscules avec des tirets. Seul un fichier qui commence par un chiffre est une migration : `migrate:up` et `migrate:down` ignorent les autres (`--ignore-pattern` dans `package.json`, vérifié par `scripts/migrations.test.ts`), dont ces consignes.
3. Deux sections dans cet ordre : `-- Up Migration`, puis `-- Down Migration`, qui défait le up dans l'ordre inverse.
4. En tête, un commentaire : ce que fait la migration et pourquoi (ticket, ADR).
5. Appliquer, défaire, réappliquer : `npm run migrate:up`, `npm run migrate:down`, `npm run migrate:up`.

## Table d'une entreprise (donnée tenant)

Modèle : `migrations/1793100000000_invitations-verification-email.sql`.

- `company_id uuid NOT NULL REFERENCES companies(id)` ;
- `ENABLE ROW LEVEL SECURITY` **et** `FORCE ROW LEVEL SECURITY` ;
- une policy qui compare `company_id` à `current_setting('app.current_company_id', true)` (et le rôle à `app.current_role` si besoin), en `USING` et en `WITH CHECK` ;
- `GRANT` du minimum de colonnes et d'opérations à `expense_app`, et à `expense_worker` si le worker y touche ;
- montants en `numeric`, dates en `date`, identifiants en `uuid`.

## Fonction SECURITY DEFINER

Pour une opération qui doit franchir la RLS (inscription, invitation, jeton) : `SECURITY DEFINER`, `SET search_path = public, pg_temp`, propriétaire `expense_definer` (`ALTER FUNCTION … OWNER TO expense_definer`), puis `REVOKE EXECUTE … FROM PUBLIC` et `GRANT EXECUTE … TO expense_app`. La fonction vérifie elle-même tout ce qu'elle autorise.

## Pièges

- Contrainte sur des données existantes : la poser `NOT VALID`, la valider après nettoyage (`migrations/1793400000000_receipt-key-not-empty.sql`).
- Aucun mot de passe dans une migration : `scripts/provision-db-roles.mjs` les pose depuis l'environnement.
- Ne pas passer une colonne `date` en `timestamp` : le parser des dates (`src/lib/db.ts`) et l'API comptent sur `YYYY-MM-DD`.

## À mettre à jour avec

- `docs/architecture/vues/schema.mmd`, qui doit avoir exactement les tables des migrations (vérifié par `npm run check`), et la section « Données et isolation » de `docs/index.html`.
- Un test E2E au niveau de la base pour chaque policy (`e2e/rls-isolation.spec.ts`, IDs `ISO-*`).
- Toute la suite E2E : une migration touche tous les parcours.

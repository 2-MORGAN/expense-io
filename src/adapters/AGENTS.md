# src/adapters — implémentations des ports

Consignes du dossier, en complément de l'[AGENTS.md](../../AGENTS.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

PostgreSQL, S3, SMTP, Tesseract : chaque fichier implémente un port de `src/ports` en parlant à une technologie. Le SQL de l'application vit ici, et nulle part ailleurs hors `src/lib` et `migrations`.

## Peut importer

Recopié depuis `scripts/architecture/layers.ts` par `npm run generate:architecture` : ne rien écrire entre les marqueurs. Un droit nouveau se justifie dans la PR (ADR-002).

<!-- début : imports permis -->

| Module | Peut importer |
|---|---|
| `src/adapters` | `src/domain`, `src/lib/db`, `src/lib/log`, `src/lib/outbox`, `src/lib/storage`, `src/ports`, `src/utils`, `@aws-sdk`, `nodemailer`, `pg`, `sharp`, `tesseract.js` |

<!-- fin : imports permis -->

## Ajouter un adaptateur PostgreSQL

1. `export class PostgresXxxRepository implements XxxRepository` ; le préfixe dit la technologie (`Postgres`, `Pg`, `S3`, `Smtp`).
2. Toute lecture ou écriture faite pour un utilisateur passe par `withUserScope(userId, async (client) => …)` de `src/lib/db.ts` : il pose le contexte que lisent les policies RLS. Une transaction = un `withUserScope`.
3. Requêtes paramétrées (`$1`, `$2`…). Un tri ou une colonne variable : une table de requêtes fixes indexée par une clé fermée du domaine (`OWN_NOTES` dans `src/adapters/PostgresExpenseNoteListRepository.ts`). Chaque tri se termine par `id` pour un ordre stable.
4. Concurrence (décision, rattachement) : `SELECT … FOR UPDATE` dans la transaction.
5. Un événement de l'outbox s'écrit dans la même transaction que la donnée : `new PgEventOutbox(client).enqueue(…)`, ou les helpers de `src/adapters/PgNotificationEvents.ts`.
6. L'application se connecte sous `expense_app`, qui n'a que les droits accordés par les migrations : une table ou une colonne nouvelle demande son `GRANT` (`migrations/AGENTS.md`). `RETURNING` exige le droit `SELECT` sur les colonnes renvoyées.

## Exemples à copier

- `src/adapters/PostgresReceiptAccessRepository.ts` : lecture simple sous `withUserScope`.
- `src/adapters/PostgresExpenseNoteListRepository.ts` : liste blanche de tris, ordre stable.
- `src/adapters/PostgresExpenseNoteDecisionRepository.ts` : verrou, écriture et événement dans une seule transaction.

## Pièges

- `getPool()` est interdit hors `src/lib/db.ts` ; `withSystemTransaction()` est réservé aux fichiers de `SYSTEM_TRANSACTION_ALLOWED` (`eslint.config.mjs`) : ne pas allonger cette liste pour avancer.
- Pas de règle métier ici. Seule exception assumée : les critères du `WHERE` des listes, alignés sur le domaine.
- `numeric` arrive en chaîne et `date` en `YYYY-MM-DD` (parser OID 1082 laissé brut) : la conversion se fait à la frontière HTTP, `src/http/expenseNote.ts`.
- Reçus : clés non devinables préfixées par l'entreprise, accès par URL pré-signée de courte durée (`src/adapters/S3ReceiptAdapter.ts`).
- Journal : `logError()` de `src/lib/log.ts` ; jamais d'email, de jeton ni d'URL pré-signée dans un log.

## Tests

Un adaptateur se teste par les E2E, contre la vraie base et la RLS (`e2e/`). Seule sa logique pure se teste en Vitest (`src/adapters/SmtpEmailAdapter.test.ts`). Adaptateur nouveau ou modifié : lancer les E2E qui le traversent.

## Vérifié par

- ESLint : `getPool`, `withSystemTransaction`, SQL interpolé ou concaténé.
- `scripts/architecture/architecture.test.ts` : la matrice ci-dessus.

# src/lib — infrastructure transverse

Consignes du dossier, en complément du [CLAUDE.md](../../CLAUDE.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

Ce que tout le serveur partage : session (`auth.ts`), connexion à la base et contexte RLS (`db.ts`), stockage S3 (`storage.ts`), email (`email.ts`), outbox (`outbox.ts`), journal JSON (`log.ts`), jetons (`tokens.ts`), contrôles au démarrage (`authSecret.ts`, `dbRole.ts`), limite de tentatives de connexion (`loginThrottle.ts`), observabilité OpenTelemetry (`src/lib/telemetry`, ADR-007). Pas de règle métier ici.

## Peut importer

Recopié depuis `scripts/architecture/layers.ts` par `npm run generate:architecture` : ne rien écrire entre les marqueurs. Un droit nouveau se justifie dans la PR (ADR-002). Chaque fichier, et le dossier `telemetry`, est une couche à lui seul.

<!-- début : imports permis -->

| Module | Peut importer |
|---|---|
| `src/lib/auth` | `src/domain`, `src/lib/authErrors`, `src/lib/db`, `src/lib/log`, `src/lib/loginThrottle`, `src/lib/sessionUser`, `next`, `next-auth` |
| `src/lib/authSecret` | `src/lib/log` |
| `src/lib/authErrors` | `next-auth` |
| `src/lib/db` | `src/lib/log`, `pg` |
| `src/lib/dbRole` | `src/lib/db`, `src/lib/log` |
| `src/lib/email` | `src/adapters`, `src/lib/log`, `src/ports` |
| `src/lib/errors` | `src/http`, `src/lib/log`, `next` |
| `src/lib/log` | `@opentelemetry` |
| `src/lib/loginThrottle` | `src/lib/db` |
| `src/lib/outbox` | `src/domain`, `src/lib/db`, `src/lib/log`, `src/ports`, `pg` |
| `src/lib/sessionUser` | `src/domain`, `src/lib/db`, `react` |
| `src/lib/storage` | `src/domain`, `src/lib/log`, `@aws-sdk` |
| `src/lib/telemetry` | `src/lib/log`, `src/lib/outbox`, `@opentelemetry` |
| `src/lib/tokens` | rien |

<!-- fin : imports permis -->

## Avant d'ajouter un fichier

- Se demander s'il n'est pas plutôt un adaptateur derrière un port (`src/adapters`) ou une brique HTTP (`src/http`). `src/lib` n'accueille que ce qui sert à plusieurs couches et ne passe pas par un port.
- Un fichier nouveau est une couche nouvelle : la déclarer dans `scripts/architecture/layers.ts` avec ses droits (sinon : « fichier hors des couches déclarées »), lui donner sa ligne dans le bloc ci-dessus (`npm run generate:architecture`), la justifier dans la PR.

## Les points d'entrée à connaître

| Besoin | Fonction |
|---|---|
| Requête pour un utilisateur, sous RLS | `withUserScope(userId, fn)`, `src/lib/db.ts` |
| Traitement hors requête (worker, outbox) | `withSystemTransaction(fn)`, réservé à `SYSTEM_TRANSACTION_ALLOWED` (`eslint.config.mjs`) |
| Session de la requête | `auth()`, `src/lib/auth.ts` |
| Journal d'une erreur | `logError('evenement', error, champs)`, `src/lib/log.ts` |
| Métrique ou trace | `src/lib/telemetry`, avec l'API `@opentelemetry/api` seule (sans effet tant que la télémétrie est désactivée) ; voir `docs/observability.md` |

## Pièges

- `getPool()` ne sort jamais de `src/lib/db.ts`.
- Ne pas toucher au parser des dates (OID 1082) de `src/lib/db.ts` : il garde `YYYY-MM-DD` brut.
- Secrets et réglages : `process.env` seulement, variable ajoutée à `.env.example` et à la section « Démarrer » de `docs/index.html`.
- Journal : une ligne JSON, jamais d'email, de jeton, de mot de passe ni d'URL pré-signée (ADR-005 §5) ; jamais `console.error(error)`.
- Métriques et traces : étiquettes à peu de valeurs, jamais d'identifiant d'entreprise ou d'utilisateur, ni d'URL réelle.
- `auth.ts`, `db.ts` et `outbox.ts` sont traversés par toutes les routes ou tout le worker : les modifier, c'est lancer toute la suite E2E.

## Tests

`*.test.ts` à côté pour la logique pure (`src/lib/authSecret.test.ts`, `src/lib/log.test.ts`). `db.ts`, `outbox.ts` et `storage.ts` sont traversés par les tests d'intégration (`integration/AGENTS.md`), sous les rôles de production, et par les E2E.

## Vérifié par

- ESLint : `getPool`, `withSystemTransaction`, SQL interpolé.
- `scripts/architecture/architecture.test.ts` : chaque fichier appartient à une couche, et la matrice ci-dessus.

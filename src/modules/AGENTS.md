# src/modules — domaine et cas d'usage de chaque module

Consignes du dossier, en complément du [CLAUDE.md](../../CLAUDE.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

Monolithe modulaire, étape 1 (ADR-002 §3.2 : trois domaines cœurs et l'OCR en support) : un hexagone par module, avec son domaine (`domain/`) et ses cas d'usage (`application/`). Les ports (`src/ports`), les adaptateurs (`src/adapters`) et la composition (`src/composition`) restent partagés ; leur découpe par module est l'étape suivante.

| Module | Rôle | Domaine | Cas d'usage |
|---|---|---|---|
| `src/modules/expenses` | cœur : notes de frais | note, accès au reçu, tri, événements de notification | soumettre, lister, URL de reçu |
| `src/modules/identity` | cœur : comptes, entreprises, invitations | utilisateur et rôles, inscription, invitation, vérification d'email | inscription, invitation, emails d'identité |
| `src/modules/validation` | cœur : décision sur une note | qui tranche quoi, une seule fois | trancher (manager, RH) |
| `src/modules/receipt-analysis` | support : lecture des reçus (OCR) | bornes, lecture du texte, erreurs, charge utile d'analyse | suggestion, analyses asynchrones, capacité |

## Peut importer

Recopié depuis `scripts/architecture/layers.ts` par `npm run generate:architecture` : ne rien écrire entre les marqueurs. Un droit nouveau se justifie dans la PR (ADR-002).

<!-- début : imports permis -->

| Module | Peut importer |
|---|---|
| `src/modules/expenses/application` | `src/modules/expenses/domain`, `src/ports`, `src/utils`, `node:crypto` |
| `src/modules/identity/application` | `src/modules/identity/domain`, `src/ports`, `src/utils`, `node:crypto` |
| `src/modules/receipt-analysis/application` | `src/modules/receipt-analysis/domain`, `src/ports`, `src/utils`, `node:crypto` |
| `src/modules/validation/application` | `src/modules/validation/domain`, `src/ports`, `src/utils`, `node:crypto` |
| `src/modules/expenses/domain` | `src/generated`, `src/modules/identity/domain`, `src/ports`, `src/utils` |
| `src/modules/identity/domain` | `src/generated`, `src/ports`, `src/utils` |
| `src/modules/receipt-analysis/domain` | `src/generated`, `src/ports`, `src/utils` |
| `src/modules/validation/domain` | `src/generated`, `src/modules/expenses/domain`, `src/modules/identity/domain`, `src/ports`, `src/utils` |

<!-- fin : imports permis -->

Deux règles en découlent : un cas d'usage ne voit que le domaine de son module, et les seuls liens entre domaines sont ceux de l'ADR-002 : `expenses` et `validation` lisent les rôles d'`identity`, `validation` tranche une note d'`expenses`. Fusionner validation et notes de frais est écarté par l'ADR-002. Un identifiant partagé passe par `src/utils/uuid.ts`, le reste par un port.

## Ajouter une règle (domaine)

Du TypeScript pur, testé en millisecondes, sans base, sans HTTP, sans SDK.

1. Choisir le module ; un contexte nouveau est un module nouveau (`src/modules/<nom>/domain` et `application`), déclaré dans `scripts/architecture/layers.ts` et justifié dans la PR.
2. Écrire d'abord le test `*.test.ts` à côté, le voir échouer : `npx vitest src/modules`.
3. Une fonction pure ou une petite classe. Entrées et sorties typées par des interfaces du domaine (`ReceiptViewer`, `ReceiptOwner`), jamais par une ligne SQL ni un DTO HTTP.
4. Un refus est une erreur nommée (`class ReceiptNotVisible extends Error`) ; la couche HTTP la traduit en code d'erreur dans `src/http/errors.ts`.
5. Un type d'événement de l'outbox est une constante `export const X = 'contexte.action'` dans le domaine de son module, avec la construction et la garde de type de son payload.

## Ajouter un cas d'usage (application)

Une intention de l'utilisateur ou du worker : soumettre, trancher, lister, inviter, analyser un reçu. Lire par un port, appliquer la règle du domaine, écrire par un port ; ni HTTP, ni SQL, ni S3.

1. La règle d'abord, dans le domaine du module, avec son test.
2. Le port dont il a besoin, dans `src/ports`, nommé par l'intention (`findReceipt`, `listPendingForManager`).
3. Une classe : dépendances en `private readonly` dans le constructeur, une méthode `execute(...)`, ou une méthode par intention proche (`src/modules/expenses/application/ListExpenseNotes.ts`).
4. Les identifiants d'utilisateur reçus sont ceux de la session (`actor.id` passé par la route), jamais un id pris du corps de la requête.
5. Le test à côté, avec de faux ports typés par l'interface (`vi.fn`) : ni base ni serveur.
6. Le brancher dans `src/composition`, puis l'appeler depuis la route, la page serveur ou le worker.

## Exemples à copier

- `src/modules/expenses/domain/ReceiptAccess.ts` et son test : règle d'accès, erreur du domaine, un cas par périmètre.
- `src/modules/expenses/domain/NoteSort.ts` : liste blanche réduite à une clé fermée, que l'adaptateur traduit en requête fixe.
- `src/modules/expenses/domain/Notification.ts` : types d'événements, payloads et gardes `isXPayload`.
- `src/modules/expenses/application/GetReceiptUrl.ts` et son test : lecture par un port, règle du domaine, erreur du domaine, puis stockage.
- `src/modules/validation/application/DecideExpenseNote.test.ts` : le test type avec de faux ports.
- `src/modules/expenses/application/SubmitExpenseNote.ts` : opération en plusieurs étapes (reçu puis note), compensée en cas d'échec et rejouable (`Idempotency-Key`).

## Pièges

- « Qui voit quoi » existe aussi dans le `WHERE` des listes (`src/adapters/PostgresExpenseNoteListRepository.ts`) : faire évoluer les deux ensemble.
- Note absente et note d'une autre entreprise donnent la même erreur (404) : ne jamais révéler qu'une ressource existe. 401 et 403 (session, rôle) restent dans la route (`requireRole`).
- Une écriture et son événement d'outbox se font dans la même transaction : c'est l'adaptateur qui les fait ensemble (`src/adapters/PostgresExpenseNoteDecisionRepository.ts`), pas le cas d'usage en appelant deux ports l'un après l'autre.
- Upload S3 puis écriture en base : supprimer le reçu si l'écriture échoue, comme `SubmitExpenseNote`.
- Dates en chaîne `YYYY-MM-DD`, jamais `Date` (fuseau horaire). Pas de `Math.random()` ni d'horloge cachée : recevoir la date ou l'id en paramètre (`invitationExpiry(now)` dans `src/modules/identity/domain/identity.ts`) ; dans un cas d'usage, `randomUUID` de `node:crypto`, seul module de Node permis.

## Vérifié par

- ESLint (`expense-io/domain` dans `eslint.config.mjs`) : aucun import de `pg`, `next`, `react`, d'un SDK, de `src/lib`, `src/adapters`, d'un cas d'usage, de `src/app`, `src/components` depuis un domaine.
- `scripts/architecture/architecture.test.ts` : la matrice ci-dessus, et chaque type d'événement cité dans `docs/index.html`.
- Couverture unitaire mesurée ici : `npm run test:coverage`.

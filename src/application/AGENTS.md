# src/application — cas d'usage

Consignes du dossier, en complément du [CLAUDE.md](../../CLAUDE.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

Un cas d'usage = une intention de l'utilisateur ou du worker : soumettre une note, trancher, lister, inviter, analyser un reçu. Il orchestre : lire par un port, appliquer la règle du domaine, écrire par un port. Il ne connaît ni HTTP, ni SQL, ni S3, seulement les interfaces de `src/ports`.

## Peut importer

Recopié depuis `scripts/architecture/layers.ts` par `npm run generate:architecture` : ne rien écrire entre les marqueurs. Un droit nouveau se justifie dans la PR (ADR-002).

<!-- début : imports permis -->

| Module | Peut importer |
|---|---|
| `src/application` | `src/domain`, `src/ports`, `src/utils`, `node:crypto` |

<!-- fin : imports permis -->

## Ajouter un cas d'usage

1. La règle d'abord, dans `src/domain`, avec son test.
2. Le port dont il a besoin, dans `src/ports`, nommé par l'intention (`findReceipt`, `listPendingForManager`).
3. Une classe : dépendances en `private readonly` dans le constructeur, une méthode `execute(...)`, ou une méthode par intention proche (`src/application/ListExpenseNotes.ts`).
4. Les identifiants d'utilisateur reçus sont ceux de la session (`actor.id` passé par la route), jamais un id pris du corps de la requête.
5. Le test à côté, avec de faux ports typés par l'interface (`vi.fn`) : ni base ni serveur.
6. Le brancher dans `src/composition`, puis l'appeler depuis la route, la page serveur ou le worker.

## Exemples à copier

- `src/application/GetReceiptUrl.ts` et son test : lecture par un port, règle du domaine, erreur du domaine, puis stockage.
- `src/application/DecideExpenseNote.test.ts` : le test type avec de faux ports.
- `src/application/SubmitExpenseNote.ts` : opération en plusieurs étapes (reçu puis note), compensée en cas d'échec et rejouable (`Idempotency-Key`).

## Pièges

- 401 et 403 (session, rôle) restent dans la route (`requireRole`) ; le périmètre (note d'un autre, d'une autre entreprise → 404) se décide ici, par une règle du domaine.
- Une écriture et son événement d'outbox se font dans la même transaction : c'est l'adaptateur qui les fait ensemble (`src/adapters/PostgresExpenseNoteDecisionRepository.ts`), pas le cas d'usage en appelant deux ports l'un après l'autre.
- Upload S3 puis écriture en base : supprimer le reçu si l'écriture échoue, comme `SubmitExpenseNote`.
- Identifiants générés par `node:crypto` (`randomUUID`), seul module de Node permis ici.

## Vérifié par

- `scripts/architecture/architecture.test.ts` : la matrice ci-dessus (ni `pg`, ni `next`, ni adaptateur).
- Couverture unitaire mesurée ici : `npm run test:coverage`.

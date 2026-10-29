# src/worker — processus de l'outbox

Consignes du dossier, en complément du [CLAUDE.md](../../CLAUDE.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

Processus à part (`npm run worker`, lancé aussi par `npm run dev`), connecté sous `expense_worker`. Il prend les événements de `outbox_events` dont le type a un handler, les traite, puis gère relances et lettres mortes (`dead`). Tout traitement asynchrone, email ou OCR, passe par ici (ADR-003).

## Peut importer

Recopié depuis `scripts/architecture/layers.ts` par `npm run generate:architecture` : ne rien écrire entre les marqueurs. Un droit nouveau se justifie dans la PR (ADR-002).

<!-- début : imports permis -->

| Module | Peut importer |
|---|---|
| `src/worker` | `src/adapters`, `src/modules/expenses/application`, `src/modules/identity/application`, `src/modules/receipt-analysis/application`, `src/composition`, `src/modules/expenses/domain`, `src/modules/identity/domain`, `src/modules/receipt-analysis/domain`, `src/lib/db`, `src/lib/dbRole`, `src/lib/email`, `src/lib/log`, `src/lib/outbox`, `src/lib/telemetry`, `src/lib/tokens`, `src/ports`, `src/utils`, `pg` |

<!-- fin : imports permis -->

## Ajouter un traitement asynchrone

1. **Domaine** : le type `export const X = 'contexte.action'` et son payload (construction et garde `isXPayload`) dans le domaine de son module, comme `src/modules/expenses/domain/Notification.ts`. Le payload ne transporte que des ids et des données non sensibles : jamais de jeton ni d'URL pré-signée.
2. **Émission** : dans l'adaptateur, dans la même transaction que la donnée : `new PgEventOutbox(client).enqueue({ type, payload })`. L'événement n'existe que si la transaction est validée.
3. **Handler** : un fichier `src/worker/<contexte>Handlers.ts` qui exporte une fonction renvoyant des `OutboxHandlers`, ajoutée à `buildHandlers` dans `src/worker/handlers.ts`. Un type sans handler reste `pending` pour toujours.
   - court (email, écriture) : `handle(event, client)`, dans la transaction de l'événement ;
   - long (OCR, IA) : `run(event, signal)`, hors transaction, idempotent, qui s'arrête quand `signal` est annulé ;
   - `maxRetries` (et `backoffSeconds`) ; un échec définitif lève `NonRetryableError` (`src/ports/EventOutbox.ts`).
4. **Droits** : le worker n'a que ceux des migrations (`GRANT … TO expense_worker`, policies) : les ajouter par une migration nouvelle.
5. **Doc** : le type dans le tableau des événements de `docs/index.html` (vérifié par `npm run check`) et `docs/architecture/vues/outbox.mmd`.
6. **Tests** : la logique dans un cas d'usage, en Vitest ; le parcours en E2E avec `e2e/support/outbox.ts` (IDs `OUTBOX-*`, `NOTIF-*`).

## Exemples à copier

- `src/worker/notificationHandlers.ts` : `handle`, destinataires relus dans l'entreprise de l'événement.
- `src/worker/receiptAnalysis.ts` : `run`, détaché, délégué à un cas d'usage.

## Pièges

- Tout handler peut être rejoué : après un échec, ou à l'expiration du bail (5 min). Passer `event.id` comme clé d'idempotence quand le port le permet (`notifySubmitted(…, event.id)`).
- Les données relues sont bornées à l'entreprise de l'événement (`scopeToCompany`, posé par `src/worker/processNextEvent.ts`), jamais à un id pris du payload seul.
- Journal par `src/worker/log.ts` : des ids et des nombres, jamais d'adresse email (ADR-005 §5).

## Vérifié par

- `scripts/architecture/architecture.test.ts` : la matrice ci-dessus, chaque type d'événement cité dans la doc.
- `src/worker/handlers.test.ts`, et les E2E `OUTBOX-*` et `NOTIF-*`.

# ADR-006 — Stratégie de migration du code legacy

| | |
|---|---|
| Statut | **Proposée** |
| Date | 27 octobre 2026 |
| Auteur | Amalraj Soupramanien (WS1) |
| Validateur | Florent (PO) |
| Tickets | [2-536](https://linear.app/2-morgan/issue/2-536) |

## Contexte

L'[ADR-002](ADR-002-architecture-cible.md) fixe la cible : routes fines, cas d'usage, domaine pur, ports et adaptateurs. Elle ne dit pas **comment** passer de l'existant à cette cible sans casser la production. Ici, la production, ce sont les tests E2E rejoués par les correcteurs : 100 % de vert est exigé (ADR-005). La question vaut aussi pour la suite annoncée par l'ADR-002 §5 : une IA externe à la place de Tesseract, la facturation, l'international.

Le cours 5 donne trois patterns : **Strangler Fig**, **Branch by Abstraction** et **Big Bang**. Cette ADR les compare sur le code d'Expense.io et dit lequel s'applique à quel type de changement.

État mesuré le 27/10 sur `main` (2850991). Constats d'origine : [A1, A2 (audit WS2)](../audit/WS2-A1-A3.md).

| Indicateur | À l'origine | Aujourd'hui | Source |
|---|---|---|---|
| Fichiers de route avec SQL inline | 12/13 (A1) | 6/17 | `LEGACY_DB_ACCESS`, `eslint.config.mjs` |
| Fichiers en exception d'accès base à la création du lint (22/10) | 13 | 6 | même liste, historique git |
| Appels à `getPool()` hors de `src/lib/db.ts` | 12 fichiers | 0 | `LEGACY_GET_POOL`, vide depuis 2-481 |
| `domain/`, `ports/`, `adapters/` | 129 lignes jamais importées (A2) | 15 ports, 17 adaptateurs, 10 cas d'usage branchés | `src/` |
| Flèches interdites encore tolérées | — | 2 : `app/api → lib/db`, `app/api → lib/storage` | `LEGACY_EDGES`, `scripts/architecture/layers.ts` |
| SQL interpolé toléré | — | 1 : tri par liste blanche de `GET /api/expense-notes` | `LEGACY_SQL_INTERPOLATION` |

Il reste 6 routes legacy, toutes en lecture :

| Famille | Routes | Ce qui y reste | E2E qui les gardent |
|---|---|---|---|
| URL de reçu | `GET /api/expense-notes/[id]/receipt-url`, `GET /api/manager/…/[id]/receipt-url`, `GET /api/hr/…/[id]/receipt-url` | SQL de visibilité + appel direct à `lib/storage` | RECU-02, 05, 07, 08, ISO-01 |
| Listes | `GET /api/expense-notes`, `GET /api/manager/expense-notes`, `GET /api/hr/expense-notes` | SQL de liste, tri interpolé (employé) | NDF-11 à 13, MGR-01, RH-01, AUTH-10a, ISO-01 |

## Options

**A — Strangler Fig** (Fowler, choix par défaut du cours). Une façade reste devant le legacy, et le trafic passe au nouveau code route par route jusqu'à décommissionner l'ancien. La forme du cours met une façade réseau (API Gateway) devant **deux systèmes**. Expense.io est un seul monolithe : une gateway ajouterait un composant à déployer et à surveiller sans rien apporter. La façade existe déjà dans le code : c'est le **chemin HTTP et son contrat `openapi.yaml`**, stables (une API publiée est une promesse, cours 3). Derrière chaque route, l'implémentation bascule du SQL inline vers un cas d'usage. Les listes `LEGACY_*` jouent le rôle de la table de routage : elles disent ce qui reste à migrer, et la règle du dépôt (`CLAUDE.md`) interdit de les allonger.

**B — Branch by Abstraction**. Une interface (le **port**) se place devant le composant à changer ; les appelants passent par elle, puis une nouvelle implémentation remplace l'ancienne derrière un interrupteur. Le cours le relie à l'hexagonal : un port est déjà une abstraction, il suffit de remplacer l'adaptateur. Chez nous, `OcrPort`, `ReceiptStoragePort`, `EmailPort`, `NotificationPort` et `EventOutbox` existent. L'adaptateur est choisi dans `src/composition/`, qui joue le rôle de l'interrupteur. Le quiz du cours (remplacer OpenAI par un autre fournisseur) correspond à notre `TesseractOcrAdapter` remplacé par un adaptateur d'IA externe.

**C — Big Bang**. Réécrire les routes restantes en une seule PR, ou passer d'un coup aux micro-services (option C de l'ADR-002). Tout le risque tombe le jour de la bascule. Une réécriture perd les correctifs de cas limites accumulés (Spolsky). Le second système est sur-conçu (Brooks).

| Critère | A — Strangler Fig (code) | B — Branch by Abstraction | C — Big Bang |
|---|---|---|---|
| Ce qu'il migre bien | une route HTTP et son SQL | une dépendance externe (S3, OCR, SMTP) | — |
| Risque pour les E2E | faible : une route par PR, ses tests désignés | faible : contrat du port inchangé, tests unitaires du cas d'usage avec un faux adaptateur | élevé : toute la suite d'un coup |
| Retour arrière | `git revert` de la PR de la route | rebrancher l'ancien adaptateur dans `src/composition` | revert massif, conflits |
| Coût d'exploitation | nul, un seul déploiement | nul, une variable d'environnement de plus au plus | nul, mais pendant la réécriture rien ne se livre |
| Valeur livrée tôt | dès la première route | dès le premier adaptateur | à la fin seulement |
| Risque propre | **migration sans fin**, deux styles qui cohabitent | une abstraction de plus à maintenir | régressions concentrées, second système sur-conçu |

## Décision

Les trois patterns ne répondent pas au même besoin. On choisit **par type de changement** :

1. **Code legacy des routes → Strangler Fig au niveau du code (A).** Une famille de routes par PR, contrat et codes HTTP inchangés. Les E2E de la famille ci-dessus servent de garde. La PR retire ses fichiers de `LEGACY_DB_ACCESS` et, si elle la vide, l'entrée correspondante de `LEGACY_EDGES`. Ordre, par criticité :
   1. **URL de reçu** d'abord : ce sont des données sensibles (constat S2, règle 6 de `CLAUDE.md`), et c'est le seul endroit qui appelle `lib/storage` sans port. Un cas d'usage par rôle lit la note visible et demande l'URL à `ReceiptStoragePort`. La flèche `app/api → lib/storage` disparaît.
   2. **Listes** ensuite : la lecture passe par un repository. Le tri par liste blanche y descend, ce qui vide `LEGACY_SQL_INTERPOLATION`.

   La migration est **terminée** quand `LEGACY_DB_ACCESS`, `LEGACY_SQL_INTERPOLATION` et `LEGACY_EDGES` sont vides. Ce critère se vérifie en continu : `eslint.config.test.ts` échoue sur une entrée de `LEGACY_DB_ACCESS` ou de `LEGACY_SQL_INTERPOLATION` qui n'enfreint plus la règle, et `scripts/architecture/architecture.test.ts` sur une exception de `LEGACY_EDGES` qui ne sert plus. La PR de la route doit donc retirer ses entrées.
2. **Remplacement d'une dépendance externe → Branch by Abstraction (B)**, par les ports existants. Cela vaut pour l'OCR (Tesseract → IA externe), le stockage, l'email et la future facturation (`BillingPort`, abonné à `note.approved`, ADR-002 §5). Les ports suffisent aujourd'hui comme préparation : chaque dépendance n'a qu'un adaptateur, et un interrupteur sans seconde implémentation serait du code spéculatif (KISS, cours 2). **L'interrupteur s'ajoute avec le second adaptateur**, dans la même PR : une variable d'environnement lue dans `src/composition/`, l'adaptateur actuel par défaut, puis l'ancien retiré une fois la bascule faite (étapes 3 et 4 du pattern).
3. **Big Bang (C) : écarté.** Il n'est retenu pour aucune étape. Le périmètre restant (6 routes en lecture) se découpe sans difficulté.

Contre la **migration sans fin** : les listes `LEGACY_*` ne font que raccourcir (`CLAUDE.md` ; un ajout se refuse en revue, une entrée périmée fait échouer les tests), chaque étape a son ticket et le critère de fin ci-dessus est vérifié par `npm run check`.

Hors périmètre : l'international (une instance par région, ADR-001) relève du déploiement, pas d'une migration de code.

## Conséquences

- **Positives** : chaque étape se livre et se revert seule ; le reste à faire se lit dans trois listes ; les évolutions de l'ADR-002 §5 tiennent en un adaptateur, sans rouvrir les routes.
- **Négatives** : deux styles cohabitent tant que les listes ne sont pas vides. Le Strangler Fig sans façade réseau ne sait pas basculer une route à chaud : le retour arrière passe par un revert et un redéploiement.
- **Risque** : une PR qui migre une route et change en même temps son comportement. Parade : contrat inchangé, E2E de la famille verts sans modification (ADR-005 §2).
- **Dette soldée par l'application de cette ADR** : la fin d'A1 et d'A2 (audit WS2) pour les routes.
- **Tickets à créer** : (a) URL de reçu par cas d'usage et `ReceiptStoragePort` ; (b) listes par repository. Aucun ticket pour l'interrupteur : il naît avec le second adaptateur qui le justifie (décision 2).
- **État au 27/10** : (a) et (b) appliquées dans 2-536 (cas d'usage `GetReceiptUrl` et `ListExpenseNotes`). `LEGACY_DB_ACCESS`, `LEGACY_SQL_INTERPOLATION` et `LEGACY_EDGES` sont vides : la migration des routes est terminée. Contrat vérifié identique avant et après (statuts, ordre, corps JSON), suite E2E complète verte sans modification.

## Comportement observable

Aucun changement.

## Vérification

- `npm run lint` : un fichier retiré de `LEGACY_DB_ACCESS` qui accède encore à la base fait échouer le lint. `eslint.config.test.ts` : une entrée de liste qui n'enfreint plus la règle fait échouer le test. Un ajout se voit dans le diff et se refuse en revue.
- `scripts/architecture/architecture.test.ts` (dans `npm run check`) : une flèche interdite fait échouer le test, une exception de `LEGACY_EDGES` qui ne sert plus aussi.
- E2E de la famille migrée, par ID (tableau du contexte), verts sans modification dans la PR.

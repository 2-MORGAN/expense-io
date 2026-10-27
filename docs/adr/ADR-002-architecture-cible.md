# ADR-002 — Architecture cible

Statut : **Acceptée** le 20/10/2026 par le PO (Florent), après amendement pour s'aligner sur les ADR-001, 003 et 004 (ticket [2-470](https://linear.app/2-morgan/issue/2-470)). Antoine relit l'amendement dans la PR #9 ; un désaccord donne lieu à un nouvel amendement.
Date : 2026-10-14, amendée le 2026-10-20. Auteur : Antoine Blumenroeder (WS2). Périmètre : fork `expense-io`, HEAD `4fad1d3`.
Références : `CLAUDE.md`, [`docs/audit/WS2-A1-A3.md`](../audit/WS2-A1-A3.md), [ADR-001](ADR-001-isolation-multi-tenant.md), [ADR-003](ADR-003-ocr-soumission-notifications.md), [ADR-004](ADR-004-contrat-api.md), [ADR-005](ADR-005-harnais-de-validation.md).

> **Ce qui a changé le 20/10.** Cette ADR décide le **style et le découpage du code**. Elle ne redécide plus ce que tranchent les autres ADR et y renvoie :
>
> | Sujet | Avant l'amendement | Désormais |
> |---|---|---|
> | Codes HTTP | « Garder les codes actuels » | 401 sans session, 403 rôle refusé (PR #8), 404 si non visible, format de l'ADR-004 |
> | Isolation | `WHERE` manuels, RLS dans un sujet dédié | ADR-001 : RLS effective sous un rôle restreint, `WHERE` conservés en défense en profondeur |
> | Inscription | Invariant « premier compte d'un domaine → RH » | Faille S7 corrigée par invitations (ADR-001, 2-496) |
> | Création de note | « Transaction + compensation » | ADR-003 : upload d'abord, puis une seule transaction SQL |
> | OCR | Appelé par la création de note via `SuggestionPort` | Aide au remplissage seulement, puis asynchrone (ADR-003, 2-503) |
> | International | Devises et formats | Une instance par région (ADR-001) ; langue canonique de l'API (ADR-004) |
> | Non-objectifs | Aucun schéma, aucune dépendance | Une seule migration propre à cette ADR (auteur et date de décision, B16) ; les autres migrations et `sharp` sont décidés par les ADR-001 et 003 |
>
> Ajouts : B8 et B16 dans le domaine Validation (§3.2), tickets (§6).

## 1. Contexte

Les 13 routes métier sous `src/app/api/` mélangent HTTP, droits, SQL et règles métier :

- `auth()` et garde de rôle dans 13/13 routes, garde copiée 10 fois sans helper (`manager/...`, `hr/...`).
- SQL inline dans 12/13 routes via `withUserScope()` / `getPool()`, règle métier inline dans 11/13 (`row.status !== 'pending'` → `409` dans 4 routes de décision, `JOIN users ON manager_id` au lieu de `User.canManage()`, `WHERE role='manager' AND manager_id IS NULL` au lieu de `User.isRootManager()`).
- Sérialisation des notes dupliquée (7 constructions du DTO `Note`, audit WS4 Q3), approve/reject manager et RH identiques à ~90 %, manager approve et reject à une ligne près.
- `POST /api/expense-notes` enchaîne INSERT, upload S3 et UPDATE sur 2 connexions, sans transaction commune (traité par l'ADR-003).
- Failles relevées au passage (S1 tri concaténé, S2 reçu manager, S3 manager cross-tenant, S5 secret en dur, S6 stacktrace, OCR sans limite) : traitées par les ADR-001, 003 et 004, pas ici.

Pendant ce temps `src/domain/` (74 lignes), `src/ports/` (7), `src/adapters/` (23) et `src/utils/` (25) existent mais ne sont jamais importés : 8 fichiers, 129 lignes mortes, double vérité.

Contraintes : ne pas casser le comportement observable hors décisions des ADR acceptées (les E2E sont rejoués par les correcteurs), petites PR, pas de refacto opportuniste.

Question du ticket : quel style, quels domaines, où va quoi, et comment la cible absorbe la suite (IA asynchrone, facturation, international) sans l'implémenter.

## 2. Options

### Option A — Monolithe nettoyé (helpers + lint, sans hexagone)

Extraire `requireRole()`, `toExpenseNoteDto()`, `decideExpenseNote()`, sans brancher `domain/ports/adapters`.

- Pour : le plus rapide, plus petite diff.
- Contre : règles toujours couplées à PG/S3/Next, S3/OCR/notifications non substituables, chaque évolution (file d'attente, facturation) redevient un copier-coller. L'hexagone reste mort.

### Option B — Monolithe modulaire hexagonal léger (retenue)

Un seul déploiement Next.js + PG + S3. Brancher l'existant : `route.ts` fine → cas d'usage → `domain/` pur → `ports/` → `adapters/` + `withUserScope()`. Pas de nouveau service.

- Pour : simple pour une petite équipe, un seul pipeline, transactions PG conservées, règles testables sans infra, ports mockables. C'est aussi la forme retenue par l'ADR-001 pour le module de permissions (cours 2, étape 2).
- Contre : discipline d'imports à tenir (lint + revue), migration en plusieurs PR.

### Option C — Micro-services (écartée)

Un service déployable par domaine, chacun sa base.

- Pour : scaling indépendant, frontières fortes.
- Contre : disproportionné pour 3 tables et 13 routes. Transforme une transaction locale en saga distribuée, multiplie l'auth, l'isolation tenant, la CI et l'observabilité.

| Critère | A nettoyé | B hexagonal léger | C micro-services |
|---|---|---|---|
| Simplicité pour l'équipe | oui | oui | non |
| Règles testables sans PG/S3 | non | oui | oui, au prix fort |
| Substitution S3/OCR/notifications | non | oui (ports) | oui |
| Opérations multi-étapes | fragile | transaction locale | saga distribuée |
| Migration sans casser les E2E | facile | incrémentale | big-bang |
| Absorbe IA async / facturation / international | non | oui, par ports | oui |

## 3. Décision

### 3.1 Style : B.

### 3.2 Domaines : 3 cœurs, 2 extensions en ports, l'international en déploiement.

Pas de nouvelle fonctionnalité dans ce refacto : on nomme où ira quoi. Les changements de schéma décidés par d'autres ADR (invitations, idempotence, outbox) se rangent dans ces domaines.

- **Identity & Tenancy** (`src/domain/identity/`) : `Company`, `User`, `Invitation`. Invariants : un utilisateur appartient à une seule entreprise ; `manager_id` dans la même entreprise et différent de soi ; rôle et entreprise relus en base à chaque appel (S9) ; **le domaine email ne donne aucun droit** : s'inscrire sans invitation crée sa propre entreprise, rejoindre une entreprise passe par une invitation de sa RH (ADR-001, S7). Cas d'usage : `GET /hr/users`, `PUT /hr/users/[id]/manager`, inscription, invitation, connexion.
- **Expense** (`src/domain/expense/`) : `ExpenseNote`, `Receipt`. Invariants : `amount > 0` avec 2 décimales au plus, description non vide, date `YYYY-MM-DD` valide, reçu vérifié sur son contenu (ADR-004 §6), clé S3 non devinable préfixée par tenant (ADR-001). Cas d'usage : `GET/POST /api/expense-notes` (upload d'abord puis transaction, `Idempotency-Key` : ADR-003), `.../[id]/receipt-url`, suggestion OCR.
- **Validation** (`src/domain/validation/`) : `Decision`, `WhoCanDecide`. Invariants : seule une note `pending` se décide (`409` sinon) ; manager = ses subordonnés directs, RH = managers racines de son entreprise.
  - **B8, deux décisions simultanées** : la décision s'écrit `UPDATE … WHERE status = 'pending'` ; la seconde ne touche aucune ligne, renvoie 409 et n'émet aucun événement (ADR-003). Porté par 2-488.
  - **B16, traçabilité des décisions** (décision du PO du 20/10) : chaque note garde **qui l'a tranchée et quand** (`decided_by`, `decided_at`), remplis par le cas d'usage de décision dans la même requête que le statut. Une migration avec `down`, colonnes nulles tant que la note est `pending` ; les notes déjà tranchées restent sans auteur connu. Les réponses JSON actuelles ne changent pas. L'historique complet (toutes les étapes, motif de rejet) reste pour plus tard, alimenté par l'événement `note.decided` de l'outbox de l'ADR-003. Le volet logs de B16 relève de l'ADR-004 (`requestId`) et de l'ADR-005 (T9).
  - Séparé d'Expense car acteurs, cycle de vie et évolutions (seuils, délégation, audit) diffèrent ; la facturation future s'abonne à la décision, pas à la création.
- **Extensions par ports, sans implémentation nouvelle ici** : `OcrPort` (Tesseract aujourd'hui, appelé depuis le worker quand l'OCR passe en asynchrone, 2-503) ; `BillingPort` alimenté par l'événement `note.approved`, jamais appelé en direct par la décision.
- **International** : c'est d'abord un sujet de déploiement et de cohérence (cours 2, étape 4, CAP). Décision de l'ADR-001 : **une instance (application + base) par région**, une entreprise a une seule région d'attache, aucune base répliquée entre régions. L'architecture B le permet sans changement : le monolithe se déploie à l'identique par région et l'outbox reste locale à sa base. Côté contrat, l'API répond en anglais avec des codes stables et le front traduit (ADR-004). Les devises demandent une décision métier distincte (ADR-004 §6) : rien n'est prévu dans le schéma ici.

Fusion Expense + Validation écartée : elle recréerait le module fourre-tout des routes actuelles.

### 3.3 Où va quoi

| Couche | Rôle | Interdit |
|---|---|---|
| `route.ts` | authentifier, valider l'entrée selon le contrat (ADR-004), appeler un cas d'usage, formater la réponse au format de l'ADR-004 | SQL (`client.query`, `getPool`), règle métier (`pending`, `JOIN` de droits), appel direct à `lib/storage` / `lib/ocr` |
| `src/application/` (cas d'usage) + `src/domain/*/` | orchestrer ; règles pures, sans `pg`/`next`/`aws` | import d'infrastructure dans `domain/` |
| `src/ports/` | interfaces (`ReceiptStoragePort`, `NotificationPort`, `OcrPort`, `EventOutbox`, futur `BillingPort`) | implémentation |
| `src/adapters/` + `src/lib/` | implémentations ; accès base via `withUserScope()`, sous le rôle restreint et la RLS de l'ADR-001 | règle métier |
| worker (`npm run worker`) | adaptateur entrant, comme les routes : consomme l'outbox (ADR-003) | règle métier propre |
| `migrations/` | seule vérité du schéma, horodatée, avec `down` | DDL dans le code |
| `src/components/`, pages | UI mince ; un composant serveur (page sans `'use client'`) peut appeler un cas d'usage par `src/composition`, comme une server action (amendement du 27/10) | SQL, droits, `lib/db`, adaptateurs ; `src/composition` depuis un fichier `'use client'` |

> **Amendement du 27/10/2026** (PO, réponse WS2 à la PR #31) : le schéma du §4 (« UI → route fine ») vise le code exécuté dans le navigateur. Un composant serveur de Next.js s'exécute côté serveur, comme une server action, déjà autorisée à appeler la composition ; le faire passer par une route `/api` ajouterait un aller-retour HTTP vers soi-même. Vérifié par `scripts/architecture/architecture.test.ts`. Aucun changement d'API.

Conventions de `CLAUDE.md` inchangées : TS strict sans `any`, alias `@/*`, montants `numeric` → `number` à la frontière, dates `YYYY-MM-DD` brutes (parser OID 1082 inchangé).

## 4. Schéma cible

Constaté :

```text
UI → route.ts (auth + droits + SQL + métier + format)
       ├── lib/db (withUserScope/getPool) → PG brut, superuser
       ├── lib/storage → S3 direct
       └── lib/ocr → Tesseract synchrone
domain/ ports/ adapters/ utils/ = orphelins (0 import)
```

Cible :

```text
UI/pages → route.ts fine ──┐
worker (outbox) ───────────┴→ cas d'usage → domain/ pur
                                 ├── ports/ → adapters/ (S3, OCR, notifications)
                                 └── repositories via withUserScope() → PG (rôle restreint + RLS)
migrations/ en dessous, transverse.
```

Exemple : `POST manager/.../[id]/approve` devient `requireRole('manager')` puis `decideExpenseNote({ id, decision: 'approved', actor })`. Le cas d'usage charge la note via le repository (404 si non visible), applique `WhoCanDecide` et la transition, écrit statut, auteur et date avec `WHERE status = 'pending'` (409 sinon) et enregistre l'événement `note.decided` dans l'outbox. La réponse suit le format et les codes de l'ADR-004.

## 5. Et la suite, sans l'implémenter

- **IA et OCR asynchrones** : le cas d'usage de suggestion ne change pas ; seul l'appelant passe de la route au worker (ADR-003, 2-503). L'IA externe sera un second adapter du même port.
- **Facturation** : abonnée à `note.approved` ; la décision ne connaît pas la facture.
- **International** : un déploiement par région (ADR-001), contrat en anglais avec codes (ADR-004). Réouverture si un workflow doit traverser deux régions.

Chaque extension tient en un port, un adapter ou un déploiement, sans rouvrir les routes ni le domaine.

## 6. Plan et tickets

Ordre : **correctifs de sécurité d'abord** (2-471, décision du PO), puis les helpers, puis le branchement de l'hexagone. Chaque PR garde le comportement observable ; tout écart passe par une ADR acceptée (ADR-005).

| Étape | Contenu | Ticket | Dépend de |
|---|---|---|---|
| 1. Helpers communs | `requireRole()` (401/403), sérialiseur unique de note, décision approve/reject unique pour manager et RH ; aucun changement visible | [2-487](https://linear.app/2-morgan/issue/2-487) | 2-471, cette ADR ; types du contrat de 2-486 si disponibles |
| 2. Hexagone sur « valider une note » | cas d'usage `decideExpenseNote`, `WhoCanDecide`, repository, B8, B16 (auteur et date de décision), tests unitaires ; puis généralisation et lint interdisant SQL, `lib/storage` et `lib/ocr` dans `route.ts` | [2-488](https://linear.app/2-morgan/issue/2-488) | 2-487, Vitest et lint d'architecture (2-489) |

**Suite (27/10)** : la migration des dernières routes (listes, URL de reçu) et la façon de migrer sans casser les E2E sont décidées par l'[ADR-006](ADR-006-strategie-de-migration.md) (2-536). La règle d'accès au reçu (`canViewReceipt`) est rangée dans le domaine Expense, conformément au §3.2.

Hors de ce plan, décidés ailleurs : isolation et invitations (ADR-001 : 2-471, 2-478, 2-496, 2-481), soumission fiable, OCR et notifications (ADR-003 : 2-475, 2-476, 2-484, 2-503), erreurs et contrat (ADR-004 : 2-485, 2-486).

## 7. Conséquences

- Positif : droits en un seul endroit, règles testables sans infrastructure, S3/OCR/notifications substituables, suite absorbable sans réécriture.
- Négatif : discipline d'imports à tenir en revue et par le lint, quelques PR de migration avant le gain complet.
- Risques : disperser la logique en multipliant les micro-domaines (on s'en tient aux 3 cœurs) ; réintroduire du SQL en route sous pression (le lint bloque) ; conflits avec les correctifs de sécurité dans les mêmes routes (d'où l'ordre du §6).
- Non-objectifs de ce refacto : aucune fonctionnalité de facturation, d'IA ou de devise ; un seul changement de schéma propre à cette ADR (B16).

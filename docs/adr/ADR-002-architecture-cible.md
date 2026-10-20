# ADR-002 — Architecture cible

Statut : **proposée — amendement en cours** (ticket [2-470](https://linear.app/2-morgan/issue/2-470), Antoine). Non validée par le PO.

> **Note du PO (20/10/2026), en attendant l'amendement.** Seules les ADR « Acceptée » font foi (ADR-005). Sur les points suivants, ce texte contredit des décisions déjà prises ; **c'est l'autre ADR qui s'applique** :
>
> | Ce que dit l'ADR-002 | Ce qui s'applique |
> |---|---|
> | « Garder les codes actuels » (§3.3, §4) | 401 sans session, 403 rôle refusé (PR #8) ; 404 pour une ressource non visible ; format d'erreur de l'ADR-004 |
> | Isolation par `WHERE` manuels, RLS dans un sujet dédié (§6) | ADR-001 : RLS sous un rôle applicatif restreint, en plus des filtres applicatifs (2-478, 2-481) |
> | Invariant « premier compte d'un domaine → crée l'entreprise et devient `hr_admin` » (§3.2) | Faille S7 : inscription sans invitation = sa propre entreprise, rejoindre = invitation de la RH (ADR-001, 2-496) |
> | Création de note par « transaction + compensation » (§2, §6) | ADR-003 : upload d'abord, puis une seule transaction SQL (2-476) |
> | `POST expense-notes` appelle `SuggestionPort` (§5) | La création n'appelle pas l'OCR ; OCR asynchrone par `receipt-analyses` (ADR-003, ADR-004 §8.3, 2-503) |
> | Non-objectifs : aucun changement de schéma, aucune dépendance (§7) | Valent pour le seul refacto de l'ADR-002 ; les migrations des ADR-001 et 003 et `sharp` en dépendance directe sont décidés ailleurs |
>
> Reste à traiter dans l'amendement : l'international au sens du cours (latence, plusieurs régions, renvoi à l'ADR-001), B8 et B16 dans le domaine Validation, et les tickets (2-487, 2-488).
Date : 2026-10-14. Périmètre : fork `expense-io`, HEAD `4fad1d3`.
Livrable ticket : ce fichier, à exporter dans SharePoint ARLA `Rendu/W2/`.
Références : `CLAUDE.md`, `docs/audit/WS2-A1-A3.md`, `migrations/1700000000001_init-schema.sql`.

## 1. Contexte

Les 13 routes métier sous `src/app/api/` mélangent HTTP, droits, SQL et règles métier :

- `auth()` + `401/403` dans 13/13 routes, garde rôle copiée 10 fois sans helper (`manager/...`, `hr/...`).
- SQL inline dans 12/13 routes via `withUserScope()` / `getPool()`, règle métier inline dans 11/13 (`row.status !== 'pending'` → `409` dans 4 routes decide, `JOIN users ON manager_id` au lieu de `User.canManage()`, `WHERE role='manager' AND manager_id IS NULL` au lieu de `User.isRootManager()`).
- `toExpenseNote` copié 3 fois, approve/reject manager vs RH à ~90 % identiques, manager approve vs reject à 1 ligne près.
- `POST /api/expense-notes` (`src/app/api/expense-notes/route.ts:88-106`) fait INSERT (scope) puis `uploadReceipt` puis UPDATE via `getPool()` hors scope : 3 étapes, 2 connexions, 0 transaction commune.
- Tri concaténé `ORDER BY ${sort}` (`route.ts:46`), `receipt-url` manager sans vérification de rattachement, `PUT hr/users/[id]/manager` (`route.ts:39-42`) sans `company_id` sur le manager, `AUTH_SECRET` en dur (`lib/auth.ts:8`), stacktrace au client (`lib/errors.ts:5`), OCR Tesseract synchrone sans limite de taille (`lib/ocr.ts:109-134`).

Pendant ce temps `src/domain/` (74 lignes), `src/ports/` (7 lignes), `src/adapters/` (23 lignes), `src/utils/` (25 lignes) existent mais ne sont jamais importés par les routes : 8 fichiers, 129 lignes mortes, double vérité.

Contraintes absolues : ne pas casser le comportement observable (codes, JSON, parcours UI — les E2E sont rejoués par les correcteurs), petites PR, pas de refacto opportuniste, pas de nouvelle dépendance sans justification.

Question du ticket : quel style, quels domaines, où va quoi, et comment la cible absorbe la suite (IA asynchrone, facturation, international) sans l'implémenter.

## 2. Options

### Option A — Monolithe nettoyé (helpers + lint, sans hexagone)

Extraire `requireRole()`, `toExpenseNoteRow()`, `decideExpenseNote()`, whitelister `?sort=`, corriger les `WHERE company_id` au fil de l'eau. Ne pas brancher `domain/ports/adapters`.

- Pour : le plus rapide, plus petite diff, zéro courbe d'apprentissage.
- Contre : ne règle ni la testabilité (règles toujours couplées à PG/S3/Next), ni la substitution (S3, OCR, notif non mockables), ni la suite (file d'attente, billing, devise = nouveau copier-coller). L'hexagone reste mort.

### Option B — Monolithe modulaire hexagonal léger (retenue)

Garder un seul déploiement Next.js + PG + S3. Brancher l'existant : `route.ts` fine → cas d'usage → `domain/` pur → `ports/` → `adapters/` + `withUserScope()`. Pas de split de tables, pas de nouveau service.

- Pour : KISS pour une petite équipe de cours, un seul pipeline, transactions PG conservées (atomicité insert + upload + update compensée), règles testables sans infra, ports mockables, emplacements vides pour la suite sans coder.
- Contre : demande de la discipline d'imports (à faire respecter par lint + revue), migration en plusieurs PR.

### Option C — Micro-services (écartée)

Découper par domaine déployable (expense-service, validation-service, identity-service, billing-service), chacun sa base, com synchrone ou events.

- Pour : scaling indépendant, frontières fortes.
- Contre : overkill ici. Distribue une transaction locale (insert + S3 + update) en saga compensée, multiplie l'infra, l'auth, l'isolation tenant (`company_id` à propager partout), la CI et l'observabilité — pour 3 tables et 13 routes. Contredit KISS et « petites PR sans casser les E2E ».

Comparatif résumé :

| Critère | A nettoyé | B hexagonal léger | C micro-services |
|---|---|---|---|
| KISS / équipe cours | oui | oui | non |
| Test règles sans PG/S3 | non | oui | oui, au prix fort |
| Substitution S3/OCR/notif | non | oui (ports) | oui |
| Atomicité multi-étapes | fragile | transaction + compensation locale | saga distribuée |
| Coût migration E2E-safe | faible | moyen, incrémental | élevé, big-bang |
| Absorbe IA async / billing / i18n | non | oui, en ports vides | oui |

## 3. Décision

### 3.1 Style : B.

### 3.2 Domaines : 3 cœurs maintenant, 2 extensions en ports vides, 1 transverse.

Pas de création de tables, pas de nouvelles features. On nomme juste où ira quoi.

- **Identity & Tenancy** (`src/domain/identity/`) : `Company`, `User`. Invariants : un user = une `company_id`, `manager_id` même entreprise et `!= self`, signup premier compte d'un domaine crée la company et devient `hr_admin`. Use cases actuels : `GET /hr/users`, `PUT /hr/users/[id]/manager`, signup/login.
- **Expense** (`src/domain/expense/`) : `ExpenseNote`, `Money`, `Receipt`. Invariants : `amount > 0`, description non vide, date `YYYY-MM-DD`, MIME + 10 Mo, clé S3 non devinable préfixée par tenant. Use cases : `GET/POST /api/expense-notes`, `.../[id]/receipt-url` (pré-signée courte après contrôle).
- **Validation** (`src/domain/validation/`) : `Decision`, `WhoCanDecide`. Invariants : seul `pending` décidable (`409`), manager = son équipe directe, RH = managers racines de sa company. Use cases : 4 approve/reject, 2 listes manager/RH. Séparé d'Expense car acteurs, cycle de vie et évolutions (seuils, délégation, audit) diffèrent ; la facturation future s'abonne à la décision, pas à la création.
- **Futurs en ports vides, sans implémentation** : `SuggestionPort` (aujourd'hui Tesseract synchrone, demain même port appelé depuis une queue), `BillingPort.onNoteApproved` (event, jamais appelé en direct par decide).
- **International transverse** : `Money{amount, currency}`, `ExpenseDate`, `format.ts`. Aujourd'hui `numeric(10,2)` sans devise ; on prévoit colonne `currency` + value objects, sans conversion.

Fusion Expense + Validation écartée : recréerait le god-module route pour 2 règles aujourd'hui confondues mais à évolutions disjointes.

### 3.3 Où va quoi — règle simple.

| Couche | Rôle | Interdit |
|---|---|---|
| `route.ts` | authentifier (`auth()`), valider l'entrée (`utils/validators`), appeler un cas d'usage, formater JSON, garder codes actuels | SQL (`client.query`, `getPool`), règle métier (`pending`, `JOIN` droits), appel direct `lib/storage` / `lib/ocr` |
| `src/application/` + `src/domain/*/` | règles pures, sans `pg/next/aws` | import infra |
| `src/ports/` | interfaces (`ReceiptStoragePort`, `NotificationPort`, nouveau `SuggestionPort`, futur `BillingPort`) | implémentation |
| `src/adapters/` + `src/lib/` | implémentations via `withUserScope()`, jamais `getPool()` direct pour du tenant | règle métier |
| `migrations/` | seule vérité schéma, horodatée + `down`, jamais d'édition d'existant | DDL en route |
| `src/components/`, pages | UI mince | SQL, droits |

Conventions reprises de `CLAUDE.md` : TS strict sans `any`, alias `@/*`, montants `numeric` → `number` à la frontière, dates `YYYY-MM-DD` brutes (parser OID 1082 inchangé), erreurs `application/problem+json` sans stacktrace (chantier dédié, pas au passage).

## 4. Schéma cible

Constaté :

```text
UI → route.ts (auth + droits + SQL + métier + format)
       ├── lib/db (withUserScope/getPool) → PG brut
       ├── lib/storage → S3 direct
       └── lib/ocr → Tesseract synchrone
domain/ ports/ adapters/ utils/ = orphelins (0 import route)
```

Cible :

```text
UI/pages → route.ts fine → cas d'usage → domain/ pur
                               ├── ports/ → adapters/ (S3, suggestion, notif)
                               └── repository via withUserScope() → PG (WHERE company_id)
migrations/ en dessous, transverse à tous.
```

Exemple POC : `POST manager/.../[id]/approve` devient `requireRole('manager')` + `decideExpenseNote({id, decision:'approved', actor})` qui charge via repository, applique `ExpenseNote.approve()` + `WhoCanDecide`, update, émet `note.approved` (sans consommateur pour l'instant), retourne le même JSON et les mêmes codes (`401/403/404/409`).

## 5. Et la suite — sans l'implémenter.

- **IA asynchrone** : sortir `suggestFields()` du chemin HTTP. Cible : `POST receipt-suggestion` et `POST expense-notes` appellent `SuggestionPort` ; aujourd'hui `TesseractSuggestionAdapter` synchrone ; demain même port depuis job/queue avec statut `suggestion_pending`, limite de taille et timeout. Aucun changement de `domain/expense`.
- **Facturation** : `Validation` émet `note.approved` ; futur `BillingAdapter` s'abonne. Decide ne connaît pas la facture.
- **International** : `Money`, `ExpenseDate`, whitelist `?sort=`, colonne `currency` future. Pas de conversion ni de TVA dans cette ADR.

Chaque extension tient en un port + un adapter, sans rouvrir les routes ni le domaine.

## 6. Impacts par chantier et plan

Ordre repris de l'audit : A3 (quick win helpers) → A1 (extraction route par route) → A2 (POC puis branchement hexagone). Chaque PR garde codes, JSON et parcours UI ; tout écart noté dans la PR.

| Chantier dette | Traitement dans cette cible | Hors périmètre ici |
|---|---|---|
| Injection `?sort=` | whitelist explicite dans cas d'usage liste | — |
| IDOR `manager receipt-url`, cross-tenant `hr/.../manager` | contrôle `company_id` + rattachement dans repository / `WhoCanDecide`, 404 si non visible | — |
| RLS contournée (superuser, policy RH sans `company_id`) | isolation par `WHERE` manuels via `withUserScope()`, RLS durcie dans sujet dédié | pas de bascule RLS-only ici |
| `AUTH_SECRET` en dur, stacktrace (`lib/errors.ts`) | sujets dédiés, format `problem+json` | pas corrigé au passage |
| Reçus S3 devinables (`receipts/<seq>`) | clés non devinables préfixées tenant + pré-signée courte, sujet dédié | pas de migration de clés ici |
| Création NDF non atomique, OCR synchrone | transaction + compensation documentée, `SuggestionPort` | pas de queue ni de billing ici |
| Tests / CI / OpenAPI / observabilité | règles pures testables, 1 test POC approve, contrats JSON gelés | pas de CI ni d'OpenAPI ici |

Plan : PR1 helpers (`requireRole`, `toExpenseNoteRow`, `decideExpenseNote`) + tests ; PR2 POC `manager approve` via domaine + `S3ReceiptAdapter` sur 1 reçu + 1 validateur ; PR3 généralisation + lint interdisant `client.query/getPool/lib/storage/lib/ocr` en `route.ts`. Règle stricte comme cible, migration strangler en pratique pour ne pas casser les E2E.

## 7. Conséquences

- Positif : droits en un seul endroit, règles testables, S3/OCR/notif substituables, suite absorbable sans réécriture, E2E préservés.
- Négatif : discipline d'imports à tenir en revue + lint, quelques PR de migration avant gain plein.
- Risques : disperser la logique si on multiplie les micro-domaines — on se limite aux 3 cœurs ; réintroduire du SQL en route sous pression — le lint bloque.
- Non-objectifs : aucune feature billing/IA/i18n, aucun changement de schéma, aucune nouvelle dépendance.

Décision proposée : adopter B avec ce découpage et ce plan. En cas de désaccord, trancher par amendement ici avant code.

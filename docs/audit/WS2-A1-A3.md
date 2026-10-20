# WS2 — Audit A1 / A2 / A3 : couplage des routes, hexagone inutilisé, rôles dupliqués

Date : 2026-10-10. Périmètre : fork `expense-io`, HEAD `4fad1d3`.
Portée : `src/app/api/**/route.ts` (13 routes métier + 1 route auth), `src/domain/`, `src/ports/`, `src/adapters/`, `src/utils/`, `src/lib/`.

Méthode : lecture des 13 routes + `lib/db.ts`, `lib/auth.ts`, comptages par `grep` / `diff` / `wc -l` (commandes en annexe). Aucune exécution SQL, aucun changement de comportement.

## 1. Schéma des dépendances actuelles

État constaté : les routes appellent directement l'infrastructure. Le domaine et les ports existent mais ne sont pas importés par les routes.

```text
Actuel (constaté par grep des imports)

  navigateur / UI (pages, components)
        |
        v
  src/app/api/**/route.ts  (13 routes métier)
   |      |      |      |
   |      |      |      +---> lib/storage.ts (S3) : 4 routes reçus
   |      |      +------------ lib/ocr.ts : 1 route suggestion
   |      +------------------- lib/db.ts : withUserScope / getPool (12/13 routes)
   +-------------------------- lib/auth.ts : auth() (13/13 routes)
        |
        v
  pg (SQL brut inline) + S3 + Tesseract

Orphelins (0 import depuis les routes) :
  src/domain/ExpenseNote.ts ─┐
  src/domain/User.ts ────────┤──> jamais importés par route.ts
  src/ports/*.ts ────────────┤    (seul adapters/* importe ports/*)
  src/utils/*.ts ────────────┘
  src/adapters/*.ts ─────────┘    (jamais importés par route.ts)
```

Cible rappelée par `CLAUDE.md` (non mise en place) :

```text
Cible (règle de placement attendue)

  route.ts (fin : auth, validation entrée, appel cas d'usage, format réponse)
        |
        v
  cas d'usage / domain/ (règles : statuts, qui valide quoi, calculs)
        |
        +---> ports/ (interfaces ReceiptStoragePort, NotificationPort)
                    |
                    v
              adapters/ (S3, console, OCR) + lib/db via withUserScope
```

## 2. A1 — Chaque route mélange HTTP, droits, SQL et règles métier

### Emplacement dans le code

Toutes les routes métier sous `src/app/api/` :

- employé : `expense-notes/route.ts` (GET + POST), `expense-notes/[id]/receipt-url/route.ts`, `expense-notes/receipt-suggestion/route.ts`
- manager : `manager/expense-notes/route.ts`, `manager/expense-notes/[id]/approve/route.ts`, `manager/expense-notes/[id]/reject/route.ts`, `manager/expense-notes/[id]/receipt-url/route.ts`
- RH : `hr/expense-notes/route.ts`, `hr/expense-notes/[id]/approve/route.ts`, `hr/expense-notes/[id]/reject/route.ts`, `hr/expense-notes/[id]/receipt-url/route.ts`, `hr/users/route.ts`, `hr/users/[id]/manager/route.ts`

Contre-exemple le plus dense : `src/app/api/expense-notes/route.ts` : parsing `formData`, validation métier (`amount <= 0`, type MIME, 10 Mo), `INSERT`, `uploadReceipt`, `UPDATE receipt_key` hors transaction (l.88-106), mapping `toExpenseNote` (l.18-29), tri concaténé `ORDER BY ${sort}` (l.46).

Décisions métier codées en SQL/HTTP au lieu du domaine : `row.status !== 'pending'` → `409` dans 4 routes decide, `JOIN users u ON u.manager_id = $1` (manager) et `u.role = 'manager' AND u.manager_id IS NULL AND u.company_id = ...` (RH) au lieu de `User.canManage()` / `User.isRootManager()`.

### Chiffres

| Responsabilité par route | Nb routes concernées / 13 |
|---|---|
| `auth()` + réponse `401/403` HTTP | 13/13 (100 %) |
| SQL inline (`client.query` ou `getPool().query`) | 12/13 (92 %, seule `receipt-suggestion` fait de l'OCR sans SQL) |
| Règle métier inline (`pending`, `JOIN` manager/RH, validation montant) | 11/13 |
| Mapping/format inline (`toExpenseNote` ou objet JSON construit à la main) | 7/13 (3 définitions `toExpenseNote` + 4 constructions inline dans approve/reject) |
| Appel externe inline (`lib/storage`, `lib/ocr`) | 5/13 |

Cas atomique : `POST expense-notes` fait `INSERT` (scope) puis `uploadReceipt` puis `UPDATE` via `getPool()` hors scope, sans compensation : 3 étapes, 2 connexions, 0 transaction commune.

### Impact

- Chaque évolution (nouveau statut, nouveau rôle, nouveau format) touche N routes au lieu d'un module : risque d'oubli et de divergence (déjà visible : `401` côté manager contre `403` côté RH pour le même cas non autorisé).
- Test impossible sans Postgres + S3 + Next : aucune règle n'est testable isolément.
- Sécurité : la règle d'autorisation est recodée dans chaque `WHERE` ; un oubli = IDOR (ex. `manager/.../receipt-url/route.ts:17` sans vérification de rattachement, commentaire l.14-16 l'assume).

### Criticité × effort

- Criticité : haute (4/5). Chemin critique NDF + surface sécurité.
- Effort de résorption : moyen (3/5). Extraction vers fonctions/cas d'usage + interdiction du SQL en route par lint, route par route, sans changer les contrats JSON/codes.
- Priorité : en premier, car A2 et A3 en dépendent.

## 3. A2 — Dossiers hexagonaux existants mais jamais utilisés

### Emplacement dans le code

- `src/domain/ExpenseNote.ts` (45 l.), `src/domain/User.ts` (29 l.)
- `src/ports/ReceiptStoragePort.ts` (4 l.), `src/ports/NotificationPort.ts` (3 l.)
- `src/adapters/S3ReceiptAdapter.ts` (12 l.), `src/adapters/ConsoleNotificationAdapter.ts` (11 l.)
- `src/utils/validators.ts` (13 l.), `src/utils/format.ts` (12 l.)

### Chiffres

- Total code mort : 8 fichiers, 129 lignes (`wc -l` : 45+29+3+4+11+12+12+13).
- Imports depuis `src/app/api` ou `src/app/*/page.tsx` : 0 pour `domain/`, 0 pour `ports/`, 0 pour `adapters/`, 0 pour `utils/` (vérifié par `grep -rn "from '@/domain|.../ports|.../adapters|.../utils"` : seuls `adapters/*` importent `ports/*`).
- Duplication logique induite : `ExpenseNote.approve()/reject()/canBeDecided()` réimplémentés en SQL+HTTP 4 fois ; `User.canManage()/isRootManager()` réimplémentés en `JOIN/WHERE` 6 fois ; `isPositiveAmount/isNonEmptyString` réimplémentés dans `POST expense-notes` et `receipt-suggestion`.
- Seule exception qui confirme : `S3ReceiptAdapter` délègue à `lib/storage` mais n'est appelé par personne ; les routes appellent `lib/storage` en direct.

### Impact

- Double vérité : la règle lue par un nouveau dev dans `domain/` n'est pas celle exécutée en prod. Risque de correction au mauvais endroit.
- Coût d'entretien payé deux fois : faire vivre un hexagone fantôme (revues, onboarding) sans en tirer testabilité ni substitution (S3, notifications, OCR non mockables au niveau port).
- Frein aux WS suivants : impossible d'ajouter file d'attente, cache ou mock sans d'abord brancher les ports.

### Criticité × effort

- Criticité : moyenne (3/5). Pas de bug direct, mais trompe-l'œil d'architecture et dette qui grossit.
- Effort : faible (2/5). Brancher l'existant sans le réécrire : 1 route POC (ex. manager approve via `ExpenseNote`), 1 adapter (remplacer `getReceiptUrl` par `S3ReceiptAdapter`), 1 validateur.
- Priorité : juste après le premier quick win A3, en POC avant généralisation.

## 4. A3 — Vérification des rôles copiée-collée, validations manager et RH quasi identiques

### Emplacement dans le code

Garde rôle (10 occurrences, formulation identique au rôle près) :

- manager (4) : `manager/expense-notes/route.ts:21`, `manager/expense-notes/[id]/approve/route.ts:8`, `manager/expense-notes/[id]/reject/route.ts:8`, `manager/expense-notes/[id]/receipt-url/route.ts:9` → `role !== 'manager'` + `401`.
- RH (6) : `hr/expense-notes/route.ts:21`, `hr/expense-notes/[id]/approve/route.ts:8`, `hr/expense-notes/[id]/reject/route.ts:8`, `hr/expense-notes/[id]/receipt-url/route.ts:9`, `hr/users/route.ts:8`, `hr/users/[id]/manager/route.ts:8` → `role !== 'hr_admin'` + `403`.

Décisions approve/reject (4 fichiers) : `manager/.../approve/route.ts` (47 l.), `manager/.../reject/route.ts` (47 l.), `hr/.../approve/route.ts` (48 l.), `hr/.../reject/route.ts` (48 l.).

Mapping : `function toExpenseNote` copiée dans `expense-notes/route.ts:18`, `manager/expense-notes/route.ts:5`, `hr/expense-notes/route.ts:5`.

### Chiffres

- Garde rôle : 10/13 routes, 0 helper partagé.
- Garde `pending` : 4/4 routes decide (`if (row.status !== 'pending')` → `409 Already decided`).
- `diff manager approve vs manager reject` : 1 seule ligne (`'approved'` contre `'rejected'`, l.29), soit ~98 % identique.
- `diff manager approve vs hr approve` : rôle (`manager`/`hr_admin`), code (`401`/`403`), `WHERE` (`u.manager_id = $2` contre `u.role = 'manager' AND u.manager_id IS NULL AND u.company_id = ...`), soit ~90 % identique (43/47 lignes).
- `toExpenseNote` : 3 définitions × ~11 lignes strictement équivalentes.

### Impact

- Toute correction de garde (ex. uniformiser `401/403`, ajouter log, durcir `company_id`) doit être répétée 10 fois ; oubli probable, déjà matérialisé par l'incohérence `401`/`403` et par le `receipt-url` manager sans scope.
- Approve/reject et manager/RH divergent silencieusement : un fix sur l'un (ex. vérifier `Already decided` avant `Not found`) ne se propage pas à l'autre.
- Coût de lecture : ~190 lignes de decide à relire pour 2 règles réelles (est pending ? a le droit ?).

### Criticité × effort

- Criticité : haute (4/5). Authentification/autorisation dupliquée = risque sécurité + incohérence de contrats.
- Effort : faible (1/5). Quick win : `requireRole(session, 'manager'|'hr_admin')`, `toExpenseNoteRow(row)`, `decideExpenseNote(id, decision, scope)` partagés, sans changer JSON/codes. Faisable en une petite PR.
- Priorité : premier à traiter (rendement maximal).

## 5. Synthèse criticité × effort et séquençage proposé

| Problème | Criticité | Effort | Ordre suggéré |
|---|---|---|---|
| A3 — rôles et decide dupliqués | 4/5 | 1/5 (helpers + tests) | 1 — quick win, sécurise les contrats |
| A1 — couplage route/SQL/métier/HTTP | 4/5 | 3/5 (extraction par route) | 2 — après A3, route par route |
| A2 — hexagone mort (129 LOC, 0 usage) | 3/5 | 2/5 (POC puis branchement) | 3 — POC sur 1 approve + 1 reçu, puis généralisation |

Sans refacto opportuniste : chaque PR garde codes (`401/403/404/409`), formats JSON et parcours UI identiques ; tout écart est noté dans la PR. Liens avec la dette connue : tri `?sort=` concaténé (`expense-notes/route.ts:46`, S-dette injection), `receipt-url` manager sans rattachement (IDOR), `hr/users/[id]/manager` sans `company_id` sur le manager (l.39-42), `AUTH_SECRET` en dur et stacktrace via `lib/errors.ts` — à traiter dans leurs sujets dédiés, pas au passage.

## Annexe — Reproductibilité

```bash
grep -rn "session.user.role" src/app/api --include="*.ts"
grep -rn "function toExpenseNote" src --include="*.ts"
grep -rn "from '@/domain\|from '@/ports\|from '@/adapters\|from '@/utils" src --include="*.ts" --include="*.tsx"
diff src/app/api/manager/expense-notes/\[id\]/approve/route.ts src/app/api/manager/expense-notes/\[id\]/reject/route.ts
diff src/app/api/manager/expense-notes/\[id\]/approve/route.ts src/app/api/hr/expense-notes/\[id\]/approve/route.ts
wc -l src/domain/*.ts src/ports/*.ts src/adapters/*.ts src/utils/*.ts
```

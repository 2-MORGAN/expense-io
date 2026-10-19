# Tests E2E de non-régression

Ticket **WS5 Qualité** — figer le comportement actuel d'Expense.io **avant toute refacto**, pour que la refacto ne casse rien de ce que les correcteurs rejoueront.

La suite (Playwright) pilote un vrai navigateur et l'API HTTP sur la stack locale complète (Next.js + PostgreSQL + S3/LocalStack + OCR). Elle ne modifie pas le code de l'application (`src/` est inchangé).

## Principes

- **Ce qui est figé** : les parcours UI (textes, statuts, formats de date et de montant, redirections), le contrat HTTP (codes de statut, champs JSON, messages d'erreur affichés à l'utilisateur) et les règles d'autorisation et d'isolation entre entreprises **qui fonctionnent aujourd'hui**.
- **Ce qui ne l'est pas, volontairement** : les failles connues de `CLAUDE.md` (injection `?sort=`, IDOR, etc.), que la refacto doit corriger. Figer ces comportements bloquerait les correctifs (voir [Cas non couverts](#cas-non-couverts)).
- **Tests indépendants** : chaque test crée sa propre entreprise (domaine unique `*.e2e.test`) avec une RH, un manager racine et un employé rattaché. Les tests sont donc parallélisables et rejouables sur une base de dev déjà peuplée. Les données des exécutions précédentes sont purgées au démarrage.
- **Couplage minimal au code** : entreprises et comptes sont créés en base, comme le fait `scripts/seed.mjs` (le rôle `manager` ne s'attribue qu'ainsi). Les notes de frais sont toujours créées et tranchées **via l'API**, jamais en SQL. Seule la purge des données de test touche `expense_notes` en SQL, en « best effort » : si elle échoue, la suite continue.
- **Assertions** : exactes sur l'existant, tolérantes aux **ajouts** (`toMatchObject`) : ajouter un champ JSON ne casse rien, en retirer ou en renommer un, si.

## Lancer les tests

### Prérequis (une seule fois)

```bash
npm install                        # installe @playwright/test (devDependency)
npx playwright install chromium    # navigateur de test (sur Linux/CI : --with-deps)
```

### Commande

```bash
make test-e2e
```

Cette commande enchaîne `make up migrate ensure-bucket` (Docker, migrations, bucket S3), puis `npm run test:e2e`. Playwright démarre `npm run dev` sur http://localhost:3000, **ou réutilise le serveur déjà lancé** par `make dev`.

Sans `make`, par exemple dans PowerShell (le Makefile exige `make` et `bash`) :

```bash
cp .env.example .env    # une seule fois, si .env n'existe pas encore
docker compose up -d
npm run migrate:up
npm run ensure-bucket
npm run test:e2e
```

### Options utiles

| Besoin | Commande |
|---|---|
| Un fichier ou un scénario | `npx playwright test e2e/manager-approval.spec.ts` · `npx playwright test -g "MGR-07"` |
| Mode interactif (pas à pas) | `npx playwright test --ui` |
| Rapport HTML, avec trace et capture des échecs | `npx playwright show-report` |
| Cibler un serveur déjà démarré (ex. build de prod) | `npm run build`, `AUTH_TRUST_HOST=true npx next start -p 3100`, puis `E2E_BASE_URL=http://localhost:3100 npm run test:e2e` |
| Base d'administration distincte pour les fixtures | `E2E_DATABASE_URL=postgres://…` (par défaut : `DATABASE_URL` de `.env`) |
| Chromium déjà installé (CI sans téléchargement) | `E2E_CHROMIUM_PATH=/chemin/vers/chrome` |
| Intégration continue | `CI=1` : pas de `test.only`, 1 nouvel essai, 2 workers, serveur toujours démarré par Playwright |

Sous PowerShell, une variable se définit ainsi : `$env:E2E_BASE_URL="http://localhost:3100"; npm run test:e2e`.

### Organisation des fichiers

```
playwright.config.ts          configuration (serveur, navigateur fr-FR / Europe/Paris, rapports)
e2e/
├── global-setup.ts           vérifie Postgres et le bucket, purge les données *.e2e.test, préchauffe les routes
├── support/
│   ├── env.ts                configuration lue dans .env
│   ├── db.ts                 création d'entreprises et de comptes (seule dépendance au schéma)
│   ├── fixtures.ts           fixtures Playwright : org, apiAs, pageAs, openPage
│   ├── api.ts                client HTTP et contrat actuel (DTO, expectApiError, expectPresignedUrl…)
│   └── files.ts              reçus de test (PNG uniques, PDF, texte, fichier > 10 Mio)
├── fixtures/recu-ocr-*.png   tickets de caisse pour l'OCR (images versionnées : résultat déterministe)
└── *.spec.ts                 scénarios, un fichier par domaine
```

## Scénarios couverts

**89 tests** (77 scénarios, certains déclinés par type de fichier ou par cas d'erreur), répartis dans 10 fichiers. L'identifiant figure dans le titre du test : `npx playwright test -g "<ID>"`.

### Inscription — `e2e/signup.spec.ts`

| ID | Scénario | Niveau |
|---|---|---|
| SIGNUP-01 | Premier compte d'un domaine : crée l'entreprise, devient RH (lien « RH », organigramme vide), connecté et redirigé vers `/expenses` | UI |
| SIGNUP-02 | Compte suivant sur le même domaine : employé de la même entreprise, sans manager, visible par la RH ; `/hr` lui est refusé | UI |
| SIGNUP-03 | Email déjà utilisé → « Un compte existe déjà avec cet email. » | UI |
| SIGNUP-04 | Nom composé d'espaces → message de validation serveur | UI |
| SIGNUP-05 | Email sans point dans le domaine (accepté par le HTML) → message de validation serveur | UI |
| SIGNUP-06 | Mot de passe < 8 caractères : bloqué par le navigateur (`minlength`), et refusé par le serveur si on contourne | UI |
| SIGNUP-07 | Le compte créé permet de se reconnecter via `/login` | UI |

### Connexion et session — `e2e/auth.spec.ts`

| ID | Scénario | Niveau |
|---|---|---|
| AUTH-01 | Identifiants valides → `/expenses`, email et « Se déconnecter » dans l'en-tête | UI |
| AUTH-02 | Mauvais mot de passe → « Email ou mot de passe incorrect. », reste sur `/login` | UI |
| AUTH-03 | Email inconnu → même message générique | UI |
| AUTH-04 | Déconnexion → `/login`, pages et API de nouveau inaccessibles (401) | UI + API |
| AUTH-05 | Sans session, `/expenses`, `/manager` et `/hr` redirigent vers `/login` | UI |
| AUTH-06 | Accueil : liens « Se connecter » / « Créer un compte » si anonyme, redirection `/expenses` si connecté | UI |
| AUTH-07 | Navigation selon le rôle : liens « Manager » / « RH » et pages réservées (« Accès réservé aux managers / aux RH ») | UI |
| AUTH-08 | Les liens « Manager » et « RH » mènent aux espaces correspondants (lien actif) | UI |
| AUTH-09 | `npm run seed` est rejouable ; les trois comptes de démo se connectent avec le bon rôle et l'employé est rattaché au manager | API |

### Soumission d'une note de frais avec reçu — `e2e/expense-notes.spec.ts`

| ID | Scénario | Niveau |
|---|---|---|
| NDF-01 | Sans note : invitation à soumettre, historique vide | UI |
| NDF-02 | Formulaire + reçu image → ligne « 1 oct. 2026 · Taxi aéroport · 42,50 € · en attente », total, formulaire vidé | UI |
| NDF-03 | Reçu PDF accepté via le formulaire | UI |
| NDF-04 | Plusieurs notes : la plus récente en premier, compteur et total (« 2 notes · 1 244,50 € au total ») | UI |
| NDF-05 | Reçu d'un type non autorisé → message affiché, aucune note créée | UI |
| NDF-06 | `POST /api/expense-notes` → 201, DTO `{id, userId, amount, expenseDate, description, status: pending, createdAt}` | API |
| NDF-07 | Types de reçus acceptés : PNG, JPEG, WebP, PDF (×4) | API |
| NDF-08 | 400 « Champs invalides » : montant absent, nul, négatif ou non numérique ; date absente ; description absente ou vide ; reçu absent (×8) | API |
| NDF-09 | Type de reçu non autorisé → 400 « Type de fichier non autorisé pour le reçu » | API |
| NDF-10 | Reçu > 10 Mio → 400 « Fichier trop volumineux » | API |
| NDF-11 | `GET /api/expense-notes` : uniquement ses propres notes, plus récentes d'abord | API |
| NDF-12 | `?sort=amount ASC` / `amount DESC` trie la liste (usage légitime seulement) | API |

### Pré-remplissage depuis le reçu (OCR) — `e2e/ocr-suggestion.spec.ts`

| ID | Scénario | Niveau |
|---|---|---|
| OCR-01 | Ticket lisible → `{amount: 42.5, expenseDate: "2026-10-11"}` | API |
| OCR-02 | Ticket sans date → `{amount: 12.3}`, sans date | API |
| OCR-03 | PDF (non pris en charge par l'OCR) → 200, ni montant ni date (`{}`) | API |
| OCR-04 | Sans fichier → 400 « Champs invalides » | API |
| OCR-05 | « Pré-remplir depuis le reçu » remplit montant et date, puis la note se soumet | UI |
| OCR-06 | Seul le montant est reconnu → « Date non reconnu(e) sur ce reçu — vérifie ce champ. » | UI |
| OCR-07 | Rien de reconnu → « Aucune information reconnue sur ce reçu — saisis les champs manuellement. » | UI |
| OCR-08 | Sans reçu sélectionné → « Sélectionne d’abord un reçu. » | UI |

### Consultation des reçus — `e2e/receipts.spec.ts`

| ID | Scénario | Niveau |
|---|---|---|
| RECU-01 | Employé : « Voir le reçu » ouvre une URL pré-signée (≤ 300 s) qui sert exactement le fichier envoyé | UI |
| RECU-02 | `GET /api/expense-notes/:id/receipt-url` : 200 pour sa note ; 404 pour la note d'un collègue, de son manager ou un id inconnu | API |
| RECU-03 | Le reçu est restitué avec son type : JPEG, WebP, PDF (×3) | API |
| RECU-04 | Manager : « Voir le reçu » depuis `/manager` | UI |
| RECU-05 | `GET /api/manager/expense-notes/:id/receipt-url` : 200 pour une note de son équipe, 404 pour un id inconnu | API |
| RECU-06 | RH : « Voir le reçu » depuis `/hr` | UI |
| RECU-07 | `GET /api/hr/expense-notes/:id/receipt-url` : 200 pour un manager racine de l'entreprise ; 404 pour une note d'employé, de manager non racine, d'une autre entreprise ou inconnue | API |

### Validation ou rejet par le manager — `e2e/manager-approval.spec.ts`

| ID | Scénario | Niveau |
|---|---|---|
| MGR-01 | `/manager` liste les notes en attente des subordonnés directs (id employé tronqué, date, description, montant, actions) | UI |
| MGR-02 | Sans note : « En attente (0) », « Aucune note en attente. » | UI |
| MGR-03 | « Approuver » → la note quitte la liste, l'employé la voit « approuvée » | UI |
| MGR-04 | « Rejeter » → la note quitte la liste, l'employé la voit « rejetée » | UI |
| MGR-05 | Note tranchée entre-temps → message « Already decided » | UI |
| MGR-06 | Liste API = notes `pending` des subordonnés **directs**, plus anciennes d'abord (exclut : notes tranchées, ses propres notes, N+2, autre équipe, autre entreprise) | API |
| MGR-07 | approve → 200 + note `approved` ; nouvelle décision → 409 « Already decided » | API |
| MGR-08 | reject → 200 + note `rejected` ; nouvelle décision → 409 | API |
| MGR-09 | Note d'une autre équipe, sa propre note ou id inconnu → 404 « Not found », statut inchangé | API |
| MGR-10 | Manager non racine : ses notes sont tranchées par son propre manager, pas par la RH | API |

### Validation ou rejet par la RH — `e2e/hr-approval.spec.ts`

| ID | Scénario | Niveau |
|---|---|---|
| RH-01 | `/hr` liste les notes en attente des managers racine (nom de l'auteur, date, description, montant) | UI |
| RH-02 | Sans note : « Aucune note en attente. » | UI |
| RH-03 | « Approuver » → la note quitte la liste, le manager la voit « approuvée » | UI |
| RH-04 | « Rejeter » → la note quitte la liste, le manager la voit « rejetée » | UI |
| RH-05 | Liste API = notes `pending` des managers racine **de l'entreprise**, plus anciennes d'abord (exclut : employés, managers non racine, notes tranchées, autre entreprise) | API |
| RH-06 | approve → 200 + note `approved` ; nouvelle décision → 409 « Already decided » | API |
| RH-07 | reject → 200 + note `rejected` ; nouvelle décision → 409 | API |
| RH-08 | Note d'employé, de manager non racine, d'une autre entreprise ou inconnue → 404, statut inchangé | API |

### Rattachement d'un manager — `e2e/hr-org-chart.spec.ts`

| ID | Scénario | Niveau |
|---|---|---|
| ORG-01 | Organigramme : employés et managers de l'entreprise (sans la RH ni les autres entreprises), triés par nom, rôle et manager actuel ; choix proposés = « aucun » + managers sauf soi-même | UI |
| ORG-02 | Rattacher un employé → enregistré (persiste au rechargement), le manager voit ses notes en attente | UI |
| ORG-03 | « — aucun (racine) — » détache l'employé : l'ancien manager ne voit plus ses notes | UI |
| ORG-04 | Rattacher un manager racine à un autre manager → ses notes passent de la RH à ce manager | UI |
| ORG-05 | `GET /api/hr/users` : `{id, name, email, role, managerId}` de l'entreprise uniquement, triés par nom | API |
| ORG-06 | `PUT /api/hr/users/:id/manager` → 200 + utilisateur à jour (la visibilité des notes suit) ; `managerId: null` → détachement | API |
| ORG-07 | Manager invalide (soi-même, employé, RH, inconnu) → 409 « Invalid manager », rien ne change | API |
| ORG-08 | Cible RH, d'une autre entreprise ou inconnue → 404 « Not found » | API |

### Contrôle d'accès et isolation — `e2e/access-control.spec.ts`

| ID | Scénario | Niveau |
|---|---|---|
| ACL-01 | Sans session : 401 sur les 8 routes employé/manager, **403** sur les 6 routes RH, corps `{"error": "Unauthorized"}` | API |
| ACL-02 | Employé : 401 sur les routes manager, 403 sur les routes RH | API |
| ACL-03 | Manager : 403 sur les routes RH | API |
| ACL-04 | RH : 401 sur les routes manager | API |
| ISO-01 | La RH d'une autre entreprise ne voit ni ne modifie rien (liste, décision, reçu, annuaire, rattachement) | API |
| ISO-02 | Un manager d'une autre entreprise ne voit ni ne tranche les notes | API |
| ISO-03 | Un employé d'une autre entreprise ne voit ni les notes ni les reçus | API |

Pour ACL-01 à ACL-04, chaque refus est vérifié **sans effet de bord** (notes toujours `pending`, rattachement inchangé).

### Parcours complet — `e2e/parcours-complet.spec.ts`

| ID | Scénario | Niveau |
|---|---|---|
| FLOW-01 | Inscriptions (RH puis deux comptes), promotion manager en base, rattachement par la RH, note de l'employée consultée puis approuvée par le manager, note du manager rejetée par la RH | UI |

## Résultat de la dernière exécution

**89 / 89 tests verts (100 %)**, 0 échec, 0 flaky, sans nouvel essai.

| | |
|---|---|
| Date | 11 octobre 2026 |
| Code testé | `main` @ `4fad1d3`, sans modification de `src/` |
| Commande | `npm run test:e2e` (Playwright démarre lui-même `next dev`, base de dev déjà peuplée par le seed) |
| Durée | 2,4 min avec 1 worker, démarrage à froid de `next dev` et préchauffage des routes compris |
| Environnement | Linux, Node 24.21.0, PostgreSQL 16.15, LocalStack 3.8.1 (S3), Playwright 1.63.0, Chromium 141 (`E2E_CHROMIUM_PATH`) |

| Fichier | Tests | Résultat |
|---|---:|---|
| `access-control.spec.ts` | 7 | ✅ 7/7 |
| `auth.spec.ts` | 9 | ✅ 9/9 |
| `expense-notes.spec.ts` | 22 | ✅ 22/22 |
| `hr-approval.spec.ts` | 8 | ✅ 8/8 |
| `hr-org-chart.spec.ts` | 8 | ✅ 8/8 |
| `manager-approval.spec.ts` | 10 | ✅ 10/10 |
| `ocr-suggestion.spec.ts` | 8 | ✅ 8/8 |
| `parcours-complet.spec.ts` | 1 | ✅ 1/1 |
| `receipts.spec.ts` | 9 | ✅ 9/9 |
| `signup.spec.ts` | 7 | ✅ 7/7 |
| **Total** | **89** | **✅ 89/89** |

```
Running 89 tests using 1 worker
  ✓  1 [chromium] › e2e/access-control.spec.ts:118:7 › Contrôle d’accès par rôle › [ACL-01] …
  …
  ✓ 89 [chromium] › e2e/signup.spec.ts:148:7 › Inscription › [SIGNUP-07] …

  89 passed (2.4m)
```

Vérifications complémentaires, sur le même code :

- **Parallélisme et répétition** : `npx playwright test --workers=4 --repeat-each=2` → 178/178 en 4,4 min, sur une machine à 2 vCPU (donc fortement surchargée) ; une campagne précédente avec 2 workers et `--repeat-each=3` : 267/267. Une première campagne sous cette charge avait révélé un délai trop court sur la soumission de l'inscription (double hachage bcrypt) ; corrigé par un délai dédié de 30 s (`AUTH_TIMEOUT`) sur les formulaires d'inscription et de connexion.
- **Build de production** (`next build` puis `next start`, via `E2E_BASE_URL`) → 89/89 en 57 s.
- **Sensibilité de la suite** : 16 régressions injectées une à une dans `src/` (puis annulées) ont toutes fait échouer au moins un test : décision manager inversée, filtre entreprise retiré de la liste RH, premier inscrit non RH, type MIME du reçu perdu, contrôle `pending` supprimé côté RH, contrôle d'entreprise retiré du rattachement, tri par défaut inversé, notes tranchées laissées dans la liste manager, liste non rechargée après décision, libellé « approuvée » modifié, URL pré-signée d'1 h, contrôle du propriétaire retiré du reçu, `/hr` non protégé, date OCR ignorée, limite de 10 Mio relevée, 401 → 403 sur les routes manager.
- `npm run lint` et `npm run typecheck` passent (fichiers de test inclus).

Limites de cette exécution : elle a eu lieu dans un environnement Linux isolé, **sans Docker** (registre inaccessible). PostgreSQL 16 et LocalStack 3.8.1 (mêmes versions que `docker-compose.yml`) y tournaient en natif, et Google Fonts était inaccessible (police de repli, sans effet sur les tests ; polices simulées localement pour le build de prod). Le Chromium utilisé (141) est plus ancien que celui fourni par Playwright 1.63 (153). **À rejouer sur un poste de l'équipe avec `make test-e2e`, puis mettre à jour cette section.**

## Cas non couverts

### Comportements actuels volontairement non figés (failles ou dette à corriger)

Les références renvoient à `CLAUDE.md` (« Dette connue ») et à l'audit API WS4 (`docs/audit/WS4-Q1-Q3.md`, PR #1).

| Comportement actuel | Réf. |
|---|---|
| Injection SQL via `?sort=` (seul un tri légitime est testé, NDF-12) | B1 |
| Un manager obtient le reçu d'une note hors de son équipe (IDOR) | B2 |
| Une RH peut rattacher un employé à un manager d'une autre entreprise | B3 |
| Message interne et stacktrace renvoyés dans les erreurs 500 ; certaines erreurs SQL échappent au `catch` | B4, Q1.3 |
| Corps JSON invalide ou sans `managerId` sur `PUT …/manager` = détachement silencieux (200) | B7 |
| Validation laxiste : `12abc` accepté comme 12, date invalide → 500, fichier vide accepté, type MIME déclaratif non vérifié | B7 |
| Cycles hiérarchiques acceptés (A → B puis B → A) | B13 |
| Format des clés S3 (`receipts/<compteur>.<ext>`) et champ `receiptKey` : seul le fait que le reçu soit restituable est testé | B14 |
| Rôle figé dans le JWT jusqu'à la reconnexion | B6 |
| Inscription sans preuve d'appartenance au domaine (premier inscrit = RH) | B12 |
| Concurrence : deux décisions simultanées peuvent toutes deux réussir | B8 |

Quand l'un de ces points est corrigé, ajouter le test correspondant (un bug corrigé = un test qui échoue avant, passe après).

### Non testables en E2E en l'état

- Atomicité de la création note + upload S3 (panne S3 ou base en cours de route), idempotence des réessais (B9) : demande une injection de pannes.
- Charge et limites de l'OCR : gros fichiers, durée, concurrence (B10). La distinction entre panne de l'OCR et « rien trouvé » n'existe pas (les deux donnent `{}`, B11) ; seul le cas « type non pris en charge → `{}` » est figé.
- Messages d'erreur de l'UI qui n'apparaissent qu'en cas de panne serveur : « Impossible de charger les notes de frais. », « Impossible de récupérer le reçu. », « Impossible d’analyser ce reçu. », « Échec de l'assignation. ».
- Policies RLS de PostgreSQL : contournées dans la configuration actuelle (connexion superuser). L'isolation est vérifiée au niveau HTTP (ISO-*, MGR-09, RH-08, ORG-08, RECU-02/07), pas au niveau des policies.

### Hors périmètre de cette suite

- Navigateurs autres que Chromium, affichage mobile, accessibilité, performances.
- Protocole Auth.js lui-même (seuls les parcours qui l'utilisent sont testés), méthodes HTTP non implémentées (405), `HEAD` / `OPTIONS`.
- Affichage des dates à l'ouest de UTC : `new Date('YYYY-MM-DD')` peut afficher la veille. Les tests tournent en `Europe/Paris`.
- Contenu des notes de démonstration du seed (seuls les comptes et l'organigramme sont vérifiés, AUTH-09).

## Faire évoluer la suite pendant la refacto

- Un test rouge signale une régression, **sauf changement de comportement voulu** : mettre alors le test à jour dans la même PR et le signaler dans la description (règle de `CLAUDE.md`).
- Les attentes susceptibles d'évoluer sont regroupées :
  - format d'erreur `{ "error": … }` → `expectApiError` dans `e2e/support/api.ts` (par exemple pour passer à `application/problem+json`) ;
  - codes 401/403 actuels (Q1.1) → `e2e/access-control.spec.ts` ;
  - schéma `companies` / `users` → `e2e/support/db.ts` (à garder aligné avec `scripts/seed.mjs`).
- Les données de test (domaines `*.e2e.test`) sont purgées au début de chaque exécution ; celles de la dernière exécution restent en base pour l'analyse d'un échec.

## Dépendance ajoutée

`@playwright/test` (devDependency, ^1.63.0). Justification : outil E2E de référence recommandé par la documentation Next.js, qui couvre à la fois le navigateur et l'API HTTP, isole chaque utilisateur dans son propre contexte et produit des traces exploitables en cas d'échec. Aucun impact sur le build de production.

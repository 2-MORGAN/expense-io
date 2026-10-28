# Tests E2E de non-régression

Ticket **WS5 Qualité** — figer le comportement actuel d'Expense.io **avant toute refacto**, pour que la refacto ne casse rien de ce que les correcteurs rejoueront.

La suite (Playwright) pilote un vrai navigateur et l'API HTTP sur la stack locale complète (Next.js + PostgreSQL + S3/LocalStack + Mailpit + OCR). Elle ne modifie pas le code de l'application (`src/` est inchangé).

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
docker compose up -d --wait   # attend que Postgres et LocalStack soient prêts, comme `make up`
npm run migrate:up
npm run ensure-bucket
npm run test:e2e
```

Si `npm run migrate:up` échoue sur une erreur d'authentification de l'utilisateur `expense` (code `28P01`), un PostgreSQL installé sur le poste occupe sans doute déjà le port 5433 (`netstat -ano | findstr :5433` sous Windows). Arrêter ce service le temps des tests, ou exposer le Postgres de Docker sur un autre port et y faire pointer `DATABASE_URL`.

### Options utiles

| Besoin | Commande |
|---|---|
| Un fichier ou un scénario | `npx playwright test e2e/manager-approval.spec.ts` · `npx playwright test -g "MGR-07"` |
| Mode interactif (pas à pas) | `npx playwright test --ui` |
| Rapport HTML, avec trace et capture des échecs | `npx playwright show-report` |
| Cibler un serveur déjà démarré (ex. build de prod) | `npm run build`, `AUTH_TRUST_HOST=true npx next start -p 3100`, puis `E2E_BASE_URL=http://localhost:3100 npm run test:e2e` |
| Base d'administration pour les fixtures | `E2E_DATABASE_URL=postgres://…`, le propriétaire dans `.env.example` (par défaut : `DATABASE_URL`). L'application testée se connecte sous `expense_app`, son worker sous `expense_worker` (2-481) ; le code de `src/` importé par les specs (outbox, worker) passe par cette connexion d'administration |
| Chromium déjà installé (CI sans téléchargement) | `E2E_CHROMIUM_PATH=/chemin/vers/chrome` |
| Mailpit ailleurs que sur `http://localhost:8025` | `MAILPIT_URL=http://hôte:8025` |
| Couverture de code du serveur, du worker et des scripts pendant la suite | `npm run test:e2e:coverage` (script Node `scripts/coverage/e2e.mjs`, macOS, Linux et Windows) → `coverage-e2e-report/index.html`. Démarre son propre serveur (arrêter `make dev`) et lui laisse le temps d'écrire sa couverture à l'arrêt ; le code exécuté dans le navigateur n'est pas mesuré. Lire les **branches** : les lignes sont gonflées |
| Intégration continue | `.github/workflows/ci.yml` lance l'équivalent de `make test-e2e` sur chaque PR, en 2 shards (`--shard=1/2` et `--shard=2/2`) dont le job `e2e` fusionne les rapports. `CI=1` : pas de `test.only`, 1 nouvel essai, 2 workers par shard, serveur toujours démarré par Playwright |

Sous PowerShell, une variable se définit ainsi : `$env:E2E_BASE_URL="http://localhost:3100"; npm run test:e2e`.

### Organisation des fichiers

```
playwright.config.ts          configuration (serveur, navigateur fr-FR / Europe/Paris, rapports)
e2e/
├── global-setup.ts           vérifie Postgres, le bucket et Mailpit, purge les données *.e2e.test, préchauffe les routes
├── support/
│   ├── env.ts                configuration lue dans .env
│   ├── db.ts                 création d'entreprises et de comptes (seule dépendance au schéma)
│   ├── fixtures.ts           fixtures Playwright : org, apiAs, pageAs, openPage
│   ├── api.ts                client HTTP et contrat actuel (DTO, expectApiError, expectPresignedUrl…)
│   ├── files.ts              reçus de test (PNG uniques, PDF, texte, fichier > 10 Mio)
│   ├── mailpit.ts            lecture des emails captés par Mailpit (waitForEmail, countEmails)
│   └── outbox.ts             préparation et lecture de outbox_events, en connexion d'administration (insertOutboxEvent, outboxEvent)
├── fixtures/recu-ocr-*.png   tickets de caisse pour l'OCR (images versionnées : résultat déterministe)
└── *.spec.ts                 scénarios, un fichier par domaine
```

## Scénarios couverts

**111 tests** (99 scénarios, certains déclinés par type de fichier ou par cas d'erreur), répartis dans 13 fichiers. L'identifiant figure dans le titre du test : `npx playwright test -g "<ID>"`.

### Inscription — `e2e/signup.spec.ts`

| ID | Scénario | Niveau |
|---|---|---|
| SIGNUP-01 | Premier compte sans invitation : crée l'entreprise, devient RH ; page « Vérifiez votre boîte mail », lien de confirmation reçu (Mailpit), puis connexion → `/expenses`, lien « RH », organigramme vide (S7, ADR-001 §3) | UI |
| SIGNUP-02 | Compte suivant sur le même domaine, sans invitation : RH de sa propre entreprise (organigramme vide), invisible de la première RH (S7 : le domaine ne regroupe plus personne) | UI |
| SIGNUP-03 | Email déjà utilisé → « Un compte existe déjà avec cet email. » | UI |
| SIGNUP-04 | Nom composé d'espaces → message de validation serveur | UI |
| SIGNUP-05 | Email sans point dans le domaine (accepté par le HTML) → message de validation serveur | UI |
| SIGNUP-06 | Mot de passe < 8 caractères : bloqué par le navigateur (`minlength`), et refusé par le serveur si on contourne | UI |
| SIGNUP-07 | Le compte créé (email confirmé) permet de se reconnecter via `/login` | UI |

### Invitations et vérification d'email — `e2e/invitations.spec.ts`

S7 (ADR-001 §3, 2-496) : le domaine de l'email ne donne plus aucun droit. Les liens sont lus dans Mailpit (`e2e/support/identity.ts`) ; le worker lancé par `npm run dev` envoie les emails.

| ID | Scénario | Niveau |
|---|---|---|
| SIGNUP-08a | Deux inscriptions sans invitation sur le même domaine → deux entreprises distinctes, chacune avec sa RH, aucune ne voit l'autre | UI + Base |
| SIGNUP-08b | Invitation envoyée depuis `/hr` → lien reçu → formulaire « Vous rejoignez … », email imposé → employé de l'entreprise de la RH, connecté, visible dans son organigramme | UI |
| SIGNUP-08c | Invitation expirée : refusée à la soumission (formulaire ouvert avant l'expiration) et à l'ouverture du lien ; aucun compte créé | UI |
| SIGNUP-08d | Invitation déjà utilisée → lien refusé | UI |
| SIGNUP-08e | Jeton d'invitation présenté avec une autre adresse (champ en lecture seule contourné) → refusé, aucun compte créé | UI |
| SIGNUP-10 | Créateur non vérifié : connexion refusée avec « Confirmez votre adresse email avant de vous connecter. » (mauvais mot de passe : message générique) ; lien → « Email confirmé », connexion ; lien à usage unique | UI |
| SIGNUP-11a | Inscription non confirmée sur une adresse, puis invitation de la RH pour cette adresse : l'invité rejoint l'entreprise de la RH, l'entreprise fantôme est supprimée | UI + base |
| SIGNUP-11b | Adresse déjà vérifiée : l'invitation est refusée (« Un compte existe déjà avec cet email. »), le compte existant reste intact | UI + base |
| SIGNUP-12 | Nouvelle inscription sur une adresse non confirmée : remplace l'ancienne (nouvel id, ancienne entreprise supprimée), ancien lien invalide, seul le nouveau mot de passe fonctionne | UI + base |
| SIGNUP-13 | Renvoi de l'email de vérification depuis `/signup/verify` (lien depuis la connexion refusée) : nouveau lien valide, ancien invalide ; même message pour une adresse inconnue ou déjà vérifiée, sans email | UI |
| INV-01 | `POST /api/hr/invitations` : 401 sans session, 403 employé et manager, 400 `INVALID_EMAIL`, 201 `{ id, email, expiresAt }` (adresse normalisée) ; relance de la même adresse → même invitation, nouvel email, ancien lien invalide | API |
| INV-02 | Sous `expense_app` : invitation visible de la RH de son entreprise seulement (ni RH d'une autre entreprise, ni employé, ni manager) ; insertion pour une autre entreprise ou par un employé refusée (42501) | Base |
| INV-03 | `POST /api/hr/invitations` : JSON malformé → 400 `INVALID_JSON` ; corps sans `email`, `email` non textuel ou corps non objet → 400 `VALIDATION_ERROR` ; adresse hors du format email du contrat (`a..b@…`, `é@…`, domaine commençant par un tiret…) → 400 `INVALID_EMAIL`, aucune invitation créée | API |

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
| NDF-12 | `?sort=amount ASC` / `amount DESC` trie la liste | API |
| NDF-13 | `?sort=` hors liste blanche (colonne inconnue, clause ajoutée, direction invalide) → 200, tri par défaut (faille S1 corrigée) | API |
| SOUM-01 | Note créée : `receipt_key = receipts/{entreprise}/{id de la note}.ext`, objet présent dans S3 avec son type (2-476, ADR-003 §3) | API |
| SOUM-02 | Aucune note de l'entreprise sans reçu (clé vide) ni hors du préfixe de son entreprise | API |
| IDEM-01 | Même `Idempotency-Key`, même contenu : 201 avec la même note, `Idempotent-Replayed: true`, une seule ligne (2-476 étape 2) | API |
| IDEM-02 | Trois requêtes simultanées de même clé : une seule note | API |
| IDEM-03 | Même clé, contenu différent : 422 `IDEMPOTENCY_KEY_REUSED`, rien de créé | API |
| IDEM-04 | Clé qui n'est pas un UUID : 400 `INVALID_IDEMPOTENCY_KEY` | API |
| IDEM-05 | La clé est propre à l'utilisateur : un collègue avec la même clé crée sa propre note | API |
| IDEM-06 | Sans en-tête : deux envois identiques créent deux notes (comportement inchangé) | API |
| CLEAN-01 | La base refuse une note sans reçu (`receipt_key = ''`), à l'insertion comme à la mise à jour (2-476 étape 3) | API |
| CLEAN-02 | `clean-notes-without-receipt` sans `--execute` : rapport seul, rien de modifié | API |
| CLEAN-03 | `--execute --out` : CSV de toutes les notes sans reçu, suppression des seules notes `pending`, notes décidées conservées, autre entreprise intacte | API |
| CLEAN-04 | `--execute` sans `--out` : refusé, rien supprimé | API |
| REC-01 | `reconcile-orphan-receipts` sans `--execute` : liste l'orphelin, ne supprime rien (2-476 bonus) | API |
| REC-02 | `--execute` : supprime l'orphelin, garde le reçu d'une note | API |
| REC-03 | Délai de 24 h : un objet récent n'est jamais supprimé, même avec `--execute` | API |
| REC-04 | Un objet sous le préfixe d'une autre entreprise n'est pas touché (`--company`) | API |

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
| OCR-22 | Ticket lisible → `description: "Restaurant le Test"` (nom du commerçant) | API |
| OCR-23 | « Pré-remplir » remplit une description vide, mais ne remplace pas une description déjà saisie | UI |

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
| RECU-08 | `GET /api/manager/expense-notes/:id/receipt-url` : 404 pour la note d'un employé d'un autre manager, d'une autre entreprise ou du manager lui-même (faille S2 corrigée) | API |

### Erreurs communes — `e2e/api-errors.spec.ts`

| ID | Scénario | Niveau |
|---|---|---|
| ERR-01 | Panne PostgreSQL injectée sur une note : 500 `INTERNAL_ERROR` générique, sans pile ni message interne, `requestId` identique à `X-Request-Id`, décision annulée | API + base |
| ERR-02 | 401/403/404/409 au format commun, codes stables, champ `error` historique préservé | API |
| ERR-03 | L’écran traduit un code connu ; code inconnu → message générique français, aucun texte brut de l’API affiché | UI |

ERR-01 crée temporairement un trigger limité à sa note et le supprime en `finally`. Il n’utilise ni date invalide comme déclencheur de 500, ni endpoint de test en production (ADR-001/004). La base des fixtures doit autoriser ce DDL. Les tests unitaires vérifient la même corrélation dans les logs et la capture des rejets tardifs, des erreurs synchrones et des erreurs de sérialisation.

**Évolution autorisée de MGR-05** : « Already decided » → « Cette note a déjà été tranchée. » (ADR-004 §9). L’assertion et le titre de ce seul scénario existant changent dans un commit de tests séparé ; les tests API continuent à attendre `error: "Already decided"`.

### Validation ou rejet par le manager — `e2e/manager-approval.spec.ts`

| ID | Scénario | Niveau |
|---|---|---|
| MGR-01 | `/manager` liste les notes en attente des subordonnés directs (id employé tronqué, date, description, montant, actions) | UI |
| MGR-02 | Sans note : « En attente (0) », « Aucune note en attente. » | UI |
| MGR-03 | « Approuver » → la note quitte la liste, l'employé la voit « approuvée » | UI |
| MGR-04 | « Rejeter » → la note quitte la liste, l'employé la voit « rejetée » | UI |
| MGR-05 | Note tranchée entre-temps → « Cette note a déjà été tranchée. », traduit depuis `ALREADY_DECIDED` (ADR-004 §9, 2-485) | UI |
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
| ORG-09 | `PUT /api/hr/users/:id/manager` vers un manager d'une autre entreprise → 409 « Invalid manager », rattachement inchangé (faille S3 corrigée) | API |
| ORG-10 | Manager proposé rétrogradé par une transaction concurrente non encore validée : le rattachement l'attend, puis 409 « Invalid manager », rattachement inchangé | API + base |

### Contrôle d'accès et isolation — `e2e/access-control.spec.ts`

| ID | Scénario | Niveau |
|---|---|---|
| ACL-01 | Sans session : 401 sur les 14 routes employé, manager et RH, corps `{"error": "Unauthorized"}` | API |
| ACL-02 | Employé : 403 sur les routes manager et RH | API |
| ACL-03 | Manager : 403 sur les routes RH | API |
| ACL-04 | RH : 403 sur les routes manager | API |
| ISO-01 | La RH d'une autre entreprise ne voit ni ne modifie rien (liste, décision, reçu, annuaire, rattachement) | API |
| ISO-02 | Un manager d'une autre entreprise ne voit ni ne tranche les notes | API |
| ISO-03 | Un employé d'une autre entreprise ne voit ni les notes ni les reçus | API |

Pour ACL-01 à ACL-04, chaque refus est vérifié **sans effet de bord** (notes toujours `pending`, rattachement inchangé).

### Isolation par la base (RLS) — `e2e/rls-isolation.spec.ts`

Tests d'intégration de base (ADR-001 §5.1, 2-478). Chaque vérification tourne sous le rôle restreint `expense_app` (`SET LOCAL ROLE`), avec le contexte que pose `withUserScope`, dans une transaction annulée. Les témoins vérifient que la même requête voit bien les données de sa propre entreprise. Depuis 2-481, l'application lancée se connecte elle aussi sous `expense_app` (ISO-11).

| ID | Scénario | Niveau |
|---|---|---|
| ISO-07a | `expense_app` n'est ni superuser ni `BYPASSRLS` ; aucun droit sur `users.password_hash` (42501) ni sur `companies` | Base |
| ISO-07b | Contexte absent ou inconnu → 0 note | Base |
| ISO-07c | Contexte absent ou inconnu → 0 utilisateur | Base |
| ISO-07d | RH de B → 0 note et 0 utilisateur de A ; témoin : la RH de A voit la note de son manager racine et ses 3 utilisateurs | Base |
| ISO-07e | Lien manager inter-entreprises refusé par la clé étrangère (23503) ; posé malgré tout (contrôles désactivés), le manager de B ne voit ni ne tranche la note de A | Base |
| ISO-07f | Un employé ne change pas le statut de sa propre note (0 ligne) | Base |
| ISO-07g | Le manager racine trouve les RH de son entreprise, et seulement elles (notification de soumission) | Base |
| ISO-07h | Rattachement : la RH dans son entreprise seulement, jamais un employé ; changer un rôle est refusé (42501) | Base |
| ISO-07i | `auth_find_user` rend une seule ligne, par email exact | Base |
| ISO-07j | Le manager tranche la note de son équipe avec les écritures de la décision : statut, `decided_by`, `decided_at` (2-488) | Base |
| SIGNUP-09 | `register_user` : panne injectée (email déjà pris, en autocommit) → aucune entreprise créée ; même domaine → deuxième entreprise distincte, RH non vérifiées, email de vérification demandé dans la même transaction (S7) | Base |

### Rôles de connexion — `e2e/db-roles.spec.ts`

Bascule sur les rôles restreints (ADR-001 §3 point 7 et point de coordination avec l'ADR-003, 2-481). ISO-10 tourne en base, sous `SET LOCAL ROLE`, dans une transaction annulée, comme ISO-07 ; ISO-11 observe l'application et le worker lancés.

| ID | Scénario | Niveau |
|---|---|---|
| ISO-10a | `expense_worker` peut se connecter, n'est ni superuser ni `BYPASSRLS` ; aucun droit sur `users.password_hash`, `companies`, `expense_notes`, ni l'`INSERT` dans l'outbox | Base |
| ISO-10b | Le worker lit et met à jour les événements de deux entreprises ; sans contexte il ne voit aucun utilisateur, sous l'entreprise de l'événement (`scopeToCompany`) seulement les siens | Base |
| ISO-10c | Policy d'insertion de l'outbox : sous le contexte d'un employé de A, événement pour A accepté, pour B refusé (42501) ; l'application ne lit pas l'outbox (42501) | Base |
| ISO-10d | `receipt_cleanup_candidates`, `purge_expired_receipt_analyses` et `referenced_receipt_keys` : exécutables par le worker, refusées à l'application (42501) ; l'application lit seulement le nombre d'analyses OCR en attente (`pending_receipt_analyses`) | Base |
| ISO-11 | Après une requête authentifiée, `pg_stat_activity` montre les connexions `expense-web` sous `expense_app` et `expense-worker` sous `expense_worker` | Base + HTTP |

### Session et rôle à jour — `e2e/session-roles.spec.ts`

S9 (ADR-001 §4, 2-496) : le rôle est relu en base à chaque lecture de session (callback `jwt`), sans reconnexion.

| ID | Scénario | Niveau |
|---|---|---|
| AUTH-10a | Manager rétrogradé en base → `GET /api/manager/expense-notes` **403**, `/manager` « Accès réservé aux managers », lien « Manager » absent | API + UI |
| AUTH-10b | Employé promu manager en base → accès manager immédiat (200) | API |
| AUTH-10c | Compte supprimé en base → API **401**, page protégée redirigée vers `/login` | API + UI |
| AUTH-10d | Cookie de session : expiration 8 h après la dernière requête (et non 30 jours) | UI |

### Limite de tentatives de connexion — `e2e/login-throttle.spec.ts`

ADR-001 §4 point 3 : 10 échecs par email sur 15 minutes (valeurs par défaut, réglables par l'environnement), puis refus jusqu'à la fin de la fenêtre. Compteurs dans `login_attempts`, par empreinte SHA-256 de l'adresse.

| ID | Scénario | Niveau |
|---|---|---|
| AUTH-11a | 10 échecs sur `/api/auth/callback/credentials` → l'appel suivant, même avec le bon mot de passe, répond **429** `application/problem+json`, code `TOO_MANY_LOGIN_ATTEMPTS`, `Retry-After` ≤ 15 min ; la table ne contient que l'empreinte de l'adresse | API + Base |
| AUTH-11b | Même compte sur `/login` → « Trop de tentatives de connexion. Réessayez dans quelques minutes. », reste sur `/login` ; un autre compte se connecte normalement | UI + API |
| AUTH-11c | Fenêtre expirée (forcée en base) → la connexion redevient possible : jamais de blocage définitif | API + Base |
| AUTH-11d | Email sans compte : limité de la même façon (pas d'énumération) | API |

### Parcours complet — `e2e/parcours-complet.spec.ts`

| ID | Scénario | Niveau |
|---|---|---|
| FLOW-01 | Inscription de la RH (email confirmé), invitation du futur manager et de l'employée depuis `/hr`, inscription par le lien reçu, promotion manager en base, rattachement par la RH, note de l'employée consultée puis approuvée par le manager, note du manager rejetée par la RH | UI |

### Emails — `e2e/email.spec.ts`

Les emails de dev sont captés par Mailpit (`docker compose`, interface sur http://localhost:8025) : aucun ne sort. Les tests les lisent par son API HTTP (`e2e/support/mailpit.ts`).

| ID | Scénario | Niveau |
|---|---|---|
| MAIL-01 | Un email envoyé par l'adaptateur SMTP arrive dans Mailpit (sujet, texte, expéditeur, Message-ID) | Intégration |

### Outbox et worker — `e2e/outbox-worker.spec.ts`

Les tests appellent directement `withUserScope`, `PgEventOutbox` et `processNextEvent` avec des handlers de test, sur la vraie base (types d'événement uniques et entreprises dédiées, pour ne pas toucher aux événements des autres tests). Ils ne lancent pas le processus `npm run worker` : sa boucle (enchaînement, attente, erreurs, arrêt) est couverte par les tests unitaires de `src/worker/runWorker.test.ts`.

| ID | Scénario | Niveau |
|---|---|---|
| OUTBOX-01 | `enqueue` dans `withUserScope` : événement « pending » dans l'entreprise de l'utilisateur | Intégration |
| OUTBOX-02 | `enqueue` hors contexte utilisateur : refusé, rien n'est écrit | Intégration |
| OUTBOX-03 | Succès → « sent », 1 essai, traité une seule fois | Intégration |
| OUTBOX-04 | Échec → relance dans 1 min, écritures du handler annulées, email masqué dans l'erreur | Intégration |
| OUTBOX-05 | Échec après 5 relances → « dead » | Intégration |
| OUTBOX-06 | Événement pas encore dû : ignoré | Intégration |
| OUTBOX-07 | Deux workers simultanés : l'événement est traité une seule fois | Intégration |
| OUTBOX-08 | Type sans handler : laissé « pending » pour le worker qui le connaît | Intégration |
| OUTBOX-09 | Worker arrêté pendant le traitement : la prise en charge compte l'essai et pose un bail de 5 min ; un événement dont le dernier essai n'a jamais fini et qui a épuisé ses essais passe « dead » sans rejouer le handler | Intégration |
| OUTBOX-10 | Prise en charge périmée (bail expiré, un autre worker a repris l'événement) : la phase 2 ne lance pas le handler et ne modifie rien | Intégration |

### Observabilité — `e2e/observability.spec.ts`

ADR-003 §6 : état de l'outbox que le worker journalise chaque minute (`outbox.stats`). La métrique `ocr_requests_total{outcome}` est couverte par les tests unitaires de `src/http/ocrHandlers.test.ts` (ligne de journal, non visible depuis Playwright).

| ID | Scénario | Niveau |
|---|---|---|
| OBS-01 | `outboxStats()` par type : 2 en attente, 1 mort, 1 envoyé ignoré ; âge du plus ancien en attente ≥ 120 s, sans compter l'événement mort plus ancien | Intégration |

### Mesure d'usage — `e2e/analytics.spec.ts`

ADR-008 : le script d'Umami n'est chargé que si `UMAMI_SCRIPT_URL` et `UMAMI_WEBSITE_ID` sont définis, lus dans `.env` comme par l'application. Le contrôle de chaque envoi (`beforeSend` : chaîne de requête, identification, événements hors liste) est couvert par `src/components/analytics.test.ts`.

| ID | Scénario | Niveau |
|---|---|---|
| USAGE-01 | Sans configuration (CI), `/login` ne charge aucun script d'Umami ; configuré, la balise porte le site, `data-exclude-search`, `data-exclude-hash` et sa fonction `data-before-send` | UI |

### Notifications — `e2e/notifications.spec.ts`

NOTIF-01 à 05 et NOTIF-10 appellent l'API puis lisent `outbox_events` en connexion d'administration : ce que la soumission et la décision écrivent dans la même transaction. NOTIF-06 à 09 et NOTIF-11 font tourner `processNextEvent` avec les handlers de notification (`notificationHandlers`) sur la vraie base, limité à l'entreprise du test, et lisent les emails arrivés dans Mailpit ; NOTIF-09 remplace l'envoi par un `NotificationPort` en panne, sur un événement de test d'un type unique ; NOTIF-11 insère un événement par RH sous un type unique, fait échouer l'envoi pour une seule RH et délègue le reste à l'adaptateur réel.

La suite reste verte avec ou sans `make worker` en cours d'exécution (ADR-003 §5 : le worker ne conditionne pas les E2E) : aucun test n'attend qu'un événement réel soit encore « pending », et l'état « sent » est attendu (`expect.poll`) plutôt que lu aussitôt. Les exécutions laissent des événements « pending » dans les entreprises `*.e2e.test` (purgées au début de l'exécution suivante) : un worker lancé juste après une exécution de tests commence donc par les vider vers Mailpit.

| ID | Scénario | Niveau |
|---|---|---|
| NOTIF-01 | Soumission d'un employé : un événement `expense_note.submitted` pour son manager (description, nom du soumetteur) | API |
| NOTIF-02 | Soumission d'un manager racine : un événement `expense_note.submitted` par RH de l'entreprise, chacun avec un seul destinataire | API |
| NOTIF-03 | Soumetteur sans approbateur : note créée, aucun événement | API |
| NOTIF-04 | Décision du manager : un seul événement `expense_note.decided`, même après des décisions répétées (409) | API |
| NOTIF-05 | Rejet par la RH d'une note de manager racine : événement pour le manager | API |
| NOTIF-06 | Note soumise : email au manager, avec lien, sans montant ; Message-ID stable ; événement « sent » | Intégration |
| NOTIF-07 | Note approuvée : email au soumetteur, avec lien vers ses notes | Intégration |
| NOTIF-08 | Payload désignant un utilisateur d'une autre entreprise : aucun email pour lui, événement « sent » | Intégration |
| NOTIF-09 | Envoi en panne : la décision reste acquise, l'événement (de test, type unique) repasse « pending » avec 1 essai et l'erreur | Intégration |
| NOTIF-10 | Deux décisions simultanées du manager (approve et reject) : une seule réussit (200 et 409), un seul événement `expense_note.decided` | API |
| NOTIF-11 | Une adresse RH en échec : l'autre RH ne reçoit pas l'email une seconde fois (un seul email pour elle, événement « sent »), l'événement de l'adresse en échec repasse « pending » avec 1 essai | Intégration |

### Ordre stable des listes — `e2e/list-order.spec.ts`

Les lignes à égalité sont insérées dans un ordre ni croissant ni décroissant par id : sans départage, PostgreSQL les rendrait dans l'ordre de lecture (ADR-004 §7.2).

| ID | Scénario | Niveau |
|---|---|---|
| TRI-01 | Notes identiques sur toutes les colonnes triables : `GET /api/expense-notes` (défaut et les 10 tris `?sort=`) départage par id dans le sens du tri ; listes manager et RH par id croissant | API |
| TRI-02 | `GET /api/hr/users` : homonymes départagés par id croissant | API |

## Résultat de la dernière exécution

**89 / 89 tests verts (100 %)** sur un poste Windows de l'équipe, 0 échec, 0 flaky, sans nouvel essai.

| | |
|---|---|
| Date | 22 octobre 2026 |
| Code testé | `main` @ `e7239b6` |
| Commande | équivalent de `make test-e2e` sans `make` (voir [Lancer les tests](#lancer-les-tests)) : `docker compose up -d --wait`, `npm run migrate:up`, `npm run ensure-bucket`, puis `npm run test:e2e`, qui démarre lui-même `next dev` |
| Durée | 2,6 min avec 4 workers, démarrage à froid de `next dev` et préchauffage des routes compris |
| Environnement | Windows 11, Node 24.16.0, Docker Desktop 29.1.2, PostgreSQL 16.15, LocalStack 3.8.1 (S3), Playwright 1.63.0, Chromium 153 (fourni par Playwright) |

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
Running 89 tests using 4 workers
  ok  1 [chromium] › e2e\access-control.spec.ts:117:7 › Contrôle d’accès par rôle › [ACL-01] …
  …
  ok 89 [chromium] › e2e\signup.spec.ts:148:7 › Inscription › [SIGNUP-07] …

  89 passed (2.6m)
```

Un PostgreSQL 17 natif occupait déjà le port 5433 de ce poste : le Postgres de Docker a été exposé sur 5434 le temps de l'exécution, avec `DATABASE_URL` surchargée dans l'environnement (`.env` inchangé).

### Toutes les exécutions

| Où | Date | Code | Résultat |
|---|---|---|---|
| Windows 11, poste de Stanislas | 22/10/2026 | `main` @ `e7239b6` | ✅ 89/89 en 2,6 min, 4 workers |
| macOS, poste de Florent, `make test-e2e` | 20/10/2026 | `main` | ✅ vert |
| CI GitHub Actions, `ubuntu-latest`, `make test-e2e` | à chaque PR et push sur `main`, ici le 22/10/2026 | `main` @ `e7239b6` | ✅ 89/89 en 1,1 min, 2 workers (job `e2e` : 3 min 34 s) |
| Linux isolé, sans Docker (campagne initiale) | 11/10/2026 | `main` @ `4fad1d3` | ✅ 89/89 en 2,4 min, 1 worker |

macOS : résultat rapporté par Florent dans la mise à jour du 20 octobre de l'ADR-005 ; le commit et la durée n'ont pas été consignés.

### Vérification 2-485 (26 octobre 2026)

Sur macOS, branche de 2-485 intégrant `origin/main` @ `65f13f6` et le contrat de 2-486 : **136/136** avec `npx playwright test --workers=4` en **46,4 s**. Serveur Next.js de développement et worker réels, PostgreSQL/LocalStack/Mailpit via Docker, Chromium 153 de Playwright. Une base dédiée a été créée pour cette campagne ; la base locale existante et `.env` n’ont pas été modifiés.

Avant l’adaptation autorisée de MGR-05 : **135/136**, seul échec sur le texte désormais traduit. Après : **136/136**. Les tests de reproduction unitaires de S6 et Q1.3 ont été observés rouges avant la correction, puis verts. `npm run check` passe : **346 tests unitaires**, lint, types et contrat OpenAPI couvrant les 16 opérations métier. `npm run build` passe également (Turbopack, après nettoyage du cache issu de l’exécution restreinte) ; le build Webpack a aussi été vérifié.

### Campagne initiale (11 octobre 2026)

Environnement Linux isolé, **sans Docker** (registre inaccessible) : PostgreSQL 16.15 et LocalStack 3.8.1 (mêmes versions que `docker-compose.yml`) y tournaient en natif, avec Node 24.21.0, Playwright 1.63.0 et un Chromium 141 (`E2E_CHROMIUM_PATH`) plus ancien que celui fourni par Playwright (153). Google Fonts était inaccessible : police de repli, sans effet sur les tests, et polices simulées localement pour le build de prod. Commande : `npm run test:e2e`, 1 worker, sur une base de dev déjà peuplée par le seed.

Vérifications complémentaires, sur le même code :

- **Parallélisme et répétition** : `npx playwright test --workers=4 --repeat-each=2` → 178/178 en 4,4 min, sur une machine à 2 vCPU (donc fortement surchargée) ; une campagne précédente avec 2 workers et `--repeat-each=3` : 267/267. Une première campagne sous cette charge avait révélé un délai trop court sur la soumission de l'inscription (double hachage bcrypt) ; corrigé par un délai dédié de 30 s (`AUTH_TIMEOUT`) sur les formulaires d'inscription et de connexion.
- **Build de production** (`next build` puis `next start`, via `E2E_BASE_URL`) → 89/89 en 57 s.
- **Sensibilité de la suite** : 16 régressions injectées une à une dans `src/` (puis annulées) ont toutes fait échouer au moins un test : décision manager inversée, filtre entreprise retiré de la liste RH, premier inscrit non RH, type MIME du reçu perdu, contrôle `pending` supprimé côté RH, contrôle d'entreprise retiré du rattachement, tri par défaut inversé, notes tranchées laissées dans la liste manager, liste non rechargée après décision, libellé « approuvée » modifié, URL pré-signée d'1 h, contrôle du propriétaire retiré du reçu, `/hr` non protégé, date OCR ignorée, limite de 10 Mio relevée, 401 → 403 sur les routes manager.
- `npm run lint` et `npm run typecheck` passent (fichiers de test inclus).

**Exécution du 23 octobre 2026, branche de la PR #17** (`feat/2-475-ocr-description`, empilée sur la PR #13 rebasée sur le socle commun de l'outbox) : **115 / 115**, 0 échec, soit les 113 tests de la PR #13 plus OCR-22 et OCR-23. Aucun test existant modifié. Environnement sans Docker : PostgreSQL 16 natif, S3 local (s3rver) à la place de LocalStack, Mailpit 1.31.6 natif, Chromium 153 de Playwright ; Google Fonts inaccessible, donc le build de production n'a pas été vérifié ici (la CI le fait).

## Cas non couverts

### Comportements actuels volontairement non figés (failles ou dette à corriger)

Les références renvoient à `CLAUDE.md` (« Dette connue ») et à l'audit API WS4 (`docs/audit/WS4-Q1-Q3.md`, PR #1).

| Comportement actuel | Réf. |
|---|---|
| Erreurs 500 sans détail interne et rejets asynchrones capturés : désormais couverts par ERR-01 à ERR-03 et les tests unitaires du wrapper | B4/S6, Q1.3, 2-485 |
| Corps JSON invalide ou sans `managerId` sur `PUT …/manager` = détachement silencieux (200) | B7 |
| Validation stricte B7 : désormais couverte par API-01 à API-04 et les tests unitaires de frontière ; refus avant DB/S3 | 2-486 |
| Cycles hiérarchiques acceptés (A → B puis B → A) | B13 |
| Format des clés S3 (`receipts/<compteur>.<ext>`) et champ `receiptKey` : seul le fait que le reçu soit restituable est testé | B14 |
| Rôle figé dans le JWT jusqu'à la reconnexion | B6 |
| Inscription sans preuve d'appartenance au domaine (premier inscrit = RH) | B12 |

Quand l'un de ces points est corrigé, ajouter le test correspondant (un bug corrigé = un test qui échoue avant, passe après).

B8 (deux décisions simultanées pouvant toutes deux réussir) n'est plus dans cette liste : la garde `AND status = 'pending'` de l'`UPDATE` (2-484) la corrige pour les routes de décision, et NOTIF-10 le vérifie côté manager (sans la garde, il échoue : 200 et 200).

### Non testables en E2E en l'état

- Atomicité de la création note + upload S3 (panne S3 ou base en cours de route), idempotence des réessais (B9) : demande une injection de pannes.
- Charge et limites de l'OCR : gros fichiers, durée, concurrence (B10). La distinction entre panne de l'OCR et « rien trouvé » n'existe pas (les deux donnent `{}`, B11) ; seul le cas « type non pris en charge → `{}` » est figé.
- Messages d'erreur de l'UI qui n'apparaissent qu'en cas de panne serveur : « Impossible de charger les notes de frais. », « Impossible de récupérer le reçu. », « Impossible d’analyser ce reçu. », « Échec de l'assignation. ».
- Droits des rôles restreints **pour le code du worker importé dans les specs** (`outbox-worker`, `ocr-outbox`, `notifications`) : ces specs l'exécutent sous la connexion d'administration, elles vérifient la mécanique de l'outbox. Les droits de `expense_worker` sont vérifiés par ISO-10 et par le worker lancé avec l'application (ISO-11, emails des parcours NOTIF et OCR).

### Hors périmètre de cette suite

- Navigateurs autres que Chromium, affichage mobile, accessibilité, performances.
- Protocole Auth.js lui-même (seuls les parcours qui l'utilisent sont testés), méthodes HTTP non implémentées (405), `HEAD` / `OPTIONS`.
- Affichage des dates à l'ouest de UTC : `new Date('YYYY-MM-DD')` peut afficher la veille. Les tests tournent en `Europe/Paris`.
- Contenu des notes de démonstration du seed (seuls les comptes et l'organigramme sont vérifiés, AUTH-09).

## Faire évoluer la suite pendant la refacto

- Un test rouge signale une régression, **sauf changement de comportement voulu** : mettre alors le test à jour dans la même PR et le signaler dans la description (règle de `CLAUDE.md`).
- Les attentes susceptibles d'évoluer sont regroupées :
  - format d'erreur `{ "error": … }` → `expectApiError` dans `e2e/support/api.ts` (par exemple pour passer à `application/problem+json`) ;
  - codes 401 (sans session) / 403 (rôle refusé), corrigés depuis Q1.1 → `e2e/access-control.spec.ts` ;
  - schéma `companies` / `users` → `e2e/support/db.ts` (à garder aligné avec `scripts/seed.mjs`).
- Les données de test (domaines `*.e2e.test`) sont purgées au début de chaque exécution ; celles de la dernière exécution restent en base pour l'analyse d'un échec.

## Dépendance ajoutée

`@playwright/test` (devDependency, ^1.63.0). Justification : outil E2E de référence recommandé par la documentation Next.js, qui couvre à la fois le navigateur et l'API HTTP, isole chaque utilisateur dans son propre contexte et produit des traces exploitables en cas d'échec. Aucun impact sur le build de production.

## Contrat API (2-486)

`openapi.yaml` couvre les 16 opérations métier actuelles. Les contextes API des fixtures vérifient leurs réponses (statut, contenu, schéma et en-têtes) contre ce contrat, en conservant toutes les assertions métier existantes. Auth.js, S3 et Mailpit sont exclus de cette validation. Voir `docs/api/README.md`.

- API-01 : montants stricts, plafond, calendrier et absence de création sur rejet.
- API-02 : JSON/managerId invalides sans détachement ; `null` explicite conservé.
- API-03 : neuf UUID de chemin invalides → 400, session/rôle prioritaires.
- API-04 : reçus vides, PNG falsifié/tronqué et PDF corrompu refusés ; PDF réel → OCR vide.

NDF-07 et RECU-03 utilisent des octets JPEG/WebP/PDF réels depuis le commit de fixtures de 2-486. Le helper PDF possède une table xref et des offsets exacts.

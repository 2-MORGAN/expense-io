# ADR-001 — Stratégie d'isolation multi-tenant

| | |
|---|---|
| Statut | **Acceptée** le 20 octobre 2026 par le PO (Florent). Proposée le 18 octobre. **Précisée le 23/10** : mise en œuvre du point de coordination avec l'ADR-003 (voir ce point) |
| Auteur | Amalraj Soupramanien (WS1 Sécurité) |
| Date | 18 octobre 2026 |
| Ticket | 2-380 (jalon J3 « ADR validées ») |
| Commit étudié | `4fad1d3` (`main`) |
| Livrable | `docs/adr/` et SharePoint ARLA `Rendu/W2/` |
| Mise en œuvre | Tickets Linear du jalon J4 : voir §7 |
| Entrées | Audits WS1 `docs/audit/WS1-S1-S3.md`, `docs/audit/WS1-S4-S9.md` (PR #2) ; WS2 `docs/audit/WS2-A1-A3.md` ; WS4 `docs/audit/WS4-Q1-Q3.md` ; suite E2E WS5 `docs/tests/E2E.md` ; ADR-003 (WS3, création de note et traitements asynchrones) |

## Décisions en bref

| Question | Décision |
|---|---|
| 1. Où isoler ? | **RLS effective** sous un rôle applicatif non-superuser : la base porte la frontière entre entreprises et la visibilité par rôle. Un **module de permissions** interne au monolithe (WS2) porte les règles d'action. `WHERE` existants conservés en défense en profondeur. Bascule de la connexion en dernier |
| 2. Comment identifier l'entreprise ? | **Faille corrigée** (décision du PO) : le domaine email ne donne plus aucun droit. S'inscrire sans invitation crée sa propre entreprise ; rejoindre une entreprise passe par une **invitation de la RH**, qui vaut vérification d'email ; vérification d'email obligatoire pour le créateur ; création atomique entreprise + RH |
| 3. Build ou Buy pour l'identité ? | **Garder Auth.js.** S5 : secret en environnement, vérifié au démarrage, rotation. S9 : rôle et entreprise relus en base à chaque appel, session de 8 h d'inactivité. Limite de tentatives dans `authorize()` |
| 4. Comment le prouver ? | Tests d'isolation ajoutés à la suite E2E du projet, rouges avant et verts après correctif (ISO-04 à 09, SIGNUP-08), avec l'application sous le rôle restreint. Tests supplémentaires validés par le PO |

## 1. Contexte

Expense.io est un SaaS B2B multi-tenant : un tenant = une entreprise. Une fuite de notes de frais entre entreprises est « le pire incident pour un B2B » (cours 2, étape 2).

**Cause commune de S2, S3 et S4.** L'isolation repose sur des `WHERE` écrits à la main dans chaque route ; deux oublis ont été reproduits (S2, S3). Les policies RLS existent, mais seulement sur `expense_notes` ([`init-schema.sql:39-40`](../../migrations/1700000000001_init-schema.sql#L39-L40)), et l'application se connecte avec le superuser de l'image PostgreSQL (`docker-compose.yml:5-7`, `.env.example:2`), qui les contourne (S4).

**Spike du 18/10** (rôle non-superuser temporaire, transaction annulée, annexe A). Sans superuser, la RLS isole bien les notes : un contexte inconnu voit 0 note, et la requête fautive de S2 renvoie 0 ligne. Mais :

1. l'`UPDATE` de `receipt_key` après création de note ne modifie plus aucune ligne (régression) ;
2. les policies RH n'ont pas de condition `company_id` ([`init-schema.sql:70-100`](../../migrations/1700000000001_init-schema.sql#L70-L100)) : la RH de l'entreprise B voit en base une note de l'entreprise A ;
3. la table `users` n'a pas de RLS : tous les utilisateurs sont visibles.

Le spike ne teste pas d'`INSERT` : le droit sur la séquence de `receipt_seq` est une exigence à part (annexe B).

**Contraintes.**

- Le comportement décrit dans le `README.md` d'origine fait office de spécification, sauf les corrections décidées explicitement par une ADR (ici S7, question 2). Le projet est évalué par les tests E2E des correcteurs (comportement). D'éventuels tests complémentaires (sécurité, disponibilité, rapidité) restent **à confirmer auprès des intervenants**.
- Données personnelles (notes de frais, reçus) : RGPD.
- Une seule base PostgreSQL 16, un monolithe Next.js.

## 2. Question 1 — Où isoler ?

### Options

| Axe | **A. RLS effective** | **B. Filtrage tenant centralisé dans le code** (repository) | **C. Un schéma par entreprise** | **D. Une base par entreprise** |
|---|---|---|---|---|
| Sécurité | Structurelle : un `WHERE` oublié ne fuit pas | Discipline : une requête hors du repository contourne tout | Forte ; un schéma mal ciblé = fuite | Maximale (physique) |
| Comportement README / E2E | Inchangé si la bascule est bien ordonnée ; sinon régression sur la création de note et la connexion (spike) | Inchangé | Inchangé, refonte lourde | Inchangé, refonte lourde |
| Deadline business | Rien de nouveau à livrer côté produit | Idem | Idem | Provisionnement à chaque nouveau client |
| Coûts | Infra : aucun. Effort : policies, rôles, fonctions ; coût par requête des policies | Aucun | Faibles | Infra ×N |
| Maturité de l'équipe (exploitation) | 1 base, 1 migration ; maîtrise de SQL et des policies requise | 1 base, 1 migration | Migrations ×N, schéma créé à chaque inscription | N bases à créer, migrer, sauvegarder, surveiller |
| Scalabilité | Bonne avec beaucoup de petits tenants | Idem | Se dégrade avec des milliers de schémas | Coût et connexions croissent avec chaque client |
| Souveraineté | Instance par région | Instance par région | Instance par région | Base placée dans la région du client |
| KISS | Policies existantes à corriger | Module à construire | Refonte | Refonte |

### Décision

**A, en deux couches, avec les `WHERE` existants conservés en défense en profondeur.**

- **RLS** : la base porte la **frontière entre entreprises et la visibilité par rôle** (policies propriétaire, manager, RH, corrigées). C'est elle qui rend la fuite « structurellement impossible », comme le dit le cours à propos de l'incident de l'étape 2 (cours 2).
- **Module de permissions** (WS2, branchement de `src/domain/` et `src/ports/`) : il porte les **règles d'action** (qui peut approuver, rejeter, rattacher). Le cours note que la RLS exprime mal un RBAC complexe : si les règles de rôle se compliquent (délégation, réutilisation entre services), les policies seront réduites à la frontière d'entreprise et la visibilité par rôle passera dans le module.
- Le cours présente deux formes pour ce module : monolithe modulaire ou micro-services. Nous retenons le **monolithe modulaire**, dont le déploiement et le monitoring restent simples (cours 2, étape 2), faute de contrainte justifiant un système distribué.
- **B est écartée** : centraliser le filtre dans le code reste de la discipline. **C** est écartée pour sa complexité d'exploitation sans gain de sécurité par rapport à A. **D** est écartée ; **réouverture** si un client exige par contrat l'isolation physique ou la localisation de ses données. C et D ne sont pas des concepts du cours : elles sont jugées sur les axes de trade-offs.
- Build vs Buy (cours 2) : la RLS est une fonction éprouvée de PostgreSQL ; on la rend effective au lieu de reconstruire un filtrage maison.
- **International** : une instance (application + base) par région ; **hypothèse** : une entreprise a une seule région d'attache, donc aucun workflow ne traverse deux régions et aucune base n'est répliquée entre régions (CAP, cours 2, étape 4). **Réouverture** si une entreprise doit faire valider des notes entre régions, le scénario même de l'étape 4.
- **Limite** : la RLS fondée sur un contexte de session ne protège pas d'une injection SQL capable de modifier ce contexte. Corriger S1 reste un prérequis ; « structurellement impossible » vaut pour le `WHERE` oublié.

### Mise en œuvre

Le détail des droits, des policies et du provisionnement est en **annexe B**.

1. **Rôles** : `expense_app` (connexion de l'application, `NOSUPERUSER NOBYPASSRLS`, droits minimaux) ; le rôle propriétaire ne sert qu'aux migrations et au seed (`MIGRATION_DATABASE_URL`, 12-Factor) ; un rôle `NOLOGIN` dédié possède les fonctions `SECURITY DEFINER`.
2. **Contexte** : `withUserScope` pose `app.current_user_id` et `app.current_company_id`, lu en base depuis la ligne de l'utilisateur, jamais depuis le client.
3. **Nouvelle migration** (l'initiale n'est pas modifiée) : condition `company_id` dans les policies RH et manager ; RLS sur `users` ; clé étrangère composite qui interdit structurellement un manager d'une autre entreprise (S3) ; index.
4. **Connexion et inscription**, qui lisent `users` avant de connaître l'utilisateur : deux fonctions `SECURITY DEFINER` à surface étroite (`auth_find_user`, `register_user`). Écarté : un second rôle **de connexion** `BYPASSRLS`, plus large que nécessaire.
5. **Création de note** : selon l'**ADR-003** (section 3), upload S3 d'abord, puis un seul `INSERT` de la note complète dans `withUserScope`, suppression de l'objet si l'`INSERT` échoue, réconciliation quotidienne. Clé `receipts/{companyId}/{noteId}{ext}` : opaque et préfixée par tenant, elle corrige S8. Écarté : une policy `UPDATE` propriétaire (recommandée par l'audit S4), qui s'appliquerait à toute la ligne et permettrait à un employé de modifier le statut de sa propre note.
6. **Suppression des 12 appels `getPool().query`** sur des données tenant (annexe B).
7. **Ordre de bascule** : la migration crée rôles et policies **sans changer la connexion**. Le passage de `DATABASE_URL` à `expense_app` est la **dernière étape**, après la suppression des `getPool()` et l'adaptation du seed, dans une PR validée par la suite E2E complète exécutée sous ce rôle. Au démarrage, l'application vérifie que son rôle n'est ni superuser ni `BYPASSRLS` : refus en production, avertissement en développement.

### Point de coordination avec l'ADR-003 (retenu ; périmètre arbitré par le PO : notifications en P1, abandonnées le 25/10 en cas de retard)

L'ADR-003 introduit trois traitements hors requête HTTP qui portent sur toutes les entreprises : le worker de l'outbox, la réconciliation quotidienne des objets S3 et le nettoyage des notes sans reçu. Sous RLS, ils ne verraient pas leurs données. Proposition :

- `outbox_events` : `expense_app` n'a que l'`INSERT`, contrôlé par une policy `WITH CHECK (company_id = entreprise du contexte)` ; pas de `RETURNING` (il exige `SELECT`). Un rôle `expense_worker` lit et met à jour la table ;
- le worker traite chaque événement dans sa propre transaction, après avoir posé l'entreprise de l'événement : il ne lit `users` que dans cette entreprise. Le payload fige destinataires et description, le worker n'a donc pas besoin de lire `expense_notes` ;
- la réconciliation tourne sous un rôle dédié en lecture seule (`BYPASSRLS`, `SELECT (receipt_key)`), pas sous le superuser ; le nettoyage ponctuel, sous le rôle propriétaire ;
- le seed écrit la clé de reçu dès l'`INSERT`, pour rester compatible avec la contrainte `CHECK (receipt_key <> '')` de l'ADR-003.

**Mise à jour du 23/10 (PO), après la revue des PR #13, #15 et #16.** La policy d'insertion sur `outbox_events` est livrée avec la table (PR #15) ; le reste du point est porté par la bascule :

- **En attendant 2-481**, le worker se connecte avec le rôle propriétaire, comme toute l'application : risque accepté, il n'élargit aucun accès tant que la bascule n'a pas eu lieu.
- **2-481 doit livrer**, en plus de la bascule de l'application :
  1. le rôle `expense_worker` et ses policies `SELECT` / `UPDATE` sur `outbox_events`, avec un test de la policy d'insertion (vérifiée seulement à la main dans la PR #15) ;
  2. le **nettoyage des analyses OCR** (PR #13) adapté : il liste aujourd'hui `receipt_analyses` sans contexte. Le listage passe par le rôle de réconciliation en lecture seule, les écritures sous le contexte de l'utilisateur de l'analyse ;
  3. la **vérification du rôle au démarrage du worker** (ni superuser ni `BYPASSRLS`), comme pour l'application ;
  4. l'usage de `withSystemTransaction` (transaction sans contexte utilisateur, PR #15) **réservé au worker et à l'outbox** par une règle de lint, sur le modèle de `getPool()`.
- **2-478 (RLS sur `users`)** : la policy doit laisser un manager racine trouver les RH de son entreprise au moment de soumettre une note (`enqueueSubmitted`), ou cette recherche passe par une fonction `SECURITY DEFINER` étroite. Sinon, aucun événement n'est écrit et la RH n'est jamais notifiée, sans erreur. Un test le couvre.

## 3. Question 2 — Comment identifier l'entreprise ?

### Constat

À l'inscription, l'entreprise et le rôle sont déduits du domaine de l'email ([`src/app/actions/auth.ts:41-63`](../../src/app/actions/auth.ts#L41-L63)) : le premier compte d'un domaine crée l'entreprise et en devient RH, les suivants la rejoignent comme employés (S7). Un **attribut non prouvé**, le domaine d'une adresse déclarée et jamais vérifiée, décide d'une **autorisation** : l'entreprise et le rôle. Le cours 3 distingue authentification et autorisation ; le cours 2 (étape 1) fait du « compte par entreprise » une fonction de base du produit.

Impact vérifié dans le code : la RH d'un domaine voit l'annuaire (nom, email) de tous les inscrits de ce domaine, peut les rattacher, et voit et tranche les notes des managers racines ; elle ne voit pas les notes des employés. Le premier inscrit en `gmail.com` obtient ces droits sur tous les comptes Gmail suivants. Le scénario le plus grave : **préempter la RH d'une entreprise** en s'inscrivant le premier sur son domaine. Lu dans le code, non reproduit : l'unicité de l'email est sensible à la casse.

Cette règle est aussi décrite dans le `README.md` d'origine comme une fonctionnalité (l. 45-47) : « le premier compte créé sur un domaine email donné fonde une nouvelle entreprise et en devient RH ; les comptes suivants sur le même domaine la rejoignent comme employés ». La décision dépendait donc de son statut, **spécification à respecter** ou **faille plantée à corriger**. L'auteur recommandait l'hypothèse « spécification », pour ne pas exposer le projet aux tests E2E des correcteurs. **Le PO a tranché le 20/10 : faille à corriger**, les intervenants ayant indiqué que certaines fonctionnalités de base sont à corriger. L'hypothèse « spécification » est conservée plus bas comme alternative écartée.

Vérification d'email, invitations et vérification de domaine ne sont pas des concepts du cours : elles sont jugées sur les axes de trade-offs.

### Options

| Axe | **A. Statu quo** | **B. Domaine + vérification d'email** | **C. Invitations** | **D. C + domaine vérifié (DNS)** |
|---|---|---|---|---|
| Sécurité | Usurpation d'adresse, regroupement d'inconnus, préemption de la RH | Plus d'usurpation ; regroupement par domaine public et préemption conservés | Appartenance explicite, prouvée par le lien d'invitation | Idem C, si chaque arrivant vérifie son email |
| Souveraineté / RGPD | Données exposées à une RH illégitime | Idem sur domaines publics ; fournisseur d'email = sous-traitant | Fournisseur d'email = sous-traitant | Idem C |
| Deadline business (arrivée des clients) | Immédiate | Une étape de plus | La RH invite chaque salarié | Automatique pour les domaines vérifiés |
| Coûts / exploitation | — | Envoi d'emails | Emails + table d'invitations | C + vérification DNS + table des domaines |
| Comportement du README | Respecté | Modifié (connexion différée) | **Modifié** | **Modifié** pour les domaines non vérifiés |

Deux options sont écartées sans tableau : l'arrivée sur un domaine soumise à l'approbation de la RH (même rupture du README que C, sans prouver l'adresse) ; une brique « buy » d'organisations et d'invitations (Keycloak, Auth0) ou un SSO d'entreprise, qui suit la décision de la question 3 et sa condition de réouverture.

### Décision retenue : la règle est une faille, corrigée par invitations (C)

**Décision du PO du 20/10.** Les intervenants ont indiqué que certaines fonctionnalités de base de l'application sont à corriger, et c'est attendu. Un attribut non prouvé (le domaine d'une adresse déclarée) ne doit plus décider d'une autorisation. On passe à **C** : le domaine ne donne plus aucun droit par lui-même.

1. **S'inscrire sans invitation crée sa propre entreprise**, dont on devient RH ; rejoindre une entreprise passe par une **invitation de sa RH**. Le lien à usage unique, envoyé à l'adresse, vaut vérification d'email. L'envoi passe par `NotificationPort` **étendu** d'une méthode adressée à un email (le port actuel n'expose que `notifyDecision(userId…)`), via l'outbox et l'adapter SMTP de l'ADR-003 : inversion des dépendances (cours 2, étape 5). Si l'outbox n'est pas livrée à temps (abandon possible le 25/10), l'invitation est envoyée de façon synchrone par le même adapter.
2. **Vérification d'email obligatoire** pour le créateur d'une entreprise.
3. **Création atomique** de l'entreprise et de sa RH dans `register_user` (question 1, point 4) : aujourd'hui quatre requêtes hors transaction peuvent laisser une entreprise sans RH (WS4, B12). **Nouvelle migration** : `companies.email_domain` n'est plus unique (plusieurs entreprises peuvent partager un domaine), avec son `down` ; les entreprises existantes ne sont pas modifiées.
4. **Changement de comportement voulu**, écrit dans la PR, tests mis à jour dans la même PR et dans un commit séparé (`CLAUDE.md`, ADR-005 §2) : SIGNUP-01, 02, 07 et FLOW-01. C'est une correction fonctionnelle de sécurité, pas une refacto.
5. **Risque accepté** : un test des correcteurs qui inscrirait deux comptes sur le même domaine en attendant qu'ils partagent une entreprise échouera. Il est assumé, la correction étant attendue par les intervenants et justifiée ici.

Le cas des domaines de messagerie publics (Gmail…) disparaît : le domaine ne regroupe plus personne.

### Alternative écartée : garder la règle comme spécification (A sécurisée)

Recommandée initialement par l'auteur, non retenue par le PO. Elle consistait à garder la règle décrite par le README, avec la création atomique, un écart sur les domaines publics (chaque compte d'un domaine public fonde sa propre entreprise) et sans vérification d'email. Elle ne changeait pas le parcours d'inscription, mais laissait deux risques graves : rejoindre une entreprise avec l'adresse d'un autre, et **préempter la RH d'une entreprise** en s'inscrivant le premier sur son domaine.

**D en réouverture** (KISS, cours 2, étape 5) : si des clients demandent l'arrivée automatique de leurs salariés. Elle exige alors la vérification d'email de **chaque** arrivant : un domaine vérifié prouve que l'entreprise possède le domaine, pas que l'inscrit possède l'adresse.

## 4. Question 3 — Build ou Buy pour l'identité ?

### Constat

Auth.js v5 (la brique achetée) gère sessions, jetons, cookies (`httpOnly`, `sameSite=lax`) et la protection CSRF ; comptes, mots de passe et inscription sont construits. S5 (secret écrit dans `src/lib/auth.ts`, prioritaire sur l'environnement) et S9 (rôle figé dans le JWT, session de 30 jours d'inactivité par défaut) sont des erreurs de configuration et d'usage, pas des limites de la brique. Lu dans le code, non reproduit : aucune limite de tentatives de connexion ; un email inconnu répond plus vite qu'un mauvais mot de passe (pas de `bcrypt.compare`) ; l'inscription révèle les comptes existants (message figé par SIGNUP-03).

### Options

| Axe | **A. Garder Auth.js, corriger S5/S9** | **B. Keycloak** (auto-hébergé) | **C. Auth0 / Clerk** (SaaS) |
|---|---|---|---|
| Comportement du README (`/login`, `/signup`) | Inchangé | Changé | Changé |
| Sécurité | S5, S9 corrigées ; ni MFA, ni SSO, ni réinitialisation de mot de passe aujourd'hui | Complet (MFA, SSO, anti-force brute) | Complet |
| Disponibilité | Aucun composant ajouté | Nouvelles connexions impossibles si Keycloak tombe (sessions existantes conservées) | Dépendance externe |
| Coûts | Aucun en licence ; la part construite grossit | Hébergement | Abonnement par utilisateur |
| Souveraineté / RGPD | Données chez nous | Données chez nous | Éditeur soumis à une juridiction hors UE, même hébergé en UE |

### Décision

**A.** La brique achetée est en place et n'est pas en cause ; la remplacer a un coût sans corriger S5 ni S9 par elle-même, et B comme C changent les parcours décrits dans le README. Build vs Buy (cours 2) : cette décision **augmente la part construite** (limite de tentatives, relecture du rôle), alors que c'est la maintenance qui coûte. **Réouverture** : si SSO ou MFA est exigé, ou si la part construite grossit (réinitialisation de mot de passe, vérification d'email, MFA), Keycloak est branché comme fournisseur OIDC d'Auth.js, sans remplacer l'existant.

1. **S5 — secret** (12-Factor, cours 2) : lu uniquement depuis l'environnement. Vérifié au démarrage dans `instrumentation.ts`, à l'exécution et non au build : secret absent, trop court ou égal à la valeur d'exemple → refus en production, avertissement en développement. `make env` génère un secret aléatoire et `.env.example` ne contient plus de valeur utilisable. **Rotation** : Auth.js permet une rotation progressive (`AUTH_SECRET_1..n`) ; on ne l'utilise pas, car l'ancienne valeur est compromise par l'historique git : l'invalidation de toutes les sessions est voulue.
2. **S9 — révocation** : le callback `jwt` relit rôle et entreprise via `withUserScope`, à chaque appel de `auth()`, soit jusqu'à trois lectures par navigation (proxy, layout, page), dédupliquées avec `cache()` de React. Compte supprimé → session invalide. Cours 3 : le JWT est « stateless, mais révocation difficile avant expiration » ; on paie le lookup du jeton opaque pour obtenir la révocation immédiate. Les sessions stockées en base sont impossibles : Auth.js n'accepte le fournisseur `Credentials` qu'en stratégie JWT (`@auth/core/lib/utils/assert.js:118`). Une erreur de base pendant la relecture efface le cookie (comportement d'Auth.js) : échec fermé assumé, couvert par la mesure de disponibilité. **Session de 8 h d'inactivité** (`maxAge` glissant) : une journée de travail, qui borne aussi l'usage d'un cookie volé.
3. **Limite de tentatives** : contrôle dans `authorize()`, seul point commun à la server action `/login` et à `/api/auth/callback/credentials`, **avant** `bcrypt.compare` (qui protège aussi le CPU). Dans l'interface, message dédié via une sous-classe de `CredentialsSignin` ; sur l'appel direct à l'API, **429** + `Retry-After` (cours 3) en enveloppant le handler. Compteurs dans une table PostgreSQL sans RLS, écrite seulement en cas d'échec ; écartés : la mémoire de l'instance (perdue, non partagée) et Redis (nouvelle dépendance, nouveau point de panne). Par email soumis, qu'il existe ou non (pas d'énumération), par exemple 10 échecs en 15 minutes puis délai temporaire, jamais de blocage définitif ; seuil large par adresse IP, jamais remis à zéro par une connexion réussie ; seuils réglables par variables d'environnement.
4. **Énumération** : `bcrypt.compare` sur un hash factice pour un email inconnu. Le message d'inscription « Un compte existe déjà », figé par SIGNUP-03, est un risque accepté.

Proposé, à faire valider par le PO : un `session_version` lu avec le rôle, sans requête de plus, pour « déconnecter partout » ; une limite sur l'inscription.

## 5. Question 4 — Comment le prouver ?

Les tests s'ajoutent à **la suite E2E du projet** (WS5, `docs/tests/E2E.md`), filet de sécurité face aux tests des correcteurs.

- **Méthode** : chaque PR de correctif montre le test **rouge sur `main`**, puis **vert** après correctif (`CLAUDE.md`). Test de sensibilité, dans la méthode de WS5 : retirer le contrôle applicatif de S2 une fois la RLS active ; ISO-04 doit rester vert.
- **Environnement** : la suite s'exécute avec l'application sous `expense_app` et les fixtures sous le rôle propriétaire (`E2E_DATABASE_URL`, déjà lu par `e2e/support/env.ts`), à documenter dans `.env.example`. Sinon les fixtures cassent, ou la suite reste verte sans rien prouver.
- **Numérotation** : ISO-01 à 03 existent déjà dans la suite WS5 et passent ; ils sont conservés et les nouveaux tests commencent à ISO-04 (validé par le PO).

### 5.1 Tests d'isolation

| ID | Faille | Scénario | Avant | Après |
|---|---|---|---|---|
| ISO-04 | S2 | Manager de A → reçu d'une note de B | 200 + URL pré-signée | 404 `Not found` (comme RECU-05, MGR-09) |
| ISO-05 | S2 | Manager de A → reçu d'une note de A hors de ses subordonnés directs (autre équipe, N+2) | 200 | 404 `Not found` |
| ISO-06 | S3 | RH de A → rattacher un employé de A à un manager de B | 200, rattachement effectif | 409 `Invalid manager` (comme ORG-07) ; le manager de B ne voit pas la note |
| ISO-07a-f | S4 | Test d'intégration de base exécuté par Playwright : (a) rôle de l'application ni superuser ni `BYPASSRLS` ; contexte inconnu → (b) 0 note, (c) 0 utilisateur ; (d) RH de B → 0 note de A ; (e) manager de B avec un lien inter-entreprises → 0 note ; (f) employé → `UPDATE` du statut de sa note = 0 ligne | Rouge | Vert |
| ISO-08 | S4, S8 | Création de note et lecture du reçu sous `expense_app` ; préfixe `receipts/<companyId>/` vérifié par listage S3. Écart voulu : le format de clé n'était pas figé (B14) | Rouge (`receipts/<compteur>`) | Vert |
| ISO-09 | S4 | Lien manager inter-entreprises posé en base (ce qu'un exploit de S3 a pu laisser) : le manager de B ne voit pas la note dans sa liste et ne peut pas la trancher. Preuve HTTP de l'isolation structurelle | Rouge | Vert (404) |
| SIGNUP-08 | S7 | Deux inscriptions sans invitation sur le même domaine → deux entreprises distinctes, aucune ne voit l'autre ; invitation valide → rejoint l'entreprise de la RH ; invitation expirée, déjà utilisée ou pour une autre adresse → refusée (scénarios détaillés dans le ticket 2-496) | Rouge | Vert |

ISO-07 vérifie les policies, que `E2E.md` classe aujourd'hui comme non testables en E2E : cette ligne de `E2E.md` sera mise à jour.

### 5.2 Tests supplémentaires (validés par le PO)

| ID | Sujet | Scénario | Attendu |
|---|---|---|---|
| AUTH-10 | S9 | Manager rétrogradé en base → requête suivante sur une route manager ; variante : compte supprimé ; expiration du cookie | **403** pour le manager rétrogradé (session valide, rôle refusé : règle 401/403 appliquée par la PR #8) ; **401** pour le compte supprimé ; sans reconnexion ; cookie ≤ 8 h d'inactivité |
| AUTH-11 | Tentatives | Échecs répétés sur un compte | Message dédié sur `/login` ; 429 sur `/api/auth/callback/credentials` ; fin du délai testée ; un autre compte se connecte normalement |
| ERR-01 | S6 | Provoquer une erreur 500 par une panne injectée (exception forcée côté serveur en environnement de test). Une date invalide renvoie désormais 400 (ADR-004, B7) | Ni `stack` ni message interne ; identifiant de corrélation présent |
| NDF-13 | S1 | `?sort=length(description)` | Valeur hors liste blanche ignorée, tri par défaut, 200 |
| CONF-01 | S5 | Démarrage avec un secret absent ou égal à la valeur d'exemple | Refus en production (script ou CI) |
| — | Atomicité | Panne injectée sur l'`INSERT` de l'utilisateur à l'inscription | Aucune entreprise sans RH (test d'intégration, ADR-005) |
| — | Rapidité | Volume fixé (par exemple 50 entreprises × 200 notes), p95 des listes employé, manager et RH avant et après RLS et S9, `EXPLAIN ANALYZE` | Pas plus de 20 % de dégradation ; index utilisés |
| — | Garde-fou | Plus aucun `getPool()` sur des données tenant | Règle de lint ou vérification en CI (à préciser avec le cours 4) |

Les tests du worker et de la réconciliation (point de coordination ADR-003) relèvent des tests d'intégration de l'ADR-005 et du ticket T8 de WS3. Les règles de `src/domain/` sont testées sans infrastructure (cours 2, étape 5), avec l'outil choisi par l'ADR-005.

## 6. Conséquences

**Positives**

- Un `WHERE` oublié ne peut plus exposer un autre tenant : la classe de failles de S2, S3 et S4 devient structurellement impossible (ISO-09).
- Création de note sans état incohérent et clés de reçu cloisonnées par tenant (S8), en commun avec l'ADR-003.
- Révocation immédiate des rôles (S9), secret hors du code (S5), limite de tentatives, sans changer de fournisseur d'identité ni de parcours.

**Négatives et risques**

- Deux sources d'autorisation, policies SQL et module de permissions, à garder cohérentes.
- Fonctions `SECURITY DEFINER` et rôles multiples à relire avec soin : mal configurés, ils élèvent les privilèges.
- Coût en rapidité : sous-requêtes des policies et relecture du rôle. Atténué par les index et la déduplication ; mesuré.
- Disponibilité : une panne de base déconnecte les utilisateurs (échec fermé) ; une bascule mal ordonnée casse connexion et création de note.
- La RLS ne protège pas d'une injection SQL : S1 reste un prérequis.
- La part construite de l'identité grossit.
- Question 2 : changement de comportement assumé par le PO. Un test des correcteurs qui inscrirait deux comptes sur un même domaine en attendant qu'ils partagent une entreprise échouera ; la dépendance à l'envoi d'emails ajoute un point de panne à l'inscription.

## 7. Correctifs à créer en tickets

Ordre : correctifs indépendants de l'ADR d'abord, puis par dépendance ; la bascule de la connexion vient en dernier.

| Correctif | Failles | Dépend de l'ADR | Tests |
|---|---|---|---|
| Liste blanche du tri | S1 | Non | NDF-12, NDF-13 |
| Erreurs sans détail interne, identifiant de corrélation | S6 | Non | ERR-01 |
| Contrôle équipe et entreprise sur le reçu manager | S2 | Non | ISO-04, ISO-05 |
| Contrôle d'entreprise du manager cible | S3 | Non | ISO-06 |
| Secret en environnement, vérification au démarrage, rotation, `make env` | S5 | Oui | CONF-01, AUTH-* verts |
| Migration : rôles, policies `company_id`, RLS `users`, clé étrangère composite, fonctions `SECURITY DEFINER`, index — **sans changer la connexion** | S3, S4 | Oui | ISO-07 (sous rôle restreint) |
| Création de note selon l'ADR-003 (T2 de WS3) et seed adapté | S4, S8 | Oui | ISO-08, RECU-* |
| Rôle et entreprise relus via `withUserScope`, session de 8 h d'inactivité | S9 | Oui | AUTH-10 |
| Suppression des 12 `getPool()` sur données tenant | S4 | Oui | Suite complète, garde-fou |
| **Bascule de `DATABASE_URL` sur `expense_app`**, contrôle du rôle au démarrage | S4 | Oui | Suite complète sous `expense_app`, ISO-09 |
| Limite de tentatives, comparaison bcrypt constante | Hors S1-S9 | Oui | AUTH-11 |
| Rôles `expense_worker` et de réconciliation, policy `INSERT` de l'outbox (si retenu avec WS3) | S4 | Oui | Tests d'intégration ADR-005 |
| Création atomique de l'entreprise et de sa RH | S7 | Oui | Test d'intégration avec panne injectée ; SIGNUP-01 vert |
| Invitations, extension de `NotificationPort`, vérification d'email du créateur, migration de `email_domain` | S7 | Oui | SIGNUP-08 et suivants ; SIGNUP-01/02/07 et FLOW-01 mis à jour |

### Tickets Linear (jalon J4, regroupés le 20/10)

| Ticket | Contenu | Priorité | Dépend de |
|---|---|---|---|
| 2-471 | Correctifs rapides : S1, S2, S3, S5 (une PR par faille) | P0 | — |
| 2-478 | Migration RLS : rôles, policies `company_id`, RLS sur `users`, fonctions `SECURITY DEFINER`, création atomique | P1 | — |
| 2-496 | Identité : S7 invitations + vérification d'email, S9 rôle relu à chaque appel (limite de tentatives en bonus) | P1 | 2-471, 2-478 |
| 2-481 | Bascule finale : suppression des `getPool()` + `DATABASE_URL` sur `expense_app` | P1 | 2-471, 2-476, 2-478, 2-496 |

Hors WS1 : S6 → 2-485 (WS4, attend l'ADR-004) ; création de note et S8 → 2-476 (WS3) ; envoi des emails d'invitation et rôles du worker → 2-484 (WS3).

## Annexe A — Spike RLS du 18/10/2026

Rôle temporaire `NOSUPERUSER NOBYPASSRLS` avec `SELECT, INSERT, UPDATE` sur les trois tables, créé dans une transaction **annulée** (rôle absent après coup, vérifié). Entreprise A = seed ; entreprise B « acme » = jeu de test de l'audit WS1 (`hr@acme.test`, `emp@acme.test`).

| # | Vérification (contexte posé comme `withUserScope`) | Résultat |
|---|---|---|
| 1 | Contexte inconnu, `SELECT` sur `expense_notes` | 0 note (3 en superuser) |
| 2 | Contexte `emp@acme.test` | 1 note, la sienne |
| 3 | Contexte `manager@expense.io`, requête de la route S2 sur la note de B | 0 ligne |
| 4a | Sans contexte, `UPDATE receipt_key` comme `POST /api/expense-notes` | 0 ligne mise à jour |
| 4b | Même `UPDATE` avec le contexte du propriétaire | 0 ligne (pas de policy `UPDATE` propriétaire) |
| 5 | Contexte `hr@acme.test` (RH de B), `SELECT` sur `expense_notes` | 1 note de l'entreprise A |
| 6 | Contexte inconnu, `SELECT` sur `users` | 5 utilisateurs, entreprises A et B |

```sql
BEGIN;
CREATE ROLE adr001_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT SELECT, INSERT, UPDATE ON companies, users, expense_notes TO adr001_app;
SET LOCAL ROLE adr001_app;
SELECT set_config('app.current_user_id', '<uuid>', true);  -- contexte de chaque vérification
SELECT count(*) FROM expense_notes;                         -- n° 1, 2, 5
SELECT count(*) FROM expense_notes WHERE id = '<note B>';   -- n° 3
WITH u AS (UPDATE expense_notes SET receipt_key = receipt_key
           WHERE id = '<note B>' RETURNING 1)
SELECT count(*) FROM u;                                     -- n° 4 (valeur inchangée)
SELECT c.name, count(*) FROM users u JOIN companies c ON c.id = u.company_id
  GROUP BY c.name;                                          -- n° 6
ROLLBACK;
SELECT count(*) FROM pg_roles WHERE rolname = 'adr001_app'; -- 0 : rien de persisté
```

Exécuté avec `docker exec -i arla-postgres-1 psql -U expense -d expense_io` sur l'environnement local. `SET LOCAL ROLE` sur une connexion propriétaire convient à un spike, pas à l'application : une injection pourrait faire `RESET ROLE`.

## Annexe B — Exigences de mise en œuvre (question 1)

**Rôles et droits**

| Rôle | Usage | Droits |
|---|---|---|
| Propriétaire (`expense` en local) | Migrations, seed, nettoyage ponctuel | Propriétaire des tables ; `MIGRATION_DATABASE_URL` |
| `expense_app` | Connexion de l'application (`DATABASE_URL`) | `LOGIN NOSUPERUSER NOBYPASSRLS` ; `SELECT, INSERT` sur `expense_notes`, `UPDATE (status)` seulement ; `SELECT` sur `users` sans `password_hash`, `UPDATE (manager_id)` seulement ; aucun droit direct sur `companies` ; `USAGE` sur `expense_notes_receipt_seq_seq` ; `EXECUTE` sur les fonctions d'auth ; `ALTER DEFAULT PRIVILEGES` pour les tables futures |
| `expense_definer` | Propriétaire des fonctions `SECURITY DEFINER` | `NOLOGIN BYPASSRLS`, jamais superuser |
| `expense_worker`, rôle de réconciliation | Traitements de l'ADR-003 | Voir le point de coordination (question 1) |

**Policies**

- `expense_notes` : condition `company_id` (via l'auteur de la note) ajoutée aux policies manager et RH.
- `users` : `SELECT` si `id = app.current_user_id` ou `company_id = app.current_company_id` (la première clause permet à `withUserScope` et à la relecture S9 de lire la ligne de l'utilisateur) ; `UPDATE (manager_id)` réservé à la RH de l'entreprise, avec `WITH CHECK` sur l'entreprise. Aucune policy de `users` n'interroge `users` (sinon « infinite recursion detected in policy »), d'où le contexte `app.current_company_id`.
- Clé étrangère composite `users (manager_id, company_id) → users (id, company_id)`, avec une contrainte d'unicité `(id, company_id)` : un manager d'une autre entreprise devient impossible au niveau du schéma (S3).
- Contexte lu une fois par requête : `(SELECT current_setting('app.current_company_id', true))::uuid` dans les policies.
- Index : `expense_notes(user_id)`, `users(company_id)`, `users(manager_id)`.

**Fonctions `SECURITY DEFINER`** (`auth_find_user`, `register_user`)

- Propriétaire `expense_definer` ; `SET search_path = public, pg_temp` ; `REVOKE EXECUTE … FROM PUBLIC`, puis `GRANT` à `expense_app`.
- `auth_find_user` renvoie une seule ligne par email exact ; `register_user` porte la création atomique de l'entreprise et de sa RH, et l'acceptation d'une invitation (question 2).

**Provisionnement**

- Création des rôles idempotente (`IF NOT EXISTS`), suppression propre dans le `down` (les rôles sont globaux au cluster).
- Mot de passe de `expense_app` lu dans l'environnement par une étape de `migrate:up`, jamais écrit dans le dépôt ; `make env` le génère s'il manque. La séquence du README (`migrate:up`, `seed`, `dev`) suffit à lancer l'application.
- `node-pg-migrate` et `scripts/seed.mjs` lisent `MIGRATION_DATABASE_URL`. Le seed écrit la clé de reçu dès l'`INSERT`.
- Un `.env` existant n'est pas écrasé par `make env` : le contrôle du rôle au démarrage signale un `.env` resté sur le superuser.

**Appels `getPool().query` à supprimer** : `src/app/api/hr/users/route.ts:12` ; `src/app/api/hr/users/[id]/manager/route.ts:15,23,39,48` ; `src/app/api/manager/expense-notes/[id]/receipt-url/route.ts:17` ; `src/app/api/expense-notes/route.ts:103` ; `src/lib/auth.ts:28` ; `src/app/actions/auth.ts:36,44,57,66`.

**Erreurs** : un refus de la RLS sur une écriture lève l'erreur PostgreSQL `42501` ; elle est convertie en 403 ou 404 au format `application/problem+json`, avec S6 et l'ADR-004.

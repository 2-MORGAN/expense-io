# ADR-005 — Harnais de validation : tests, CI et garde-fous

- **Statut** : **Acceptée** le 20 octobre 2026 par le PO (Florent), sauf les points ouverts listés en fin de document
- **Date** : 14 octobre 2026, mise à jour le 19 octobre 2026
- **Auteur** : Stanislas Beguin (WS5 Qualité)
- **Livrable** : `docs/adr/` et SharePoint ARLA `Rendu/W2/`
- **Liens** : [`docs/tests/E2E.md`](../tests/E2E.md) (suite E2E, PR #4 fusionnée) · CI (PR #5 fusionnée) · [ADR-001](ADR-001-isolation-multi-tenant.md) (isolation multi-tenant) · [ADR-003](ADR-003-ocr-soumission-notifications.md) (création de note, WS3) · ADR-004 (contrat d'API) · audits WS1 (S1–S9), WS2 (A1–A3), WS4 (Q1–Q3, B1–B16)

## Contexte

Le barème donne 5 points si 100 % des E2E des correcteurs passent encore après la refacto, et 3 points pour un outillage qui « permet d'être serein » pendant le live coding. Le code est gelé le 28 octobre.

État au 19 octobre 2026, vérifié dans le dépôt et par l'API GitHub :

| Sujet | Constat |
|---|---|
| Tests | 89 tests E2E Playwright, tous verts ; ils ont détecté chacune des 16 régressions injectées pour les éprouver. Ils sont en PR (#4), **pas encore sur `main`**. Aucun test unitaire, d'intégration ni de contrat. |
| Contrôles locaux | `npm run lint` (7 à 10 s) et `npm run typecheck` (6 à 7 s) passent, suite E2E comprise. `npm run build` passe en 27 s **sans base démarrée** : toutes les routes sont dynamiques. Mesures faites sur un portable Windows de l'équipe. |
| CI | Aucune sur `main`. Le workflow de T1 est en PR (#5), empilée sur #4. Sa première exécution est verte : `check` en 50 s, `e2e` en 2 min 40 s (89/89 en 1,3 min, sans nouvel essai), 0 ms facturable. La PR de démonstration #6, qui injecte une URL de reçu valable une heure, échoue sur les 9 tests de reçus (RECU-01 à RECU-07) et sur eux seuls. |
| Branche `main` | Non protégée : ni règle de branche ni ruleset. Tout membre peut y pousser directement. Aucune PR du groupe n'a encore de revue. |
| GitHub | `2-MORGAN/expense-io` est **public**, fork de `NathanPrats/expense-io`, dans une organisation en plan **Free**. Actions est **activé** sur le dépôt (`enabled: true`, `allowed_actions: all`), avec un jeton de workflow en lecture seule. Tous les membres sont admin du dépôt (permission de base de l'organisation : `admin`). |

**Mise à jour du 20 octobre 2026.**

- PR #4 (E2E) et #5 (CI) fusionnées sur `main` : T0 et T1 faits.
- PR #8 fusionnée : codes 401 sans session et 403 rôle refusé (Q1.1). C'est le premier changement de comportement voulu appliqué selon la règle du §2 : décision du PO, tests ACL-01, 02 et 04 mis à jour dans un commit séparé, CI verte.
- `main` est protégée par un ruleset actif (T2 fait) : PR obligatoire avec 1 approbation, checks `check` et `e2e` obligatoires, historique linéaire, ni force-push ni suppression, fusion par squash. `CODEOWNERS` n'est pas encore en place (point ouvert n°2).
- `make test-e2e` est vert sur macOS (poste de Florent). Après un pull qui modifie `package.json`, lancer `npm install` : sans `@playwright/test`, `npm run check` échoue sur les fichiers `e2e/`.

Le harnais doit couvrir trois risques :

1. La refacto des 14 routes (A1–A3, Q3) peut changer un contrat sans que personne le voie.
2. Les correctifs de sécurité (S1–S9) changent volontairement certains comportements. Il faut les distinguer d'une régression.
3. Pendant le live coding, une IA écrit vite et peut « réparer » un test rouge en modifiant le test.

### GitHub Actions est-il gratuit pour ce dépôt ?

Oui, à une condition : n'utiliser que les exécuteurs standard (`ubuntu-latest`). Un point reste à surveiller : le budget de l'organisation.

- [Documentation de facturation GitHub](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions) : « GitHub Actions usage is free for self-hosted runners and for public repositories that use standard GitHub-hosted runners. » Les budgets et plafonds de dépenses ne portent que sur l'usage facturé, et le nôtre ne l'est pas. Seule exception : les *larger runners* sont toujours facturés, même sur un dépôt public.
- [Changements de tarifs 2026](https://github.com/resources/insights/2026-pricing-changes-for-github-actions) : la taxe annoncée pour les exécuteurs auto-hébergés est reportée, et « standard GitHub-hosted or self-hosted runner usage on public repositories will remain free ».
- Fork : le dépôt parent ne contient aucun workflow, et GitHub ne bloque pas ceux du fork : la CI de la PR #5 s'est exécutée sans activation manuelle.
- Organisation : Actions est activé pour tous les dépôts, toutes les actions sont autorisées, et le jeton des workflows est en lecture seule par défaut.
- **Point d'attention, le budget.** L'organisation a un budget Actions de 10 $ par mois qui arrête l'usage une fois atteint ; ses alertes partent vers Amiel. D'autres dépôts privés de l'organisation ont épuisé le quota gratuit le 7 octobre, puis consommé 5,63 $ de ce budget au 12 octobre et 7,85 $ au 19 octobre. À ce rythme, environ 0,30 $ par jour, il sera atteint vers le 25 ou le 26 octobre, avant le gel. En principe, cela ne nous touche pas, car les minutes d'un dépôt public ne sont pas facturables : la première exécution de notre CI (PR #5) compte 0 ms facturable. Mais la documentation de GitHub ne dit pas explicitement qu'un budget épuisé laisse tourner les dépôts publics. Parade : quand le budget sera épuisé, vérifier que nos workflows démarrent encore. S'ils sont bloqués, appliquer le plan B ci-dessous, et les admins de l'organisation décident de relever le budget le temps du rendu.

Plan B si Actions devenait indisponible : pas d'exécuteur auto-hébergé. GitHub le déconseille sur un dépôt public, car une PR venue d'un fork exécuterait son code sur la machine de l'équipe. On lancerait `make verify` en local avant chaque fusion et on collerait le résultat dans la PR.

## Décision

1. **Cinq niveaux de vérification**, chacun contre un risque précis : statique, unitaire, contrat, intégration base, E2E (§1). La suite E2E reste la référence de non-régression.
2. **Un test E2E rouge est une régression**, sauf changement de comportement décidé par une ADR acceptée, signalé dans la PR et approuvé par un responsable des tests (§2).
3. **Une CI GitHub Actions** sur chaque PR et chaque push sur `main`. Elle a deux jobs : `check` (lint, types, unitaires, build) et `e2e`, qui lance `make test-e2e` avec Postgres et LocalStack. Les deux sont obligatoires pour fusionner sur `main`, que protège un ruleset (§3).
4. **Des hooks git** donnent un retour en quelques secondes. Ce n'est pas une garantie : la garantie, c'est la CI.
5. **CLAUDE.md, le README, le modèle d'ADR et des hooks Claude Code** rendent ces règles applicables par un humain comme par une IA (§4).
6. **Observabilité minimale** : logs JSON côté serveur pour les erreurs, avec un identifiant de corrélation. Métriques et traces restent hors périmètre (§5).

## 1. Quels tests, à quel niveau

| Niveau | Outil | Ce qu'il protège | Exemples |
|---|---|---|---|
| Statique | ESLint, `tsc` strict | Erreurs de code et de types, et règles de `CLAUDE.md` traduites en règles de lint | domaine sans `pg`, `next` ni `aws-sdk` ; pas de SQL construit par interpolation (`${…}`) ; pas de `getPool()` hors de `src/lib/db.ts` (ADR-001) ; pas de `test.only` ni de `test.skip` |
| Unitaire | Vitest | Règles métier pures, testées sans infrastructure, en millisecondes | transitions de statut ; qui peut trancher quoi ; validation des entrées (B7) ; liste blanche du tri (S1) ; refus des cycles hiérarchiques (B13) ; clé S3 préfixée par entreprise (S8) |
| Contrat | selon l'ADR-004 | Les réponses réelles respectent le contrat publié | voir plus bas |
| Intégration base | Playwright sans navigateur, avec le Postgres et le LocalStack de la CI | Ce que le HTTP ne peut pas voir | policies RLS sous le rôle restreint (ISO-07, S4) ; panne injectée à l'inscription (S7) ; décisions concurrentes (B8) ; création atomique note + reçu (B9) ; worker et réconciliation (ADR-003) |
| E2E | Playwright (89 tests existants) | Comportement observable : parcours UI, codes HTTP, JSON, droits, isolation entre entreprises | [`docs/tests/E2E.md`](../tests/E2E.md) |

Chaque niveau bloque la fusion dès qu'il existe.

**E2E, la référence.** Nous ne connaissons pas les E2E des correcteurs, et notre suite en est la meilleure approximation. Chaque faille corrigée qui se voit en HTTP y ajoute un scénario. En CI, la suite tourne contre `next dev`, comme `make test-e2e` et comme les correcteurs lanceront probablement l'application (`make dev`, d'après le README). Le job `check` vérifie séparément que `next build` passe.

**Unitaires : Vitest.** Deux alternatives sont écartées :

- `node:test`, qui n'ajoute aucune dépendance : Node ne sait pas charger notre domaine. À l'essai, `import('src/domain/ExpenseNote.ts')` échoue avec `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, car les classes utilisent des propriétés de paramètre (`constructor(private readonly props…)`). L'alias `@/*` n'est pas résolu non plus.
- Jest : il faut ajouter un transformeur TypeScript et gérer l'ESM, pour le même service.

Vitest compile le TypeScript lui-même, l'alias `@/*` se déclare en une ligne, et Next.js documente l'intégration. Les tests vivent à côté du code (`src/domain/ExpenseNote.test.ts`). Pas de seuil de couverture bloquant, qui pousse à écrire des tests inutiles : on exige un test par règle métier et par bug corrigé, et la revue le vérifie.

**Contrat (ADR-004, acceptée le 20/10).** Confirmé par l'ADR-004 : le contrat est un document OpenAPI versionné dans le dépôt, et les erreurs suivent `application/problem+json`. La CI vérifie alors trois choses :

1. le document est valide (lint OpenAPI) ;
2. chaque `route.ts` a son opération dans le contrat, et inversement ;
3. chaque réponse des tests API de la suite E2E est conforme au schéma de son opération. Un helper placé dans `e2e/support/api.ts`, à côté de `expectApiError`, fait cette validation : les tests existants deviennent des tests de conformité, sans nouveau scénario.

Sont écartés Pact (contrats pilotés par le consommateur, sans intérêt avec un seul client dans le même dépôt) et le fuzzing à partir du schéma, façon Schemathesis (outillage Python, et du bruit tant que B7 n'est pas corrigé).

**Intégration base.** Ces tests arrivent avec les correctifs qui en ont besoin (S4, S7, B8, B9, ADR-003), pas avant. Ce sont les seuls cas que le HTTP ne peut pas observer (section « Non testables en E2E » de `docs/tests/E2E.md`). Par exemple, une policy RLS cassée reste invisible en E2E tant que les `WHERE` des routes protègent les données. Ils s'écrivent avec Playwright, sans navigateur, dans `e2e/` et avec un ID comme les autres scénarios, ainsi que l'ADR-001 le prévoit pour ISO-07. Ils réutilisent la connexion à la base de `e2e/support/db.ts` et tournent dans le job `e2e` de la CI : un seul outillage a besoin d'infrastructure.

**Hors périmètre** : tests visuels, tests de charge, autres navigateurs, mutation testing. La mesure de rapidité prévue par l'ADR-001 (p95 des listes avant et après RLS, au plus 20 % de dégradation) reste une mesure ponctuelle, faite par WS1 et consignée dans sa PR, pas un check de CI : sur des exécuteurs partagés, un seuil de durée serait instable.

## 2. Régression ou changement voulu

Par défaut, un test rouge signale une régression : on corrige le code, pas le test.

| Cas | Exemple | Tests existants | Ce qu'on fait |
|---|---|---|---|
| Refacto sans effet visible | garde de rôle commune, `toExpenseNote` unique (A3) | restent verts | PR normale |
| Ajout compatible | nouveau champ JSON, nouvelle route | restent verts : les assertions `toMatchObject` tolèrent les ajouts | PR normale, avec un test pour l'ajout |
| Correction de faille | S1 `?sort=`, S2 reçu manager, S3 rattachement | restent verts : la suite ne fige pas les failles | nouveau test, vu rouge avant la correction et vert après, qui cite l'ID d'audit |
| Changement incompatible voulu | 401 → 403 (Q1.1), retrait du champ `error`, texte d'UI modifié | à modifier | voir ci-dessous |

Un changement incompatible exige :

1. une ADR **acceptée** qui le décide, avec sa rubrique « Comportement observable » remplie ;
2. la modification des tests dans la même PR, dans un commit séparé ;
3. la section « Changement de comportement » du modèle de PR : IDs des tests, avant → après, lien vers l'ADR ;
4. l'approbation d'un responsable des tests (fichier `CODEOWNERS`).

**Élargir plutôt que casser.** Les E2E des correcteurs vérifient sans doute le comportement d'origine : chaque changement incompatible peut leur faire échouer un test. Jusqu'au rendu, on préfère les évolutions compatibles, par exemple garder le membre `error` dans une réponse `problem+json` (la RFC 9457 autorise les membres d'extension). Un changement incompatible doit être assumé noir sur blanc dans l'ADR qui le décide.

**Garde-fous mécaniques.**

- Les fichiers du harnais (`e2e/`, `playwright.config.ts`, `eslint.config.mjs`, `.github/`, `.claude/`, `CLAUDE.md`, `docs/adr/`) exigent la revue d'un responsable. Une PR ne peut donc pas affaiblir un test ou une règle en silence.
- Une règle de lint interdit `test.skip`, `test.fixme` et `test.only`.
- (Ajout du 28/10.) Une migration ou un test E2E déjà dans `main` ne change plus (`scripts/frozen.mjs`). Le hook `PreToolUse` `.claude/hooks/guard-frozen.mjs` refuse l'écriture à Claude Code, et le job `check` de la CI (`scripts/check-frozen.mjs`, en local `make frozen`) refuse la PR. Ajouter une migration ou un test reste libre. Le label `changement-e2e`, posé après l'ADR acceptée, lève la règle pour les tests ; rien ne la lève pour une migration.
- Un test instable, vert seulement au second essai en CI, donne lieu à un ticket au lieu d'être ignoré.

## 3. Quand et où

| Moment | Ce qui tourne | Durée | Contournable |
|---|---|---|---|
| `git commit` (pre-commit) | ESLint avec cache | ≈ 4 s, 9 s à froid | oui, par `--no-verify`, interdit à l'IA |
| `git push` (pre-push) | `npm run check` : lint, types, unitaires | ≈ 15 s | idem |
| À la demande | `npx playwright test -g "<ID>"` (réutilise le serveur de `make dev`), `make test-e2e`, `make verify` (= ce que fait la CI) | ≈ 3 min pour toute la suite, Docker requis | — |
| PR, push sur `main` | CI : `check` et `e2e`, en parallèle | ≈ 1 min et 3 min (mesuré sur la PR #5) | non, requis par le ruleset |

**Hooks git.** On utilise husky, une dépendance de dev sans dépendance transitive, installée par `npm install`. Les hooks sont de simples scripts shell. Pas de lint-staged : ESLint avec cache sur tout le projet est assez rapide.

**CI** (`.github/workflows/ci.yml`) :

- Déclencheurs : toute PR, y compris une PR empilée sur une autre branche que `main`, push sur `main`, lancement manuel. Sur une PR, un nouveau push annule l'exécution en cours.
- `check`, sans infrastructure : `npm ci`, `npm run check`, puis `npm run build` avec le `.env` d'un poste de dev (`make env`).
- `e2e` : la suite est découpée en 2 shards (`e2e (1/2)`, `e2e (2/2)`), chacun sur sa machine : `npm ci`, Google Chrome du runner via `E2E_CHROMIUM_PATH` (aucune installation, ni téléchargement ni `apt`), les prérequis de `make test-e2e` (`make up migrate ensure-bucket`), puis `npm run test:e2e -- --shard=N/2`. Chaque shard a donc sa base et son propre `next dev`. Le job `e2e` fusionne leurs rapports et échoue si l'un d'eux a échoué : c'est lui le check obligatoire. Images, ports et migrations sont les mêmes qu'en local, car `docker-compose.yml` fait foi : le workflow ne recopie aucune version. Avec `CI=true`, `playwright.config.ts` interdit déjà `test.only`, autorise un nouvel essai, utilise 2 workers et démarre lui-même le serveur. Le rapport Playwright fusionné est publié en artefact pendant 7 jours ; en cas d'échec, chaque shard publie aussi ses traces et captures, et affiche les journaux de Postgres, LocalStack et Mailpit ; les erreurs du serveur (sa sortie d'erreur) figurent dans le journal du shard.
- Aucun secret GitHub : la CI crée son `.env` avec `make env`, qui copie aujourd'hui `.env.example` (base et S3 jetables). Quand S5 sera corrigé, l'ADR-001 prévoit que `make env` génère le secret et que le secret d'exemple soit refusé au démarrage : la CI suivra sans modification. Exécuteurs `ubuntu-latest` uniquement ; version de Node lue dans `.nvmrc`.

**Protection de `main`** (ruleset) :

- PR obligatoire, avec 1 approbation et la revue des responsables pour les fichiers qu'ils possèdent ;
- checks `check` et `e2e` obligatoires ;
- ni force-push ni suppression ; historique linéaire et fusion par squash, pour qu'une PR donne un seul commit, facile à annuler ;
- pas de liste de contournement : les admins aussi passent par une PR. Tous les membres étant admin, chacun peut techniquement modifier le ruleset. On ne le fait qu'avec l'accord du groupe, et le journal d'audit de l'organisation en garde la trace.

On n'exige pas une branche à jour avant fusion. Ce réglage impose une mise à jour et une nouvelle CI à chaque fusion, trop lent pour le live coding. La CI sur `main` détecte le cas de deux PR vertes séparément mais incompatibles. Si `main` devient rouge, on corrige ou on annule avant toute autre fusion. Si le cas se répète, on active la merge queue, disponible pour les dépôts publics d'une organisation.

**Pendant le live coding**, les règles ne changent pas. La boucle est : modifier, `npm run check` (15 s), E2E ciblés par ID, PR, CI, revue, squash. Si `main` casse, on annule la PR fautive avec le bouton « Revert » de GitHub, qui ouvre une PR d'annulation. Si GitHub Actions tombe en panne, on lance `make verify` en local, on colle le résultat dans la PR, puis on ouvre une exception temporaire dans le ruleset, annoncée au groupe et retirée juste après.

## 4. Comment l'IA, et l'humain, s'en servent

**CLAUDE.md.** Une section « Harnais de validation » remplace le paragraphe « Avant de déclarer une tâche terminée ». Elle impose de :

1. Lancer `npm run check` avant de déclarer une tâche terminée. Lancer aussi les E2E concernés (IDs dans `docs/tests/E2E.md`, `npx playwright test -g "<ID>"`, ou `make test-e2e`) dès que le changement touche `src/app`, `src/lib`, `migrations/` ou `scripts/`. Dire explicitement ce qui n'a pas été lancé.
2. Accompagner chaque bug corrigé d'un test vu en échec avant la correction et en succès après. Règle métier : test Vitest à côté du code. Comportement HTTP, UI ou en base : test Playwright identifié dans `e2e/`.
3. Ne jamais modifier, désactiver ni supprimer un test E2E existant pour faire passer la CI. Si un test doit changer, s'arrêter et demander, ADR à l'appui.
4. Ne jamais utiliser `--no-verify`, ne jamais pousser sur `main`, et ne jamais ajouter de `eslint-disable` sans commentaire qui le justifie.
5. Ouvrir les PR sur `2-MORGAN/expense-io` avec `gh pr create --repo 2-MORGAN/expense-io --base main`, en remplissant le modèle de PR. Sur un fork, `gh` sans `--repo` peut viser le dépôt parent.
6. Ne tenir pour décisions en vigueur que les ADR au statut « Acceptée » (index `docs/adr/README.md`).

**Hooks Claude Code** (`.claude/settings.json`, versionné). Ils font respecter ces règles même si le modèle les oublie :

- `Stop` : si du code a changé, lance `npm run check`. Si c'est rouge, l'agent reçoit l'erreur et reprend le travail au lieu de conclure (≈ 15 s).
- `PreToolUse` sur les commandes shell : bloque `--no-verify`, le push sur `main` et le force-push.

Un `AGENTS.md` d'une ligne renvoie vers `CLAUDE.md` pour les autres assistants. Ceux qui les utilisent restent couverts par les hooks git et la CI.

> **Mise à jour du 29/10.** Les règles de la racine sont passées dans `AGENTS.md`, lu directement par Codex, Cursor et Copilot. Comme dans les dossiers, le `CLAUDE.md` de la racine ne fait que l'importer (`@AGENTS.md`) ; `npm run check` le vérifie. Les renvois à `CLAUDE.md` des documents datés (ADR, audits) restent valables par cet import. Le même jour, un quatrième hook, `guard-recipe.mjs`, demande à l'humain s'il faut suivre la recette `/nouvelle-fonctionnalite` avant la première écriture de code d'une session qui ne l'a pas lancée : l'IA propose, l'humain décide (`AGENTS.md`, « Façon de travailler »).

**README.** C'est le point d'entrée commun aux humains et aux LLM : il donne les commandes et renvoie aux sources de vérité, sans recopier leurs règles.

- Démarrer : `make dev`, comptes de démo, prérequis (dont `make` et `bash` sous Windows, via Git Bash ou WSL).
- Vérifier : `npm run check`, `make test-e2e`, `make verify`, ce que fait la CI, badge de statut.
- Contribuer : branche, commits conventionnels déjà en usage (`feat:`, `fix:`, `test(e2e):`, `docs(adr):`), PR vers `2-MORGAN/expense-io`, CI verte et 1 revue, squash, procédure de changement de comportement (§2).
- Carte du dépôt : `CLAUDE.md` (règles), `docs/adr/` (décisions), `docs/tests/E2E.md` (scénarios), contrat d'API (ADR-004), `docs/audit/` (constats).

**Modèle d'ADR** (`docs/adr/ADR-000-modele.md`), avec un index (`docs/adr/README.md` : numéro, titre, statut, date). Le modèle contient :

- un en-tête : statut (Proposée, Acceptée, Rejetée, Remplacée par ADR-n), date, auteur, validateur, tickets ;
- le contexte, qui cite les IDs de constats (S1, A1, Q1, B1…) au lieu de les redire ;
- les options (au moins deux, avec leurs compromis), la décision (en phrases vérifiables) et les conséquences ;
- **Comportement observable** : « aucun changement », ou la liste des routes et écrans touchés (avant → après) avec les IDs de tests E2E. C'est cette rubrique qui autorise à modifier un test (§2) ;
- **Vérification** : comment on sait que la décision est appliquée (test, règle de lint, job CI).

## 5. Quoi observer

Décision : le minimum utile, pas une observabilité de production.

- **Dans le périmètre** : un logger JSON sans dépendance (une vingtaine de lignes) qui écrit les erreurs serveur sur la sortie standard. Champs : horodatage, niveau, méthode, route, statut, identifiant de corrélation, ids utilisateur et entreprise, erreur et pile. Il est branché sur `onRequestError` d'`instrumentation.ts` (Next.js), qui capte aussi les erreurs qui échappent aux `catch` (Q1.3), et sur le futur gestionnaire d'erreurs commun. Son utilité : quand S6 retirera la pile des réponses, ce journal sera le seul moyen de diagnostiquer un 500, y compris en CI.
- **Interdit dans les logs** : mots de passe, jetons, cookies, emails, contenu des reçus, URL pré-signées (elles donnent accès au reçu pendant 5 minutes).
- **Hors périmètre** : métriques, traces distribuées (OpenTelemetry), tableaux de bord, alertes, centralisation des logs (aucun environnement n'est déployé), et journal d'audit des décisions (B16, une fonctionnalité à part entière).
- **Amendement du 27/10/2026** : deux **métriques dérivées des logs** entrent dans le périmètre, sans dépendance ni route : `ocr_requests_total{outcome}` (ligne `ocr.request` du serveur) et l'état de l'outbox (ligne `outbox.stats` du worker, chaque minute). Le détail est dans l'ADR-003 (mise à jour du 27/10). Traces distribuées, tableaux de bord et alertes restent hors périmètre ; la corrélation passe par `requestId`. La CI vérifie en plus l'absence de rupture du contrat d'API (oasdiff, ADR-004 §7.1).
- **Amendement du 28/10/2026 ([ADR-007](ADR-007-observabilite.md), acceptée)** : traces, métriques et journaux OpenTelemetry entrent dans le périmètre **en option**. Ils sont désactivés par défaut, en CI et dans les E2E, et ne démarrent que si `OTEL_EXPORTER_OTLP_ENDPOINT` est défini. La pile Grafana locale (`make observability`) fournit le collecteur, le tableau de bord et les alertes. Les règles du journal ci-dessus (rien de sensible) s'appliquent aussi aux spans et aux journaux exportés.
- Le format des erreurs renvoyées au client, et l'éventuelle exposition de l'identifiant de corrélation, relèvent de l'ADR-004.

## Options écartées

| Option | Pourquoi pas |
|---|---|
| Hooks git seuls, sans CI | Contournables et propres à chaque poste. Les E2E demandent Docker et 3 minutes : personne ne les lancerait à chaque push. |
| Exécuteur auto-hébergé | Déconseillé sur un dépôt public, et inutile : les exécuteurs de GitHub sont gratuits pour nous. |
| E2E en CI sur le build de production seulement | Plus rapide (57 s contre 2,4 min lors de la campagne de `docs/tests/E2E.md`), mais différent de `make dev`, la façon probable dont les correcteurs lancent l'application. Le build est de toute façon vérifié par `check`. |
| Services Postgres et LocalStack déclarés dans le workflow | Recopie les versions de `docker-compose.yml`, qui finiraient par diverger. |
| Vitest avec une base pour les tests au niveau base | Un second outillage de base de données et un job CI de plus, pour quelques tests ; l'ADR-001 place déjà ISO-07 dans la suite Playwright. |
| Formateur (Prettier) | Même réglé sur notre style (guillemets simples, sans point-virgule, 100 colonnes), Prettier 3.6 reformaterait les 62 fichiers TS/JS suivis : conflits assurés avec toutes les PR de refacto. À reconsidérer après le gel. |
| Seuil de couverture bloquant | Pousse aux tests sans valeur ; la règle « un bug = un test » est vérifiée en revue. |
| Merge queue, branche à jour obligatoire | Ajoutent une CI complète à chaque fusion ; gardées en réserve (§3). |

## Conséquences

**Positives**

- Plus aucune fusion sur `main` sans les E2E verts : le critère « 100 % des E2E » est protégé à chaque PR, pas seulement le jour du rendu.
- Un retour en secondes en local et en minutes en CI, avec les mêmes commandes partout.
- Les règles de `CLAUDE.md` deviennent exécutables (lint, hooks, CI) au lieu de reposer sur la discipline, y compris celle de l'IA.

**Négatives et risques**

- Chaque PR attend environ 3 minutes de CI, puis une revue. Il faut des PR petites et des relecteurs disponibles, surtout pendant le live coding.
- Deux dépendances de dev en plus (Vitest, husky), à justifier dans leurs PR.
- En mode dev, la compilation à la demande peut rendre un E2E instable. Le préchauffage de `e2e/global-setup.ts` et le nouvel essai en CI l'atténuent.
- La partie « Contrat » dépend de l'ADR-004 et suivra ses choix.
- Le budget Actions de l'organisation (10 $, arrêt de l'usage) est consommé par d'autres dépôts et sera sans doute épuisé vers le 25 octobre. S'il bloquait aussi les dépôts publics, la CI s'arrêterait avant le gel (parade dans le Contexte).
- Quand l'ADR-001 fera passer `DATABASE_URL` sur le rôle restreint `expense_app`, la suite ne pourra plus préparer ses données tant que T14 n'est pas fait.
- Tous les membres étant admin, le ruleset protège contre l'erreur, pas contre un contournement délibéré.

## Tickets de mise en place

P0 : avant la première fusion de refacto. P1 : avant le gel du 28 octobre. P2 : si le temps le permet.

Tickets Linear (jalon J4, regroupés le 20/10) : T0 ✅ PR #4 · T1 ✅ PR #5 · T2 ✅ ruleset actif · T3, T4 et T11 → 2-477 · T5 et T6 → 2-489 · T7 à T9 → 2-490 · T10 → 2-490 (bonus) · T12 dans les tickets de correctifs concernés · T13 non planifié · T14 → 2-481.

| # | Ticket | Contenu et critère de fin | Prio | Effort | Dépend de |
|---|---|---|---|---|---|
| T0 | Fusionner la suite E2E | PR #4 : la faire relire, la fusionner sur `main` | P0 | revue | — |
| T1 | Workflow CI | PR #5 : `.github/workflows/ci.yml` (jobs `check` et `e2e`, §3), `.nvmrc`, script `npm run check`, cible `make verify`, artefacts en cas d'échec. Fini quand une PR passe au vert, qu'une PR de démonstration volontairement cassée échoue sur le bon test, et que la durée facturable de l'exécution est nulle (API `actions/runs/<id>/timing`) | P0 | ½ j | T0 |
| T2 | Protéger `main` | Ruleset (§3) ; `.github/CODEOWNERS` pour les fichiers du harnais (§2) : @Arkciin et @Florentjni ; squash seul ; suppression des branches fusionnées. Fini quand un push direct sur `main` est refusé et qu'une PR rouge ne peut pas être fusionnée | P0 | 1 h | T1 (les checks doivent exister) |
| T3 | Hooks git | husky : pre-commit (ESLint avec cache), pre-push (`npm run check`) ; `.eslintcache` ignoré par git | P0 | 1 h | T1 |
| T4 | CLAUDE.md et modèle de PR | Section « Harnais de validation » (§4). `.github/pull_request_template.md` : quoi, pourquoi, vérifications lancées, changement de comportement (tests, avant → après, ADR), nouvelle dépendance justifiée. `AGENTS.md` | P0 | 1 h | — |
| T5 | Tests unitaires | Vitest, alias `@/*`, premiers tests de `ExpenseNote`, `User` et `validators`, ajoutés à `npm run check` | P1 | ½ j | T1 |
| T6 | Lint d'architecture | Règles ESLint natives (`no-restricted-imports`, `no-restricted-syntax`, `no-restricted-properties`) : domaine pur ; pas de SQL construit par interpolation (exception commentée pour S1 jusqu'à sa correction) ; pas de `test.only`, `skip` ni `fixme` ; pas de `getPool()` hors de `src/lib/db.ts` (garde-fou de l'ADR-001) ni d'accès base dans un `route.ts` (ADR d'architecture du WS2). Les 12 appels à `getPool()` et les routes actuelles sont listés en exception, et cette liste ne peut que raccourcir | P1 | ½ j | — |
| T7 | Hooks Claude Code | `.claude/settings.json` : `Stop` et `PreToolUse` (§4), sans boucle infinie (`stop_hook_active`) | P1 | 1 h | T1 |
| T8 | README et ADR | README (§4), `docs/adr/ADR-000-modele.md`, index `docs/adr/README.md` (ADR-001 à 005 et leur statut) | P1 | 2 h | — |
| T9 | Logs structurés | Logger JSON, `src/instrumentation.ts`, identifiant de corrélation, sortie du serveur visible en CI (`webServer.stdout: 'pipe'`). À livrer avec le correctif S6 | P1 | ½ j | ADR-004 |
| T10 | Conformité au contrat | Lint du contrat en CI, test de couverture routes ↔ opérations, validation des réponses dans les tests API E2E | P1 | 1 j | ADR-004 et son document de contrat |
| T11 | E2E sur un poste de l'équipe | `make test-e2e` sous Windows et sous macOS, puis mise à jour du « Résultat de la dernière exécution » de `docs/tests/E2E.md` | P1 | 1 h | — |
| T12 | Tests d'intégration base | ISO-07 (policies sous le rôle restreint, S4), panne injectée à l'inscription (S7), décisions concurrentes (B8), création atomique note + reçu (B9), worker et réconciliation (ADR-003) : écrits avec Playwright (§1) dans les tickets de ces correctifs | P2 | inclus | T1 |
| T13 | Protections GitHub gratuites | Secret scanning et push protection, alertes Dependabot, CodeQL en configuration par défaut, non bloquant au départ | P2 | 30 min | — |
| T14 | Suite E2E sous le rôle restreint | `e2e/support/env.ts` se replie sur `MIGRATION_DATABASE_URL` (propriétaire des tables) avant `DATABASE_URL`, qui deviendra le rôle `expense_app` de l'ADR-001, sans droit direct sur `companies`. Fini quand la suite complète passe, en local et en CI, après la bascule de `DATABASE_URL` | P1 | 30 min | ticket de bascule de l'ADR-001 |

## Points ouverts (à trancher par Florent)

1. ~~Hypothèse sur l'ADR-004~~ : **confirmée par l'ADR-004** (acceptée le 20/10) : contrat OpenAPI 3.1 versionné dans le dépôt, erreurs RFC 9457 avec le champ `error` conservé pendant la transition. La §1 « Contrat » et T10 s'appliquent tels quels.
2. Responsables du harnais dans `CODEOWNERS` : Stanislas et Florent, l'un ou l'autre suffisant pour approuver.
3. Permission de base de l'organisation : la passer de `admin` à `write`, en gardant deux admins, pour que le ruleset ne soit plus modifiable par tous.
4. **Urgent.** Budget Actions de l'organisation : accepter de le relever temporairement si nos workflows se trouvaient bloqués une fois le budget épuisé, ce qui devrait arriver vers le 25 octobre, avant le gel.
5. Tests au niveau base écrits avec Playwright plutôt qu'avec Vitest et une base (§1), pour s'aligner sur l'ADR-001 (ISO-07) : à confirmer avec Amalraj.

## Vérification

Cette ADR est appliquée quand :

- une PR qui casse un scénario E2E ne peut pas être fusionnée (la PR de démonstration #6 montre que la CI la signale ; le ruleset de T2 bloque la fusion) ;
- un push direct sur `main` est refusé ;
- une PR qui modifie un fichier du harnais attend l'approbation d'un responsable ;
- `npm run check` et `make verify` existent et sont documentés dans le README et dans `CLAUDE.md`.

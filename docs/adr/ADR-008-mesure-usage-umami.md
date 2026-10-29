# ADR-008 — Mesure d'usage du produit : Umami

| | |
|---|---|
| Statut | **Acceptée** le 28 octobre 2026 par le PO (Florent), fusion avant le gel. Proposée le 28 octobre. **Amendement du 29 octobre proposé** (heatmap, voir en fin de document) |
| Date | 28 octobre 2026 |
| Auteur | Stanislas Beguin (WS5) |
| Validateur | Florent (PO) |
| Tickets | Ticket Linear à créer |

## Contexte

L'[ADR-007](ADR-007-observabilite.md) dit si le service va bien : débit,
erreurs, latence, état du worker. Elle compte aussi, côté serveur, chaque
route : notes soumises, validées ou refusées, suggestions OCR demandées. Elle
ne voit ni ce qui se passe dans le navigateur, ni le chemin d'un visiteur
d'une page à l'autre :

- une suggestion OCR gardée telle quelle ou corrigée avant l'envoi ;
- un formulaire de note commencé puis abandonné, qui ne produit aucune
  requête ;
- les étapes franchies par une entreprise qui s'inscrit, jusqu'à sa première
  invitation ;
- les appareils utilisés pour déposer un reçu.

Après la refacto, l'entreprise doit choisir où investir (OCR, accueil des
nouvelles entreprises, usage mobile). Aucun constat de l'audit ne demande
cette mesure : c'est un outil laissé pour la suite.

Contraintes :

- les E2E des correcteurs doivent rester verts (ADR-005 §2) : aucun changement
  par défaut, rien de plus à lancer pour `make dev`, la CI et les E2E ;
- gel du code le 28 octobre : cette ADR peut être acceptée seule, et sa mise
  en œuvre est découpée en tâches courtes ;
- les règles de l'ADR-005 §5 valent pour tout ce qui sort du serveur et du
  navigateur : les liens d'invitation (`/signup?invitation=…`) portent un
  jeton ;
- les utilisateurs sont les salariés des entreprises clientes : on mesure des
  usages, jamais des personnes.

## Questions

Chaque mesure répond à une question qui mène à une décision. Ce que l'ADR-007
mesure déjà côté serveur ne l'est pas une seconde fois.

| Question | Mesure | Décision possible |
|---|---|---|
| Les salariés gardent-ils la suggestion OCR, ou la corrigent-ils ? | `expense-note-submitted`, propriété `ocr` : `kept`, `edited` ou `none` | investir dans l'OCR (ADR-003) ou l'alléger |
| Combien commencent une note sans l'envoyer ? | `expense-note-started` rapporté à `expense-note-submitted` | simplifier le formulaire |
| Les entreprises inscrites vont-elles jusqu'à inviter un salarié ? | entonnoir : page `/signup/verify` (où mène une inscription réussie), page `/hr`, `invitation-sent` | retravailler l'accueil des nouvelles entreprises |
| Les reçus sont-ils déposés depuis un téléphone ? | appareils de la page `/expenses`, fournis par Umami sans code | prioriser la photo depuis le mobile |

## Options

| Option | Pour | Contre |
|---|---|---|
| A — Les mesures serveur de l'ADR-007 seules (statu quo) | rien de plus à écrire ni à héberger | ne voit ni le navigateur ni le parcours : les quatre questions restent sans réponse |
| B — Umami auto-hébergé, désactivé par défaut | licence MIT ; sans cookie ; une application et une base PostgreSQL ; un script, sans dépendance npm ; événements avec propriétés, entonnoirs, parcours, rétention ; les données restent chez l'éditeur | un service de plus à héberger et mettre à jour ; données gardées sans limite par défaut |
| C — Plausible Community Edition | sans cookie, interface simple | ClickHouse en plus de PostgreSQL ; licence AGPL |
| D — Matomo | configuration dispensée de consentement documentée par la CNIL | PHP et MySQL, étrangers au projet ; plus lourd à exploiter |
| E — PostHog | analyse produit la plus complète | auto-hébergement lourd (ClickHouse, Kafka, Redis…) ; l'enregistrement des sessions est à proscrire ici |
| F — Grafana Faro, dans la pile de l'ADR-007 | le même Grafana | fait pour la performance et les erreurs du front, pas pour l'usage : ni entonnoirs ni rétention |
| G — Google Analytics | rien à héberger | cookies et consentement ; données chez un tiers, hors de l'UE |

## Décision

Option B, désactivée par défaut comme l'ADR-007.

1. **Activation.** Le layout racine charge le script d'Umami si et seulement
   si `UMAMI_SCRIPT_URL` (http ou https) et `UMAMI_WEBSITE_ID` sont définis.
   Sinon aucune page ne contient de balise ni n'envoie de requête vers Umami.
   Le layout étant rendu à chaque requête (il lit la session), ces variables
   sont relues à chaque requête : activer ou couper la mesure ne demande pas
   de nouveau build.
2. **Script.** Chargé par `next/script`, avec `data-exclude-search="true"`,
   `data-exclude-hash="true"` et `data-domains` limité à l'hôte d'`APP_URL`.
   Sa fonction `data-before-send` (`beforeSend`) contrôle chaque envoi : URL
   et référent sans chaîne de requête ni fragment, aucune identification
   (`identify` annulé, identifiant de visiteur retiré), événements et
   propriétés hors liste écartés. Un visiteur reste une session anonyme.
3. **Événements.** Les mesures de la rubrique « Questions », déclarées dans un
   seul module, `src/components/analytics.ts` (`ANALYTICS_EVENTS`) : noms,
   propriétés et valeurs permises, en liste fermée. Un événement d'issue
   (`expense-note-submitted`, `invitation-sent`) part après la réponse
   réussie, pas au clic. L'inscription réussie se lit à la page où elle mène,
   `/signup/verify`, sans événement. Sans script chargé, `trackEvent()` ne
   fait rien.
4. **Données sortantes.** Les règles de l'ADR-005 §5 s'appliquent : ni email,
   ni identifiant d'utilisateur ou d'entreprise, ni montant, ni description,
   ni nom de fichier. Les propriétés n'ont que des valeurs fixes.
5. **Pile locale.** `docker-compose.analytics.yml`, projet Compose séparé :
   `ghcr.io/umami-software/umami:3.4.0` (17 septembre 2026 ; la 3.4.1 du
   23 octobre a moins de deux semaines) et sa propre base PostgreSQL,
   distincte de celle de l'application, qui garde ses rôles et sa RLS
   (ADR-001). Umami écoute sur `127.0.0.1:3002`. Un script crée le site
   « Expense.io » par l'API d'Umami et affiche l'identifiant à mettre dans
   `.env`. `make dev`, `make test-e2e` et la CI ne la lancent pas.

Hors périmètre : l'hébergement de production (instance auto-hébergée ou Umami
Cloud), la durée de conservation, l'information des utilisateurs dans la
politique de confidentialité, et les indicateurs qui se calculent depuis la
base, comme le délai de validation (de la soumission à `decided_at`) : ils
demandent un accès agrégé compatible avec l'ADR-001.

## Mise en œuvre

Chaque tâche est une petite PR qui ne change rien par défaut.

| Tâche | Contenu |
|---|---|
| T1 | Pile locale : `docker-compose.analytics.yml`, `make analytics` et `make analytics-down`, script de création du site, variables de `.env.example` |
| T2 | Script dans le layout racine, désactivé par défaut ; test E2E `USAGE-01` |
| T3 | Module `src/components/analytics.ts` et ses tests Vitest |
| T4 | Les événements : page `/expenses`, `InviteEmployeeForm` |
| T5 | `docs/analytics.md` (démarrer, ce qui est mesuré et ce qui ne l'est pas, lire les rapports, ajouter une mesure) ; vue système et section « Démarrer » de `docs/index.html`, CLAUDE.md |

La PR de cette ADR livre T1 à T5. Décision du PO (28/10) : fusion avant le
gel du 28 octobre, Umami restant désactivé par défaut. Après, l'ADR sert de référence pour la soutenance, comme
l'ADR-003 pour les notifications.

## Conséquences

- Les quatre questions ont une réponse chiffrée, avec les rapports d'Umami
  (entonnoir, parcours, rétention). Une nouvelle question tient en un
  événement déclaré dans le module et une ligne de `docs/analytics.md`.
- Un service de plus à héberger, sauvegarder et mettre à jour : Umami sort
  souvent (3.1 en avril 2026, 3.4.1 en octobre) et fait évoluer le schéma de
  sa base à chaque version.
- En auto-hébergement, les données sont gardées sans limite par défaut : la
  durée de conservation est à fixer avant la production.
- Données personnelles : on mesure des salariés des entreprises clientes.
  Sans cookie ni identifiant, la mesure reste légère, mais l'information des
  utilisateurs et la durée de conservation sont à valider avant la
  production.
- Dette assumée, en local seulement : le compte administrateur créé par
  défaut par Umami, joignable sur `127.0.0.1` seulement.
- Risques : les bloqueurs de publicité arrêtent une partie des scripts de
  mesure, les chiffres sont donc des minimums ; un événement mal placé fausse
  sa question (un test par événement) ; une propriété mal choisie ferait
  sortir une donnée (liste fermée de valeurs, vérifiée par un test).

## Comportement observable

Aucun changement : sans les variables d'Umami, aucune page ne charge son
script, et les tests E2E existants passent sans modification.

## Vérification

- E2E `USAGE-01` (nouveau) : sans les variables, aucune page ne charge Umami ;
  avec, la balise porte `data-exclude-search` et `data-exclude-hash`.
- Tests Vitest du module : noms et valeurs permises, aucun effet sans script,
  chaîne de requête retirée par `data-before-send`.
- Démarrage, scénario de démonstration et lecture des rapports :
  `docs/analytics.md`.

## Amendement du 29 octobre 2026 : heatmap (proposé)

Proposé par Stanislas Beguin (WS5), à accepter par le PO. Les sections
ci-dessus restent la référence ; cet amendement les complète.

**Question.**

| Question | Mesure | Décision possible |
|---|---|---|
| Où cliquent les salariés, managers et RH sur leurs pages de travail, et jusqu'où font-ils défiler ? | heatmap des clics et du défilement de `/expenses`, `/manager` et `/hr`, filtrable par appareil | réorganiser le formulaire de note et les listes |

**Constat.** Umami 3.4 mesure clics et défilement avec un second script,
`recorder.js`, le même que pour les replays (enregistrement de sessions). Ce
script ne passe pas par `data-before-send` et envoie l'URL complète de la page,
chaîne de requête comprise. Une fois chargé, il reste actif jusqu'au prochain
chargement de page, navigations côté client comprises. Umami n'en garde que le
chemin, mais l'URL complète quitte le navigateur : un jeton d'invitation
(`/signup?invitation=…`) partirait avec elle.

**Décision.**

1. **Activation.** `UMAMI_HEATMAP=true`, en plus des deux variables du §1 ;
   sinon aucune page ne charge `recorder.js` (environ 190 Ko). Côté Umami, la
   heatmap s'active dans les réglages du site ; `npm run analytics:setup` le
   fait en local, avec 100 % des sessions.
2. **Pages.** `recorder.js` n'est chargé que sur `HEATMAP_PATHS`
   (`/expenses`, `/manager`, `/hr`), liste fermée de
   `src/components/analytics.ts` : des pages de travail, sans jeton dans leur
   adresse. Les quitter par une navigation côté client recharge la page, ce
   qui arrête le script avant toute autre page.
3. **Données.** Position du clic, tailles de la page et de la fenêtre,
   défilement atteint, URL de la page. Ni texte, ni élément cliqué.
4. **Replays.** Toujours coupés : `npm run analytics:setup` remet
   `replayEnabled: false` à chaque passage. L'enregistrement de sessions reste
   proscrit (option E) : il capterait le texte des pages, montants et noms
   compris.
5. **Entonnoir.** `npm run analytics:setup` crée aussi l'entonnoir de la
   troisième question (« Inscription → invitation », sur 24 h), pour qu'il ne
   dépende pas d'une saisie à la main.

**Conséquences.** Avec la heatmap activée, environ 190 Ko de script en plus
sur les trois pages, et un rechargement de la page suivante quand on les
quitte par un lien ou la déconnexion. Sans `UMAMI_HEATMAP`, rien ne change.
En production, l'échantillon de sessions (15 % par défaut dans Umami) est à
fixer avec la durée de conservation.

**Comportement observable.** Aucun changement par défaut : sans
`UMAMI_HEATMAP=true`, aucune page ne charge `recorder.js`, et les tests E2E
existants passent sans modification.

**Vérification.** Vitest : `recordsHeatmap` et `umamiScriptConfig`
(`recorderSrc`). E2E `USAGE-02` (nouveau) : jamais de `recorder.js` sur
`/signup?invitation=…` ; avec la heatmap, présent sur `/expenses` et retiré
après la déconnexion.

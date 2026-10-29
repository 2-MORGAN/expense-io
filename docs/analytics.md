# Mesure d'usage : Umami

Décision : [ADR-008](adr/ADR-008-mesure-usage-umami.md). Le navigateur envoie à
Umami les pages vues et trois événements, **seulement si `UMAMI_SCRIPT_URL` et
`UMAMI_WEBSITE_ID` sont définis**, et en option la heatmap et les replays de
trois pages (`UMAMI_HEATMAP=true`). Sans ces variables, aucune page ne charge le script, et
l'application se comporte exactement comme avant. C'est le cas par défaut, en CI
et pendant les E2E.

L'[observabilité](observability.md) dit si le service va bien. Cette mesure dit
comment le produit est utilisé, pour décider où investir : chaque événement
répond à une question de l'ADR-008.

## Démarrer

1. Lancer Umami et sa base (environ 1,5 Go d'image au premier lancement) :

   ```bash
   make analytics
   # sans make :
   docker compose -f docker-compose.analytics.yml up -d --wait
   npm run analytics:setup
   ```

   `npm run analytics:setup` crée dans Umami le site « Expense.io », ses
   entonnoirs et ses objectifs (« Lire les réponses ») s'ils n'existent pas, donne au site
   le domaine d'`APP_URL` (port compris), active la heatmap et les replays
   (texte et saisies masqués), puis affiche les lignes à mettre dans `.env`.
2. Les copier dans `.env` :

   ```dotenv
   UMAMI_SCRIPT_URL=http://localhost:3002/script.js
   UMAMI_WEBSITE_ID=<identifiant affiché>
   # en option, heatmap et replays de /expenses, /manager et /hr :
   UMAMI_HEATMAP=true
   ```

3. Relancer `make dev` (ou `npm run dev`).

Umami s'ouvre sur **http://localhost:3002**, avec le compte `admin` / `umami`
qu'il crée à son premier démarrage. Il n'écoute que sur `localhost`.

| Pour | Commande |
|---|---|
| Arrêter Umami, en gardant ses données | `make analytics-down` |
| Tout effacer (visites, événements, site) | `docker compose -f docker-compose.analytics.yml down -v` |
| Couper la mesure | commenter les deux variables dans `.env`, puis relancer `make dev` |
| Couper heatmap et replays seuls | retirer `UMAMI_HEATMAP=true` de `.env`, puis relancer `make dev` |

Port réglable dans l'environnement ou dans `.env` : `UMAMI_PORT` (3002), puis
`npm run analytics:setup` pour les nouvelles valeurs.

## Ce qui est mesuré

| Mesure | Quand | Question de l'ADR-008 |
|---|---|---|
| Pages vues | chaque page, navigation comprise, URL sans chaîne de requête ni fragment | entonnoir d'inscription, appareils de `/expenses` |
| `expense-note-started` | premier champ saisi ou premier reçu choisi, une fois par note | combien commencent une note sans l'envoyer ? |
| `expense-note-submitted`, propriété `ocr` | note créée (réponse réussie) ; `ocr` vaut `kept` (suggestion gardée), `edited` (corrigée) ou `none` (pas de suggestion) | la suggestion OCR est-elle gardée ? |
| `invitation-sent` | invitation envoyée par la RH (réponse réussie) | les entreprises inscrites invitent-elles un salarié ? |
| Heatmap, en option | avec `UMAMI_HEATMAP=true`, sur `/expenses`, `/manager` et `/hr` seulement : position de chaque clic, tailles de la page et de la fenêtre, défilement atteint | où cliquent les utilisateurs de ces pages, et jusqu'où font-ils défiler ? |
| Replays, en option | mêmes pages, même variable : mise en page, souris, clics, défilement, champs saisis, tout texte masqué | où les utilisateurs hésitent-ils ou se trompent-ils sur ces pages ? |

Umami ajoute de lui-même le navigateur, le système, le type d'appareil, la
langue, la taille d'écran et un pays approximatif.

## Lire les réponses

Dans Umami, site « Expense.io » :

- **Suggestion OCR** : événements, `expense-note-submitted`, réparti par la
  propriété `ocr`.
- **Notes abandonnées** : « Funnels », entonnoir « Note commencée →
  envoyée » : `expense-note-started` puis `expense-note-submitted`, dans
  l'heure.
- **Entreprises qui invitent** : « Funnels », entonnoir « Inscription →
  invitation » : page `/signup/verify` (inscription réussie), page `/hr`,
  événement `invitation-sent`, dans les 24 h.
- **En un chiffre** : « Goals », objectifs « Note envoyée » et « Invitation
  envoyée » : part des visiteurs de la période qui envoient une note, une
  invitation.
- **Téléphones** : vue d'ensemble filtrée sur la page `/expenses`, tableau
  des appareils.
- **Clics et défilement** : « Heatmaps », choisir la page, puis « Clicks » ou
  « Scroll » ; filtrer par appareil pour les téléphones. Le fond est la vraie
  page, qu'Umami charge dans une iframe au domaine du site, avec la session
  de ce navigateur : se connecter d'abord à l'application, sinon c'est la
  page de connexion qui s'affiche. Cette iframe compte elle-même une visite ;
  `localStorage.setItem('umami.disabled', '1')`, dans la console de
  l'application, exclut ce navigateur de la mesure.
- **Gestes d'un visiteur** : « Replays », choisir une session : mise en page,
  clics, défilement et saisies rejoués, tout texte remplacé par des `*`. La
  liste masque par défaut les replays de moins de 5 s d'activité (« Replay
  Filter »).

Entonnoirs et objectifs sont créés par `npm run analytics:setup`, qui les
retrouve par leur nom. Umami reconnaît un visiteur à son navigateur et à son
adresse IP : deux comptes ouverts dans le même navigateur comptent pour un.

## Ce qui ne part pas

Tout envoi du script d'Umami passe par `beforeSend` ([`src/components/analytics.ts`](../src/components/analytics.ts)),
qu'il appelle avant chaque requête :

- **URL et référent sans chaîne de requête ni fragment** : les liens
  d'invitation (`/signup?invitation=…`) et de vérification
  (`/verify-email?token=…`) portent un jeton. Le script les retire déjà
  (`data-exclude-search`, `data-exclude-hash`) ; `beforeSend` le refait.
- **Aucune identification** : ni `identify()` ni identifiant de visiteur. Un
  visiteur reste une session anonyme, sans cookie.
- **Seuls les événements de `ANALYTICS_EVENTS`**, avec leurs seules propriétés
  et valeurs permises : un autre nom ne part pas, une autre propriété ou valeur
  est retirée. Donc ni email, ni identifiant d'entreprise ou d'utilisateur, ni
  montant, ni description.

La heatmap et les replays passent par un second script d'Umami, `recorder.js`,
qui ne connaît pas `beforeSend` et envoie l'URL complète de la page. D'où ses
règles (ADR-008, amendement du 29/10) :

- **Pages de `HEATMAP_PATHS` seulement** (`/expenses`, `/manager`, `/hr`),
  dont l'adresse ne porte aucun jeton. Une fois chargé, le script reste actif
  jusqu'au prochain chargement : quitter ces pages par une navigation côté
  client recharge donc la page, ce qui l'arrête avant `/signup?invitation=…`
  (USAGE-02).
- **Heatmap : ni texte ni élément cliqué** : position du clic, tailles de la
  page et de la fenêtre, défilement atteint. Umami ne garde que le chemin de
  la page.
- **Replays : aucun texte** : le `<body>` porte la classe `rr-mask`, que le
  script respecte quel que soit le réglage d'Umami, et `npm run
  analytics:setup` règle en plus le masquage sur « strict ». Noms, emails,
  montants et descriptions deviennent des `*` (USAGE-03). Les champs saisis
  sont toujours masqués, et les reçus s'ouvrent dans un autre onglet : aucune
  URL pré-signée dans la page. Seuls les textes d'exemple des champs
  (`placeholder`) restent lisibles.

## Ajouter une mesure

1. Partir d'une question qui mène à une décision, et l'ajouter à la rubrique
   « Questions » de l'ADR-008.
2. Déclarer l'événement dans `ANALYTICS_EVENTS`
   ([`src/components/analytics.ts`](../src/components/analytics.ts)), avec des
   propriétés à valeurs fixes.
3. L'envoyer avec `trackEvent()` après la réponse réussie, pas au clic : sans
   le script d'Umami, l'appel ne fait rien.
4. Un test dans [`analytics.test.ts`](../src/components/analytics.test.ts) si
   l'événement porte des propriétés, et une ligne dans « Ce qui est mesuré ».

Une question qui se lit côté serveur (requêtes par route, erreurs, outbox)
relève de l'[observabilité](observability.md), pas d'Umami.

## En production

- Héberger Umami (image `ghcr.io/umami-software/umami`, avec sa propre base
  PostgreSQL) ou utiliser Umami Cloud, puis définir `UMAMI_SCRIPT_URL` et
  `UMAMI_WEBSITE_ID`. Le serveur les relit à chaque requête : pas de nouveau
  build.
- Changer le mot de passe du compte `admin` et définir `APP_SECRET`, la
  variable d'Umami qui signe ses sessions.
- `APP_URL` borne la mesure à l'hôte de l'application (`data-domains`) ;
  la heatmap aussi, car `recorder.js` n'envoie rien tant que le script
  principal n'a pas ouvert de session.
- Heatmap et replays : `UMAMI_HEATMAP=true`, puis dans Umami, réglages du
  site, « Replays & Heatmaps » : les activer avec un échantillon de sessions
  (15 % par défaut, 100 % en local) et le masquage « strict ». Le domaine du site doit être l'hôte de l'application,
  et Umami sur le même site qu'elle : les cookies de session
  (`SameSite=Lax`) ne suivent pas une iframe d'un autre site, et le fond
  serait la page de connexion.
- À trancher avant d'ouvrir la mesure à de vrais utilisateurs : la durée de
  conservation (Umami garde tout par défaut) et l'information dans la
  politique de confidentialité (ADR-008, hors périmètre).

## Limites connues

- Les bloqueurs de publicité arrêtent une partie des scripts de mesure : les
  chiffres sont des minimums.
- Un visiteur qui change de navigateur ou d'appareil compte comme un nouveau
  visiteur : l'entonnoir d'inscription suppose que la RH confirme son email et
  invite depuis le même navigateur.
- Le délai de validation d'une note (de la soumission à `decided_at`) se
  calcule depuis la base, pas depuis Umami (ADR-008, hors périmètre).
- Heatmap activée : environ 190 Ko de script en plus sur les trois pages, et
  un rechargement de la page suivante quand on les quitte par un lien ou par
  la déconnexion.
- Un replay montre des gestes, pas un contenu : texte masqué, il dit où l'on
  clique ou hésite, pas sur quelle note. Umami coupe chaque enregistrement à
  5 minutes.

## Dépannage

| Symptôme | Cause probable |
|---|---|
| Aucune visite dans Umami | `UMAMI_SCRIPT_URL` ou `UMAMI_WEBSITE_ID` absent de `.env`, ou `make dev` pas relancé après l'avoir ajouté |
| `npm run analytics:setup` : Umami injoignable | Umami pas démarré : `make analytics` |
| Des visites, mais aucun événement | bloqueur de publicité ; ou événement absent de `ANALYTICS_EVENTS`, écarté par `beforeSend` |
| Rien depuis une autre adresse que celle d'`APP_URL` | `data-domains` ne mesure que l'hôte d'`APP_URL` |
| Heatmap sur une page grise d'erreur | domaine du site sans le port de l'application (`localhost` seul vise le port 80) : `npm run analytics:setup` lui donne l'hôte d'`APP_URL` |
| Heatmap sur la page de connexion | pas de session sur l'application dans ce navigateur, ou Umami sur un autre site qu'elle |
| Heatmap vide | `UMAMI_HEATMAP=true` absent de `.env` ; heatmap coupée dans les réglages du site (`npm run analytics:setup` la rallume) ; page hors de `/expenses`, `/manager` et `/hr` |
| « Replays » affiche « No data available » | l'interface masque les replays de moins de 5 s d'activité : « Replay Filter », durée minimale 0, « Apply » |
| Aucun replay | `UMAMI_HEATMAP=true` absent de `.env` ; replays coupés dans les réglages du site (`npm run analytics:setup` les rallume) ; page hors de `/expenses`, `/manager` et `/hr` |
| Entonnoir vide | personne n'est encore passé par sa première étape sur la période choisie (une inscription pour « Inscription → invitation ») ; il ne compte que les étapes franchies dans l'ordre, dans le délai ; `npm run analytics:setup` le recrée s'il manque |
| Port 3002 déjà pris | `UMAMI_PORT`, puis `npm run analytics:setup` |

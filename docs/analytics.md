# Mesure d'usage : Umami

Décision : [ADR-008](adr/ADR-008-mesure-usage-umami.md). Le navigateur envoie à
Umami les pages vues et trois événements, **seulement si `UMAMI_SCRIPT_URL` et
`UMAMI_WEBSITE_ID` sont définis**. Sans ces variables, aucune page ne charge le
script, et l'application se comporte exactement comme avant. C'est le cas par
défaut, en CI et pendant les E2E.

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

   `npm run analytics:setup` crée le site « Expense.io » dans Umami s'il
   n'existe pas, puis affiche les deux lignes à mettre dans `.env`.
2. Les copier dans `.env` :

   ```dotenv
   UMAMI_SCRIPT_URL=http://localhost:3002/script.js
   UMAMI_WEBSITE_ID=<identifiant affiché>
   ```

3. Relancer `make dev` (ou `npm run dev`).

Umami s'ouvre sur **http://localhost:3002**, avec le compte `admin` / `umami`
qu'il crée à son premier démarrage. Il n'écoute que sur `localhost`.

| Pour | Commande |
|---|---|
| Arrêter Umami, en gardant ses données | `make analytics-down` |
| Tout effacer (visites, événements, site) | `docker compose -f docker-compose.analytics.yml down -v` |
| Couper la mesure | commenter les deux variables dans `.env`, puis relancer `make dev` |

Port réglable dans l'environnement ou dans `.env` : `UMAMI_PORT` (3002), puis
`npm run analytics:setup` pour les nouvelles valeurs.

## Ce qui est mesuré

| Mesure | Quand | Question de l'ADR-008 |
|---|---|---|
| Pages vues | chaque page, navigation comprise, URL sans chaîne de requête ni fragment | entonnoir d'inscription, appareils de `/expenses` |
| `expense-note-started` | premier champ saisi ou premier reçu choisi, une fois par note | combien commencent une note sans l'envoyer ? |
| `expense-note-submitted`, propriété `ocr` | note créée (réponse réussie) ; `ocr` vaut `kept` (suggestion gardée), `edited` (corrigée) ou `none` (pas de suggestion) | la suggestion OCR est-elle gardée ? |
| `invitation-sent` | invitation envoyée par la RH (réponse réussie) | les entreprises inscrites invitent-elles un salarié ? |

Umami ajoute de lui-même le navigateur, le système, le type d'appareil, la
langue, la taille d'écran et un pays approximatif.

## Lire les réponses

Dans Umami, site « Expense.io » :

- **Suggestion OCR** : événements, `expense-note-submitted`, réparti par la
  propriété `ocr`.
- **Notes abandonnées** : `expense-note-started` comparé à
  `expense-note-submitted` sur la même période.
- **Entreprises qui invitent** : rapport « Funnel », étapes : page
  `/signup/verify` (inscription réussie), page `/hr`, événement
  `invitation-sent`.
- **Téléphones** : vue d'ensemble filtrée sur la page `/expenses`, tableau
  des appareils.

## Ce qui ne part pas

Tout envoi passe par `beforeSend` ([`src/components/analytics.ts`](../src/components/analytics.ts)),
que le script d'Umami appelle avant chaque requête :

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
- `APP_URL` borne la mesure à l'hôte de l'application (`data-domains`).
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

## Dépannage

| Symptôme | Cause probable |
|---|---|
| Aucune visite dans Umami | `UMAMI_SCRIPT_URL` ou `UMAMI_WEBSITE_ID` absent de `.env`, ou `make dev` pas relancé après l'avoir ajouté |
| `npm run analytics:setup` : Umami injoignable | Umami pas démarré : `make analytics` |
| Des visites, mais aucun événement | bloqueur de publicité ; ou événement absent de `ANALYTICS_EVENTS`, écarté par `beforeSend` |
| Rien depuis une autre adresse que celle d'`APP_URL` | `data-domains` ne mesure que l'hôte d'`APP_URL` |
| Port 3002 déjà pris | `UMAMI_PORT`, puis `npm run analytics:setup` |

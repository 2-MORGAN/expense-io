# Observabilité : Grafana, métriques, traces et journaux

Décision : [ADR-007](adr/ADR-007-observabilite.md). Le serveur Next.js et le
worker envoient leurs **traces**, leurs **métriques** et leur **journal** en
OpenTelemetry (OTLP/HTTP) à un collecteur, **seulement si
`OTEL_EXPORTER_OTLP_ENDPOINT` est défini**. Sans cette variable, rien n'est
démarré, le serveur ne charge même pas le SDK, et l'application se comporte
exactement comme avant. C'est le cas par défaut, en CI et pendant les E2E.

En local, [`docker-compose.observability.yml`](../docker-compose.observability.yml)
fournit le collecteur et Grafana, avec un tableau de bord et des alertes
versionnés dans [`observability/`](../observability/).

Les métriques dérivées des logs de la PR #39 (ADR-005 §5 amendé) restent
valables sans cette pile : les lignes `ocr.request` (`ocr_requests_total{outcome}`)
et `outbox.stats` du journal. Avec elle, Loki les reçoit et les compte, et le
worker publie aussi l'état de l'outbox en jauges, lu par la même requête
(`outboxStats()`) et sous les noms que la PR #39 annonce.

## Démarrer

1. Lancer la pile d'observabilité (environ 1 Go d'image au premier lancement) :

   ```bash
   make observability
   # sans make :
   docker compose -f docker-compose.observability.yml up -d --wait
   ```

2. Dans `.env`, décommenter `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.
3. Relancer `make dev` (ou `npm run dev`) : le serveur et le worker envoient
   leurs données.

Grafana s'ouvre sur **http://localhost:3001**, sans mot de passe, sur le
tableau de bord « Expense.io — vue d'ensemble ». Les alertes arrivent par
email dans Mailpit (http://localhost:8025). Grafana et la réception OTLP
n'écoutent que sur `localhost`.

| Pour | Commande |
|---|---|
| Arrêter la pile, en gardant ses données | `make observability-down` |
| Tout effacer (métriques, traces, journaux) | `docker compose -f docker-compose.observability.yml down -v` |
| Voir les journaux de la pile | `docker compose -f docker-compose.observability.yml logs -f` |
| Couper l'envoi sans toucher `.env` | `OTEL_SDK_DISABLED=true` |

Ports et base, réglables dans l'environnement ou dans `.env` : `GRAFANA_PORT`
(3001), `OTLP_HTTP_PORT` (4318, changer alors aussi
`OTEL_EXPORTER_OTLP_ENDPOINT`), `OBSERVABILITY_DATABASE_URL`, la base lue par
postgres-exporter depuis son conteneur
(`postgresql://expense:expense@host.docker.internal:5433/expense_io?sslmode=disable`
par défaut ; un autre port publié pour PostgreSQL, comme 5434, se reporte ici),
et `GRAFANA_SMTP_HOST`, le serveur des emails d'alerte
(`host.docker.internal:1025`, le Mailpit de `docker-compose.yml`).

Seul `OTEL_EXPORTER_OTLP_ENDPOINT` active l'envoi. Le point d'un signal
(`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`…) redirige ce signal mais n'active rien
seul : les autres, journal compris, ne partent jamais vers une adresse par
défaut que personne n'a choisie.

## Ce qui est collecté

| Signal | D'où | Où le lire dans Grafana |
|---|---|---|
| Traces | chaque requête servie par Next.js (route, page, server action), ses requêtes SQL ; chaque événement traité par le worker (`outbox <type>`) avec les siennes | Explore → Tempo ; panneaux « Traces en erreur » et « Traces de plus d'une seconde » |
| Métriques | voir le tableau suivant | Explore → Prometheus ; le tableau de bord |
| Journal | chaque ligne de `log()` et `logError()` ([`src/lib/log.ts`](../src/lib/log.ts)), reliée à la trace en cours (`trace_id`) | Explore → Loki : `{service_name="expense-io-web"}` ; panneau « Avertissements et erreurs » |

Le serveur s'appelle `expense-io-web`, le worker `expense-io-worker` :
c'est l'étiquette `service_name` de chaque métrique et de chaque journal.
Chaque processus a en plus son `service_instance_id`, tiré au hasard à son
démarrage : deux workers ne mélangent pas leurs compteurs.

| Métrique (nom Prometheus) | Étiquettes | Source |
|---|---|---|
| `http_server_request_duration_seconds` (histogramme) | `http_request_method`, `http_route` (gabarit : `/api/hr/expense-notes/[id]/approve`), `http_response_status_code` | spans de Next.js ([`spans.ts`](../src/lib/telemetry/spans.ts)) |
| `outbox_events_processed_total` | `outbox_event_type`, `outbox_outcome` (`sent`, `retry`, `dead`) | worker ([`outbox.ts`](../src/lib/telemetry/outbox.ts)) |
| `outbox_handler_duration_seconds` (histogramme) | `outbox_event_type`, `outbox_outcome` | worker |
| `outbox_events_pending`, `outbox_events_due`, `outbox_events_dead` | | worker, relu en base à chaque envoi par `outboxStats()` (celle de la ligne `outbox.stats`), pour les types qu'il traite (un autre type attend un autre worker) |
| `outbox_oldest_pending_age_seconds`, `outbox_lag_seconds` | | worker : âge du plus ancien événement en attente, retard du plus ancien événement dû |
| `ocr_requests_total` | `outcome` | ligne `ocr.request` du journal (PR #39), comptée par Loki : `sum by (outcome) (count_over_time({service_name="expense-io-web"} \| metric="ocr_requests_total" [5m]))` |
| `db_client_operation_duration_seconds` (histogramme), `db_client_connection_count`, `db_client_connection_pending_requests` | `db_operation_name`, `db_client_connection_state` | instrumentation de `pg` |
| `nodejs_eventloop_*`, `v8js_*` | | runtime Node.js |
| `pg_*` | `datname` | serveur PostgreSQL, par postgres-exporter |

Les métriques partent toutes les 15 s (`OTEL_METRIC_EXPORT_INTERVAL`, en
millisecondes), les traces et le journal par lots de quelques secondes. Un
collecteur arrêté ou injoignable ne bloque ni ne ralentit l'application : les
données de l'envoi en échec sont perdues.

## Tableau de bord

[`observability/grafana/dashboards/expense-io.json`](../observability/grafana/dashboards/expense-io.json),
dossier « Expense.io » de Grafana :

- **Vue d'ensemble** : requêtes par seconde, part des 5xx, latence p95 des
  routes API, événements de l'outbox à traiter et en échec, retard du worker ;
- **HTTP** : débit par route, réponses par classe de statut, latence p50, p95
  et p99, routes les plus lentes ;
- **Worker et outbox** (ADR-003) : événements traités par type et issue, durée
  des handlers, file d'attente, retard ;
- **OCR** : suggestions par issue (`ocr_requests_total`, compté par Loki), les
  deux déclencheurs de l'[ADR-003 §2](adr/ADR-003-ocr-soumission-notifications.md)
  (p95 de la suggestion au-dessus de 3 s, plus de 1 % de 503), durée des
  analyses asynchrones ;
- **Base de données** : durée des requêtes SQL, pool de connexions de
  l'application, transactions, connexions, cache et taille côté serveur ;
- **Runtime Node.js** : boucle d'événements et mémoire du serveur et du worker ;
- **Journaux et traces** : avertissements et erreurs, traces en erreur, traces
  lentes.

Un panneau modifié dans Grafana n'est gardé qu'en exportant le tableau de bord
(Partager → Exporter → JSON) dans ce fichier : sinon la modification est perdue
au prochain démarrage de la pile.

## Alertes

Règles de [`observability/grafana/alerting/rules.yaml`](../observability/grafana/alerting/rules.yaml),
évaluées chaque minute, envoyées par email à Mailpit et renvoyées toutes les
4 heures tant qu'elles durent :

| Règle | Seuil | Gravité | Premier geste |
|---|---|---|---|
| Erreurs serveur (5xx) | plus de 5 % des requêtes pendant 5 min | critique | panneau « Avertissements et erreurs » : `http.error`, `request.error` et leur trace |
| Latence p95 des routes API | plus de 1 s pendant 10 min (hors suggestion OCR) | avertissement | « Traces de plus d'une seconde », part de PostgreSQL |
| OCR synchrone lent | p95 au-dessus de 3 s sur une heure | info | déclencheur de l'ADR-003 §2 |
| Nouveaux événements en échec définitif | un événement de plus passe `dead` dans les 15 dernières minutes | avertissement | `outbox_events.last_error`, journal `outbox.dead` |
| Outbox en retard | un événement dû attend depuis plus de 5 min : worker bloqué ou débordé | critique | journal `worker.error`, durée des handlers |
| Worker muet | le serveur répond, le worker n'envoie plus rien depuis 5 min : worker arrêté | critique | le worker tourne-t-il, avec `OTEL_EXPORTER_OTLP_ENDPOINT` ? |

Sans trafic ni worker, les règles n'ont pas de données et restent au repos. Le
worker publie lui-même l'état de l'outbox : arrêté, il ne publie plus rien, et
seule « Worker muet » le signale. Une suite E2E lancée contre la même base
crée volontairement des événements `dead` (OUTBOX-05, OUTBOX-09…) : l'alerte
correspondante se déclenche alors, puis retombe au bout de 15 minutes.

## Simuler des pics de charge

[`scripts/load-peaks.mjs`](../scripts/load-peaks.mjs) fait arriver des
utilisateurs en nombre, puis repartir, pour voir le tableau de bord réagir :

```bash
npm run load:peaks                 # vérifie les prérequis, décrit le profil
npm run load:peaks -- --execute    # le joue, environ 5 min 30
npm run load:peaks -- --execute --users=40 --peaks=1 --peak-seconds=120
```

Sans option, il vérifie que l'application et la base sont locales et
joignables, et que Grafana reçoit bien les métriques du serveur et du worker.
Avec `--execute`, il crée une entreprise jetable `charge-<id>.load.test` : un
RH, un manager pour huit utilisateurs, des salariés répartis entre eux. Il la
crée sous le rôle propriétaire, comme le seed, car le rôle manager ne
s'attribue qu'en base. Les mots de passe sont tirés au hasard et jamais
affichés.

Chaque utilisateur virtuel a son compte, se connecte par Auth.js et joue les
parcours de l'interface, avec les mêmes appels HTTP que le navigateur et 0,5 à
2,5 s de réflexion entre deux gestes :

- **salarié** : consulte ses notes et un reçu, ou saisit une note. Le reçu
  passe par l'analyse OCR (`POST /api/receipt-analyses`, puis un suivi toutes
  les 300 ms), et la note part avec la suggestion. Si l'analyse est refusée
  (503 quand dix analyses attendent déjà), la note part sans suggestion ;
- **manager** : ouvre `/manager`, consulte puis valide ou refuse jusqu'à trois
  notes de son équipe (une sur cinq refusée), ou saisit sa propre note ;
- **RH** : ouvre `/hr`, lit les salariés et tranche les notes des managers.

| Option | Défaut | Effet |
|---|---|---|
| `--users` | 20 | utilisateurs actifs au pic, et comptes créés |
| `--base` | 2 | utilisateurs actifs au calme |
| `--peaks` | 2 | nombre de pics |
| `--peak-seconds` | 60 | durée de chaque pic |

Profil : 30 s d'échauffement, puis pour chaque pic 20 s de montée, le pic,
10 s de descente et 60 s de calme. Le calme laisse voir le worker vider la file.
Toutes les 5 s, la console affiche le débit, la latence p50 et p95, les
statuts, et l'attente de la suggestion OCR telle que la vit l'utilisateur. Ce
dernier chiffre n'existe dans aucune métrique. À la fin viennent un bilan par
phase, les routes les plus lentes et le lien Grafana sur la période. Ctrl+C
arrête proprement et affiche le bilan.

Ce qu'on voit dans le tableau de bord :

| Pendant le pic | Panneaux |
|---|---|
| le débit monte puis plafonne, et la latence grimpe | Vue d'ensemble, HTTP (p50, p95, p99, routes les plus lentes) |
| la boucle d'événements du serveur approche 100 % : le processus est saturé | Runtime Node.js |
| les analyses s'empilent : file et retard de l'outbox montent, puis redescendent au calme | Worker et outbox, Retard du worker |
| refus 503 de l'OCR quand la file d'analyses est pleine, comptés dans la part des 5xx | Vue d'ensemble, OCR |
| pool de connexions de l'application, durée des requêtes SQL | Base de données |
| mémoire du serveur et du worker | Runtime Node.js |

Les chiffres mesurés ne valent que pour le poste qui les produit, et `next dev`
compile et sert moins vite qu'un `npm run build` suivi de `npm run start`. Le
script sert à voir les mécanismes réagir, pas à mesurer une capacité. Il refuse
une `APP_URL` ou une `MIGRATION_DATABASE_URL` qui n'est pas locale. Les comptes,
les notes et les emails de notification (dans Mailpit) restent :
`make clean` les efface avec le reste des données locales.

## Ce qui ne part pas

Les règles du journal ([ADR-005 §5](adr/ADR-005-harnais-de-validation.md))
valent pour tout ce qui part au collecteur :

- **URL sans chaîne de requête** : les liens d'invitation (`/signup?invitation=…`)
  et de vérification (`/verify-email?token=…`) portent un jeton, une URL
  pré-signée sa signature. Les spans gardent le chemin seul.
- **Messages d'erreur et piles nettoyés** comme par `logError()` : emails,
  identifiants de connexion et paramètres d'URL masqués.
- **SQL sans valeurs** : le texte de la requête avec ses `$1`, `$2`, jamais les
  paramètres (`enhancedDatabaseReporting` reste désactivé).
- **Aucun identifiant d'entreprise ni d'utilisateur dans une étiquette de
  métrique** : les métriques couvrent toute la plateforme. Ces identifiants
  restent possibles dans le journal, comme sur la sortie standard.

## Ajouter une mesure

- Les instruments se déclarent dans `src/lib/telemetry/`, avec l'API
  `@opentelemetry/api` seule : sans SDK démarré (tests, E2E, télémétrie
  désactivée), elle ne fait rien. Le domaine n'en dépend pas.
- Nom et unité selon les conventions d'OpenTelemetry (`outbox.handler.duration`
  en `s`) ; Prometheus le traduit (`outbox_handler_duration_seconds`).
- Des étiquettes à peu de valeurs : un type, une issue, un gabarit de route.
  Jamais un identifiant, un email ni une URL réelle.
- Un test avec un lecteur de métriques en mémoire, comme
  [`outbox.test.ts`](../src/lib/telemetry/outbox.test.ts).
- Un panneau, ou une règle d'alerte, dans `observability/grafana/`.
- Sans dépendance, une ligne de journal comptée par Loki suffit pour un
  compteur, comme `ocr.request` (PR #39) : un champ `metric` pour la retrouver,
  des champs à peu de valeurs pour la découper.

## En production

- Pointer `OTEL_EXPORTER_OTLP_ENDPOINT` (avec `OTEL_EXPORTER_OTLP_HEADERS` pour
  l'authentification) vers un collecteur OpenTelemetry ou Grafana Cloud : le
  code ne change pas. `OTEL_RESOURCE_ATTRIBUTES` ajoute par exemple
  `deployment.environment.name=production`.
- `grafana/otel-lgtm` ne sert qu'au développement : un seul conteneur, sans
  haute disponibilité, Grafana ouvert sans mot de passe.
- Toutes les traces sont gardées : un échantillonnage sera à régler avec du
  trafic réel.
- postgres-exporter se connecte ici avec le propriétaire de la base ; en
  production, un rôle membre de `pg_monitor`.

## Limites connues

- Une requête et l'événement de l'outbox qu'elle crée donnent deux traces
  distinctes : la propagation du contexte par l'outbox (le `traceId` du message
  de l'ADR-003) reste à faire.
- `ocr_requests_total` vient du journal : Loki le compte, mais Prometheus ne
  l'a pas, et les alertes OCR s'appuient sur la mesure HTTP de la route.
- Le compte des événements `dead` parcourt `outbox_events`, sans index sur ce
  statut : sans effet à notre volume, à indexer si la table grossit.
- Next.js ne mesure que les requêtes dont il a résolu la route : les fichiers
  de `_next` en développement n'y figurent pas.

## Dépannage

| Symptôme | Cause probable |
|---|---|
| Le tableau de bord est vide | `OTEL_EXPORTER_OTLP_ENDPOINT` absent de `.env`, ou `make dev` pas relancé après l'avoir ajouté |
| Pas de panneau PostgreSQL | postgres-exporter n'atteint pas la base : régler `OBSERVABILITY_DATABASE_URL`, puis `make observability` |
| Pas d'email d'alerte | Mailpit (`make up`) arrêté : Grafana l'atteint par `host.docker.internal:1025` |
| Port 3001 ou 4318 déjà pris | `GRAFANA_PORT`, `OTLP_HTTP_PORT` |
| Grafana répond, sans données récentes | `docker compose -f docker-compose.observability.yml logs lgtm` |

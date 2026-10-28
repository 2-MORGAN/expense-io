# ADR-007 — Observabilité : OpenTelemetry et Grafana

| | |
|---|---|
| Statut | **Acceptée** le 28 octobre 2026 par le PO (Florent). Proposée le 27 octobre. Amende l'ADR-005 §5 |
| Date | 27 octobre 2026 |
| Auteur | Stanislas Beguin (WS5) |
| Validateur | Florent (PO) |
| Tickets | Suite de l'ADR-003 T9 (livré par la PR #39, métriques dérivées des logs) ; ticket Linear à créer |

## Contexte

L'[ADR-005 §5](ADR-005-harnais-de-validation.md#5-quoi-observer) s'en est d'abord
tenue au journal JSON des erreurs. Son amendement du 27/10 (PR #39, chantier T9
de l'ADR-003) y ajoute deux **métriques dérivées des logs**, « sans dépendance
ni route » : une ligne `ocr.request` par suggestion OCR
(`ocr_requests_total{outcome}`) et une ligne `outbox.stats` par minute (événements
en attente, morts, âge du plus ancien). Les traces distribuées y restent hors
périmètre. Ces lignes ne deviennent des chiffres qu'une fois comptées par un
collecteur de logs, que le dépôt ne fournit pas. Trois besoins demandent
davantage :

- **Lire ces mesures, et en être averti.** Les déclencheurs de l'ADR-003 §2
  (p95 OCR au-dessus de 3 s, plus de 1 % de 503) et l'état de l'outbox n'ont
  ni collecteur, ni tableau de bord, ni alerte.
- **Une panne du worker ne se voit pas.** Emails et analyses de reçus passent
  par l'outbox (2-484, 2-503) : un événement bloqué ou `dead` ne produit aucune
  réponse HTTP en erreur. Une ligne par minute ne dit pas si le worker est
  bloqué (retard) ou arrêté (silence).
- **La soutenance et le live coding.** Voir en direct le débit, les erreurs,
  la latence par route, les requêtes SQL d'une requête lente et le worker rend
  le diagnostic rapide, ce que vise l'outillage « serein » du barème.

Contraintes : les E2E des correcteurs doivent rester verts, donc aucun
changement de comportement par défaut ; gel du code le 28 octobre ; rien de
plus à lancer pour `make dev`, la CI et les E2E ; les règles du journal
(ADR-005 §5 : ni jeton, ni email, ni URL pré-signée) valent pour tout ce qui
sort du serveur.

## Options

| Option | Pour | Contre |
|---|---|---|
| A — Métriques dérivées des logs seules (statu quo, PR #39) | aucune dépendance ni route | sans collecteur fourni, ni chiffres, ni historique, ni alerte ; pas de mesure HTTP par route, pas de traces |
| B — Prometheus et `prom-client` (lecture par Prometheus), Grafana | classique, une dépendance | une route `/api/metrics` sur le port public : authentification, contrat OpenAPI, surface d'attaque ; un serveur HTTP de plus dans le worker ; ni traces ni journaux centralisés |
| C — OpenTelemetry en envoi OTLP (traces, métriques, journaux) ; en local, Grafana LGTM (`grafana/otel-lgtm`) dans un compose à part | standard de la CNCF, indépendant du fournisseur (Grafana Cloud, Datadog… sans changer le code) ; Next.js émet déjà des spans (route, statut) ; aucune route nouvelle ; activé par une variable d'environnement ; journaux reliés aux traces | 14 paquets npm d'une même famille, à monter de version ensemble ; une image d'environ 1 Go pour qui lance la pile |
| C' — comme C, avec un conteneur par brique (collecteur, Prometheus, Loki, Tempo, Grafana) | plus proche d'une production | cinq configurations à écrire et maintenir pour un usage de développement |
| D — Service hébergé directement (Sentry, Datadog, Grafana Cloud) | pas d'infrastructure locale | comptes et secrets, données hors de l'équipe (coût, RGPD), pas reproductible par les correcteurs ; l'instrumentation reste à faire, et C la fournit |

## Décision

Option C, qui complète la PR #39 sans la remplacer : les lignes `ocr.request`
et `outbox.stats` restent la base, sans dépendance, et la pile Grafana leur
fournit un collecteur (Loki).

1. **Activation.** Le serveur et le worker envoient traces, métriques et
   journaux en OTLP/HTTP si et seulement si `OTEL_EXPORTER_OTLP_ENDPOINT` est
   défini et `OTEL_SDK_DISABLED` ne vaut pas `true`. Sinon rien n'est démarré,
   et le serveur ne charge pas le SDK. Le point d'un seul signal n'active
   rien : aucun signal ne part vers une adresse par défaut.
2. **Code.** Une couche d'infrastructure `src/lib/telemetry/`, qui seule peut
   importer `@opentelemetry/*` avec le journal ([`layers.ts`](../../scripts/architecture/layers.ts)).
   Démarrage dans `src/instrumentation.ts`, avant les contrôles du secret
   (CONF-01) et du rôle de base (2-481), ce dernier chargeant `pg` ; et dans
   `src/worker/telemetry.ts`, premier import du worker. Ni le domaine ni les cas
   d'usage n'en dépendent.
3. **Mesures.** HTTP : `http.server.request.duration` par méthode, gabarit de
   route et statut, tiré des spans de Next.js ; chaque requête compte, même
   celle qu'un appelant marque non échantillonnée (span enregistré, pas
   exporté). Outbox (ADR-003 T9) : issue et durée de chaque essai, comptées
   après la validation de sa transaction ; en jauges, les chiffres de
   `outbox.stats`, lus par la même requête (`outboxStats()`, étendue aux
   événements dus et au retard) et sous les noms que la PR #39 annonce
   (`outbox_events_pending`, `outbox_events_dead`,
   `outbox_oldest_pending_age_seconds`), pour les types que le worker traite.
   Instrumentations de `pg` et du runtime Node.js. Chaque processus porte un
   `service.instance.id` aléatoire. `ocr_requests_total` reste la ligne
   `ocr.request` de la PR #39, comptée par Loki.
4. **Journal.** Chaque ligne de `log()` part aussi au collecteur, avec les
   mêmes champs, reliée à la trace en cours.
5. **Données sortantes.** Les règles de l'ADR-005 §5 s'appliquent : URL sans
   chaîne de requête (jetons d'invitation et de vérification, signatures),
   messages et piles d'erreur nettoyés comme par `logError()`, SQL sans
   valeurs, aucun identifiant d'entreprise ou d'utilisateur en étiquette de
   métrique.
6. **Pile locale.** [`docker-compose.observability.yml`](../../docker-compose.observability.yml),
   projet Compose séparé : `grafana/otel-lgtm` 0.36.0 et postgres-exporter ;
   Grafana sur `127.0.0.1:3001`, OTLP sur `127.0.0.1:4318`. Tableau de bord,
   six règles d'alerte et envoi des alertes à Mailpit sont provisionnés depuis
   [`observability/`](../../observability/). `make dev`, `make test-e2e` et la
   CI ne la lancent pas.
7. **Dépendances.** OpenTelemetry JS du 6 octobre 2026 (2.12 et 0.223),
   versions exactes : ces paquets sortent ensemble, et `@opentelemetry/api`
   doit rester avant 1.10 pour cette série. La série du 20 octobre (3.0 et
   0.300) n'est pas retenue : une semaine d'ancienneté, nouvelle version
   majeure.

Hors périmètre : un collecteur de production, l'échantillonnage des traces,
la propagation d'une trace à travers l'outbox, un destinataire réel pour les
alertes.

## Conséquences

- Les déclencheurs de l'ADR-003 et l'état de l'outbox se lisent sur un tableau
  de bord ; un worker bloqué (« Outbox en retard ») ou arrêté (« Worker muet »)
  déclenche une alerte.
- En production, brancher un collecteur ou Grafana Cloud tient en une variable
  d'environnement.
- 14 dépendances d'exécution (25 paquets avec leurs dépendances), toutes de
  l'organisation OpenTelemetry. Le worker charge le SDK à son démarrage même
  désactivé (import statique, nécessaire avant `pg`), soit environ une
  demi-seconde. Il ne lit à ce moment que les variables `OTEL_*` de `.env` :
  ses autres modules voient l'environnement comme avant.
- `src/lib/log.ts` dépend de `@opentelemetry/api-logs`, qui ne fait rien sans
  SDK démarré.
- Dette assumée, en local seulement : Grafana sans mot de passe (lié à
  `localhost`), postgres-exporter connecté avec le propriétaire de la base (un
  rôle `pg_monitor` en production), compte des événements `dead` sans index.
- Risques : les noms d'attributs des spans de Next.js (`next.span_type`,
  `http.route`) peuvent changer avec Next.js ; un test unitaire décrit la forme
  attendue, et un écart ne fait que vider les panneaux HTTP. La série 3.0
  d'OpenTelemetry JS sera à reprendre d'un bloc.
- À trancher par le PO : cette ADR revient sur l'amendement du 27/10 de
  l'ADR-005 §5 sur deux points, les dépendances (14 paquets OpenTelemetry) et
  les traces distribuées. Acceptée, elle lève pour ces sujets
  le « hors périmètre » de l'ADR-005 §5. Rejetée, la PR #39 suffit et cette
  branche n'est pas fusionnée.

## Comportement observable

Aucun changement : la télémétrie est désactivée par défaut, et les tests E2E
existants passent sans modification.

## Vérification

- Tests unitaires (`npm run check`) : activation, masquage des URL et des
  erreurs, mesure HTTP, mesures de l'outbox, démarrage unique avec un
  collecteur injoignable, pont du journal, démarrage avant le contrôle du rôle.
- Graphe des couches (`docs/architecture/layers.mmd`) : `lib/telemetry` et
  `@opentelemetry`, vérifiés par `npm run check`.
- Suite E2E inchangée, télémétrie désactivée.
- Démarrage et lecture de la pile : [`docs/observability.md`](../observability.md).

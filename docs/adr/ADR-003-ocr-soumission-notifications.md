# ADR-003 : OCR / IA, fiabilité de la soumission et notifications

| | |
|---|---|
| Statut | **Acceptée** le 20 octobre 2026 par le PO (Florent). Choix de contrat d'API alignés sur l'ADR-004 le 20/10 : pas de `/v1`, `503` + `Retry-After`, format RFC 9457, `Idempotency-Key` facultatif. **OCR asynchrone planifié par le PO le 20/10** (2-503) |
| Date | 14 octobre 2026 |
| Auteur | Jacques Dai (WS3 Async) |
| Issue | [2-387](https://linear.app/2-morgan/issue/2-387) |
| Entrées | Audit WS3 A4–A6 (ticket 2-386, SharePoint ARLA `Rendu/W1/2-386/`), audit WS4 Q1–Q3 (B9, B10, B11), suite E2E WS5 (`docs/tests/E2E.md`, 89/89 sur `4fad1d3`) |
| À coordonner | Antoine (ADR-002, place du worker et des ports), Amiel (ADR-004, contrat 202 / erreurs / versioning), Stanislas (ADR-005, tests), Amalraj (ADR-001, format des clés S3 : **confirmé** par l'ADR-001) |

## Décision en bref

1. **OCR : on borne d'abord** (l'asynchrone suit, point 2). Plafonds sur les octets (10 Mio), les pixels (40 Mpx, réduction à 2 500 px), la concurrence (2 par instance) et la durée (15 s).
2. **Asynchrone : tâche planifiée** (décision du PO du 20/10, ticket 2-503), après les bornes du point 1 et le worker du point 5. Contrat `202` + polling, file dans PostgreSQL. Les déclencheurs de la section 2 restent la justification et servent à prioriser si le temps manque.
3. **Soumission : upload d'abord, puis une seule transaction SQL.** Pas de statut intermédiaire. Nettoyage unique des notes sans reçu, réconciliation quotidienne des objets orphelins.
4. **Doublons : en-tête `Idempotency-Key`**, généré par le formulaire, unique par utilisateur, avec empreinte de la requête.
5. **Notifications : outbox transactionnelle + un worker.** Deux événements (note soumise → approbateur, note tranchée → soumetteur), par email via `NotificationPort`, livraison au moins une fois, DLQ après 5 essais. L'envoi a lieu après le commit et ne peut pas annuler une décision.
6. **B11 : oui, on distingue.** « Rien trouvé » et « type non pris en charge » restent `200 {}` (figés par les E2E), une panne, un timeout ou une saturation deviennent `503` + `Retry-After`.

Un seul mécanisme asynchrone pour tout le produit : la table `outbox_events` de PostgreSQL, consommée par un worker. Il sert aux notifications, puis à l'OCR (2-503) et plus tard à l'IA. C'est notre réponse à « unifier les protocoles d'échanges asynchrones ».

## Contexte

### Ce que l'audit a mesuré (commit `4fad1d3`)

| Constat | Preuve |
|---|---|
| **A4** OCR dans la requête, worker Tesseract créé à chaque appel, aucune borne | 12 mesures réelles : médianes HTTP 291 / 389 / 759 / 733 ms. Un PNG de **24,7 Mio** est accepté. Le **même 2 400 × 3 600 compressé à 136 Kio coûte 733 ms** : les octets ne bornent pas le coût, ce sont les pixels. RSS max 666 Mio. |
| **A5** INSERT → COMMIT → upload S3 → UPDATE, sans compensation ni idempotence | 6 scénarios d'injection de pannes : note `pending` avec `receipt_key = ''`, objet orphelin, et le rejeu (même `Idempotency-Key`, ignorée) crée une 2ᵉ note. |
| **A6** `NotificationPort` + `ConsoleNotificationAdapter` jamais appelés | 0 appel sur 40 fichiers TS/TSX, 4 routes de décision sans notification. |
| **B11** (WS4) panne OCR et « rien trouvé » renvoient tous deux `200 {}` | `src/lib/ocr.ts:113–132` |

### Contraintes non négociables

- **Les E2E doivent rester à 89/89** (critère noté /5). Ce qui est figé et nous concerne :
  - OCR-01/02 : `POST /api/expense-notes/receipt-suggestion` → **200** `{amount, expenseDate}` en synchrone ;
  - OCR-03/07 : PDF → **200**, aucun champ ;
  - OCR-05/06 : le bouton « Pré-remplir depuis le reçu » remplit le formulaire ;
  - NDF-06 : `POST /api/expense-notes` → **201** et le DTO actuel ;
  - NDF-10 : reçu > 10 Mio → 400 « Fichier trop volumineux » ;
  - `expectNoteShape` : `status ∈ {pending, approved, rejected}` dans toutes les listes.
- **Non figés, donc libres** : format de `receiptKey` (B14), atomicité et rejeu (B9), charge OCR (B10), distinction panne / vide (B11), messages d'erreur serveur de l'UI.
- Monolithe Next.js, PostgreSQL, S3 : **pas de nouvelle brique d'infrastructure sans besoin mesuré** (KISS, cours 2 : « l'asynchrone est par nature plus complexe : son utilité doit toujours être questionnée »).
- La roadmap prévoit l'IA (scénario 3 du cours), puis l'international (CAP). Les choix doivent préparer le premier sans bloquer le second.

## 1. OCR : limites ou asynchrone ?

| Option | Coût | Risque E2E | Ce que ça règle |
|---|---|---|---|
| **A. Bornes dans la requête** | ≈ 1 j, aucune infra | Aucun : contrat inchangé, fixtures de 677 px non redimensionnées | DoS mémoire/CPU, attente illimitée |
| B. File + worker, `202` + polling | ≈ 3–4 j : file, worker, endpoint de suivi, état UI | **OCR-01 à 03 cassent** (200 → 202) ; OCR-05 à 07 cassent si l'UI ne fait pas de polling | Idem A + découplage des pics |
| C. B, mais l'ancienne route attend le job | ≈ 4 j | Faible, mais une requête occupée pendant le traitement : on paie l'asynchrone sans le bénéfice | Rien de plus que A aujourd'hui |

**Décision : A.** L'OCR est une aide au remplissage : l'utilisateur attend de toute façon devant le formulaire, et la médiane mesurée reste sous la seconde. B ajoute une file, un worker, un état et un contrat sans gain mesuré, et casse 3 à 7 tests figés. Bornes retenues :

| Borne | Valeur | Mécanisme | Réponse au-delà |
|---|---|---|---|
| Octets | **10 Mio** | Même constante que la création (`MAX_RECEIPT_BYTES`, à partager) | 400 « Fichier trop volumineux » (même message que NDF-10) |
| Pixels | **40 Mpx** en entrée | `sharp(buf, { limitInputPixels: 40e6 }).metadata()` lit l'en-tête sans décoder | 400 « Image trop grande » |
| Coût OCR | côté long ramené à **2 500 px** (`withoutEnlargement`) | `sharp().resize()` avant Tesseract. Une photo de téléphone de 12 Mpx passe, mais coûte comme une petite image | n/a |
| Concurrence | **2 OCR simultanés par instance**, 8 en attente (`OCR_MAX_CONCURRENCY`) | sémaphore en mémoire | 503 + `Retry-After: 5` |
| Durée | **15 s** attente comprise | `Promise.race` puis `worker.terminate()` | 503 + `Retry-After: 5` |

- `sharp` est **déjà installé** (dépendance de `next@16.3.5`, v0.35.4, Apache-2.0). On le promeut en dépendance directe, sans nouveau paquet au lockfile.
- La réduction protège aussi des bombes de décompression : un PNG de quelques Kio peut faire 400 Mpx.
- **Vérifié le 14/10 avec le `sharp` installé** :
  - un PNG 8 000 × 6 000 de 148 Kio est refusé dès la lecture de l'en-tête (« Input image exceeds pixel limit ») ;
  - une photo de 4 000 × 3 000 est ramenée à 2 500 × 1 875 ;
  - une image de la taille des fixtures E2E (677 × 292) reste intacte.
- **Hors périmètre** : réutiliser un worker Tesseract chaud (`createScheduler`). C'est une optimisation à mesurer d'abord, pas une protection.
- **Limite connue** : le sémaphore est **par instance**. Avec plusieurs instances, la concurrence globale vaut N × 2. C'est un des déclencheurs du point 2.

## 2. Quand passer en asynchrone, et avec quel contrat ?

> **Mise à jour du 20/10 (PO)** : on n'attend pas qu'un déclencheur soit atteint, le passage à l'asynchrone est planifié (2-503), après 2-475 (bornes) et le worker de 2-484. Les bornes de la section 1 restent livrées en premier : elles protègent aussi la route synchrone conservée. Les déclencheurs ci-dessous restent la justification du choix.

**Déclencheurs, le premier atteint suffit :**

1. **Arrivée de l'IA** (catégorisation par une API externe type OpenAI) : asynchrone **dès le premier jour**. Latence réseau, quotas et retries ne doivent jamais tenir une requête HTTP. C'est exactement l'incident du scénario 3.
2. **p95 OCR > 3 s** ou **taux de 503 OCR > 1 %** sur une semaine (métrique du point 6).
3. **Hébergement à durée de requête limitée** (serverless type Vercel) ou **plusieurs instances** : le sémaphore local ne borne plus rien.
4. **OCR à la soumission** (extraction automatique sur la note envoyée, plus seulement une aide au remplissage).

**Contrat** (contract first, dans l'OpenAPI de l'ADR-004 §8.3, sans préfixe de version) :

```http
POST /api/receipt-analyses             (multipart: receipt ; en-tête Idempotency-Key)
→ 202 Accepted   Location: /api/receipt-analyses/{id}
  { "id": "…", "status": "queued" }

GET /api/receipt-analyses/{id}
→ 200 { "id": "…", "status": "queued|running|succeeded|failed",
        "result": { "amount": 42.5, "expenseDate": "2026-10-11", "category": "…" },
        "error": { … problem+json … } }
```

- Message interne `receipt.analysis.requested` v1 : `{ jobId, companyId, userId, receiptKey, requestedAt, traceId }`. Le reçu est stocké sur S3 **avant** la publication : le message porte la clé, jamais les octets.
- Transport : **la table d'outbox du point 5** (`SELECT … FOR UPDATE SKIP LOCKED`), pas de broker tant que le volume ne le justifie pas. Le port `JobQueue` permet de passer à SQS ou RabbitMQ sans toucher au métier.
- Trois essais avec backoff, puis DLQ (statut `dead`, consultable) ; par exemple une image qui n'est pas un ticket.
- Polling plutôt que webhook : le client est un navigateur.
- **Compatibilité E2E** : la route synchrone actuelle reste disponible, sans changement. Le bouton « Pré-remplir » passe au polling sans changer de libellé ni de messages, donc OCR-05 à 08 restent verts. OCR-01 à 03 visent l'ancienne route ; son retrait éventuel suit la règle de dépréciation de l'ADR-004 §7.1.

## 3. Création de note fiable

| Option | Échec résiduel | Visible par l'utilisateur ? | Coût |
|---|---|---|---|
| **A. Upload d'abord, puis INSERT unique** | objet S3 sans note | **Non** | faible |
| B. Statut intermédiaire (`uploading` → `pending`) | note bloquée en `uploading` | Oui, sauf si on filtre les **3 listes** ; `expectNoteShape` interdit un 4ᵉ statut | moyen |
| C. Outbox : INSERT + intention, upload par le worker | octets à stocker ailleurs en attendant (BDD, disque) | Non | élevé |
| D. Ordre actuel + compensation (DELETE si l'upload échoue) | crash entre COMMIT et compensation = même bug | Oui | faible, mais ne garantit rien |

**Décision : A.** Une transaction SQL ne rend pas S3 transactionnel. On place donc l'étape non transactionnelle **en premier**, là où son échec ne laisse rien de visible :

1. Valider la requête, vérifier l'idempotence (point 4).
2. Générer `noteId = randomUUID()` côté serveur. Clé `receipts/{companyId}/{noteId}{ext}` : opaque et préfixée par tenant, ce qui règle aussi S8 (**confirmé** par l'ADR-001, §2 point 5).
3. Upload S3. En cas d'échec : 500, **aucune ligne créée**.
4. Une seule transaction `withUserScope` : `INSERT` de la note **avec** `receipt_key`, plus l'`INSERT` de l'événement `expense_note.submitted` dans l'outbox (point 5).
5. Si la transaction échoue : `DeleteObject` en best effort ; la réconciliation rattrape le reste.

`receipt_seq` ne sert plus à nommer les clés. La colonne est conservée, la supprimer n'apporte rien maintenant. Les E2E ne figent pas le format de clé (B14). RECU-01 à 07 vérifient que le reçu est restituable, ce qui reste vrai.

**Nettoyage de l'existant (une fois, dry-run puis exécution) :**

- **Notes sans reçu** (`receipt_key = ''`) :
  - celles en `pending` sont supprimées. L'utilisateur a reçu une erreur 500, la note n'existe pas de son point de vue, et elle a souvent été doublée par un nouvel envoi ;
  - celles déjà `approved` ou `rejected` sont **conservées et listées pour la RH** : une décision prise ne s'efface pas en silence.
  - Export CSV avant suppression. Ensuite, contrainte `CHECK (receipt_key <> '')` posée `NOT VALID` puis `VALIDATE` : le bug ne peut plus revenir.
- **Objets orphelins** : tâche quotidienne qui liste `receipts/` et supprime les objets **non référencés et âgés de plus de 24 h**. Le délai protège les uploads en cours. Premier passage en dry-run, avec rapport.

## 4. Éviter les doublons

**Décision : en-tête `Idempotency-Key`** (cours 3, draft IETF *httpapi-idempotency-key-header*).

- **Client** : le formulaire génère un `crypto.randomUUID()` à l'ouverture, le **renvoie à chaque nouvel essai** après une erreur et le régénère après un succès.
- **Serveur** : colonnes `idempotency_key uuid NULL` et `request_fingerprint text NULL` sur `expense_notes`, index unique `(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.
  - Clé connue, même empreinte : **201 avec la note existante** + `Idempotent-Replayed: true`, sans nouvel upload.
  - Clé connue, empreinte différente : **422**.
  - Clé mal formée : 400.
  - Deux requêtes concurrentes : l'index unique arbitre. La perdante supprime son objet et renvoie la note gagnante.
- **Empreinte** = `sha256(amount | expenseDate | description | sha256(reçu))`.
- **Portée par utilisateur** : pas de collision ni de fuite entre tenants.
- **Rétention** : la clé vit sur la note, donc ni TTL ni table dédiée.
- **Sans en-tête** : comportement actuel, sans déduplication. Les E2E et les clients API existants ne changent pas ; la clé ne devient pas obligatoire sans décision de rupture explicite (ADR-004 §8.2).
- **Pourquoi pas une déduplication sur le contenu** : deux taxis au même prix le même jour sont légitimes. Seule une clé exprime l'intention « c'est le même envoi ».
- **Décisions approve/reject** : idempotence naturelle par `UPDATE … WHERE status = 'pending'`. Une seconde décision ne touche aucune ligne, renvoie 409 et n'émet **aucun** événement. Cela règle aussi B8 ; à porter dans l'unification approve/reject de WS2.

## 5. Notifications (A6) : quoi, à qui, comment

**Quoi et à qui :**

| Événement | Émis quand | Destinataire |
|---|---|---|
| `expense_note.submitted` | transaction de création (point 3) | manager direct du soumetteur ; s'il n'en a pas (manager racine), **toutes les `hr_admin` de son entreprise** |
| `expense_note.decided` (`approved` / `rejected`) | `UPDATE` de décision qui a modifié 1 ligne | le soumetteur |

- Contenu minimal : description, statut, lien vers l'application. Ni montant ni reçu dans l'email.
- Destinataires figés **à l'émission** dans le `payload`, et le dispatcher vérifie qu'ils appartiennent bien au `company_id` de l'événement (défense en profondeur après S3).

**Comment : outbox transactionnelle.**

```sql
outbox_events(id uuid PK, company_id uuid, type text, payload jsonb,
              status text CHECK (status IN ('pending','sent','dead')),
              attempts int, next_attempt_at timestamptz, last_error text, created_at timestamptz)
```

- L'événement est inséré **dans la même transaction** que la note ou la décision : pas de décision sans événement, pas d'événement sans décision.
- Un **worker** (`npm run worker`, même codebase, second point d'entrée) prend les lignes `pending` dues (`FOR UPDATE SKIP LOCKED`) et appelle `NotificationPort` :
  - succès : `sent` ;
  - échec : backoff 1 min, 5 min, 30 min, 2 h, 12 h ;
  - après 5 essais : `dead` (DLQ), compté et journalisé.
- **Garantie : au moins une fois.** L'`id` de l'événement sert de clé de déduplication chez le fournisseur (`Message-ID`). Un doublon d'email n'est possible que si le worker tombe entre l'envoi et le marquage : accepté.
- **Un échec d'envoi n'annule jamais une décision** : l'envoi a lieu après le commit, dans un autre processus. Le seul couplage est un `INSERT` local dans la même base que l'`UPDATE`.
- **Canal : email** via le port.
  - `ConsoleNotificationAdapter` (existant) en test.
  - `SmtpNotificationAdapter` + **Mailpit** dans `docker-compose` en dev.
  - Fournisseur transactionnel en prod : *buy*, pas *build*.
  - Hors périmètre : un centre de notifications in-app, l'historique des statuts suffit à l'UI actuelle.
- **Rejetés** :
  - appel direct dans le handler : la décision dépendrait de SMTP ;
  - `after()` de Next.js : perdu au moindre crash, sans retry, donc ne tient pas la garantie.
- **Port** : `NotificationPort` gagne `notifySubmitted(recipientIds, noteId)` à côté de `notifyDecision`.

Le worker ne conditionne pas les E2E : aucune notification n'est figée, la suite reste verte qu'il tourne ou non.

## 6. Panne ou résultat vide (B11)

**Décision : distinguer, par le code HTTP, sans changer le corps des réponses figées.**

| Cas | Aujourd'hui | Cible | E2E |
|---|---|---|---|
| Type non pris en charge (PDF) | 200 `{}` | **200 `{}`** | OCR-03 / 07 figés |
| Image lue, rien reconnu | 200 `{}` | **200 `{}`** | message « Aucune information reconnue » inchangé |
| Fichier ou image trop grands | 200 (traité) | **400** | nouveau test API |
| Panne moteur, timeout, saturation | 200 `{}` | **503** + `Retry-After`, corps au format d'ADR-004 | UI : « Impossible d’analyser ce reçu. », message déjà codé |

- Chaque appel journalise un `outcome` (`found`, `empty`, `unsupported`, `rejected`, `failed`, `timeout`, `overloaded`) et alimente le compteur `ocr_requests_total{outcome}` : c'est la donnée qui déclenche le point 2.
- Pas de nouveau champ dans le JSON : le code HTTP suffit au client.

## Impacts

| Domaine | Changement |
|---|---|
| **E2E** | 89/89 attendus inchangés. À ajouter : OCR > 10 Mio → 400 ; rejeu avec la même clé → même `id`, une seule note ; même clé et autre contenu → 422 |
| **Tests d'intégration** (ADR-005) | Pannes injectées (S3 KO, base KO après upload, moteur OCR KO) sur le **comportement cible**. Retirer `docs/audit/evidence/a5-a6/reproduce.mjs`, qui affirme les bugs et deviendra rouge à la correction |
| **Schéma** | 3 migrations : colonnes d'idempotence + index ; contrainte `receipt_key <> ''` ; table `outbox_events` |
| **Dépendances** | `sharp` promu en dépendance directe (déjà présent), aucun nouveau paquet. Mailpit en dev uniquement |
| **Exploitation** | Un second processus (`worker`) ; une tâche quotidienne de réconciliation ; métriques `ocr_requests_total`, nombre d'événements `pending` / `dead` et âge du plus ancien |
| **Architecture** (ADR-002) | Cas d'usage `SubmitExpenseNote`, `DecideExpenseNote`, `SuggestReceiptFields` dans la couche application. Ports `ReceiptStorage`, `Notification`, `Ocr`, `EventOutbox`. Le worker est un **adaptateur entrant** de plus, comme les route handlers : un monolithe modulaire, deux processus |
| **Soutenance / live coding** | Une nouvelle notification se résume à un type d'événement plus un handler : extension guidée, testable sans SMTP |

## Correctifs et tickets Linear (jalon J4, regroupés le 20/10 en 3 tickets : 2-475, 2-476, 2-484)

Ordre : l'intégrité d'abord (T2 → T4), puis la charge (T1), puis les notifications (T6 → T7). T8 accompagne chaque PR. Priorités arbitrées par le PO le 20/10 : **notifications en P1, abandonnées le 25/10 si la vague 2 est en retard** (l'ADR reste alors la référence pour la soutenance).

| # | Correctif | Constats | Estim. | Prio | Ticket |
|---|---|---|---|---|---|
| T1 | OCR : bornes octets, pixels avec réduction, concurrence, durée ; 503 sur panne (B11) | A4, B10, B11 | 1 j | P0 | 2-475 |
| T2 | Soumission upload d'abord + clé `receipts/{companyId}/{uuid}` (avec WS1, S8) | A5, S8 | 1 j | P0 | 2-476 |
| T3 | `Idempotency-Key` : migration, route, formulaire | A5, B9 | 1 j | P1 | 2-476 |
| T4 | Script de nettoyage des notes sans reçu + contrainte `CHECK` | A5 | 0,5 j | P1 | 2-476 |
| T5 | Réconciliation quotidienne des objets orphelins | A5 | 0,5 j | P2 | 2-476 (bonus) |
| T6 | Table `outbox_events` + worker (retries, backoff, DLQ) | A6 | 1,5 j | P1 | 2-484 |
| T7 | Événements `submitted` / `decided`, destinataires, adaptateur SMTP + Mailpit ; décision `WHERE status = 'pending'` | A6, B8 | 1 j | P1 | 2-484 |

| T8 | Tests : intégration avec pannes, nouveaux E2E API, retrait du harnais d'audit | Q4 | 1 j | — | dans chaque ticket |
| T9 | Observabilité : `outcome` OCR, métriques d'outbox (avec WS5) | Q5 | 0,5 j | P2 | non planifié |
| T10 | OCR asynchrone : lancement `202`, suivi, traitement par le worker, bouton en polling (décision du PO du 20/10) | A4 | — | P2 | 2-503 |

L'**adaptateur SMTP + Mailpit** est livré en premier (étape 1 de 2-484, ≤ 23/10) : il sert aussi aux invitations de l'ADR-001 (S7) et n'est pas concerné par l'abandon éventuel des notifications le 25/10. T10 dépend du worker de T6 : si les notifications sont abandonnées le 25/10, le worker reste à livrer pour T10.

**Total ≈ 8 jours-personne**, dans la fourchette de l'audit (A5 2–4 j, A4 0,5–1 j pour les bornes, A6 2–4 j avec livraison fiable).

## Conséquences

- **Positives** :
  - plus de note fantôme ni de doublon au rejeu ;
  - OCR borné sans toucher au contrat ;
  - notifications réelles et garanties ;
  - un seul mécanisme asynchrone, prêt pour l'IA ;
  - aucune régression E2E attendue.
- **Négatives** :
  - un processus de plus à exploiter ;
  - le polling en base ajoute de la charge, faible à notre volume ;
  - le sémaphore OCR n'est pas global ;
  - livraison au moins une fois, donc un doublon d'email reste possible.
- **Réexaminer cette ADR si** :
  - l'IA externe arrive (asynchrone obligatoire dès le premier jour) ;
  - le volume de l'outbox dépasse ce qu'un polling PostgreSQL absorbe (lag > 1 min soutenu) : passer à un broker derrière le même port ;
  - l'international impose plusieurs régions : l'outbox reste locale à la base du tenant, à revoir avec CAP.

## Hors périmètre

Billing (A7), catégorisation IA elle-même (seul son contrat est préparé), centre de notifications in-app, réplication multi-région.

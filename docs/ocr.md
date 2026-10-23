# OCR — implémentation de 2-475

Références : ADR-002 §3.3, ADR-003 §1/2/6, ADR-004 §8.3. Ce document explique
les choix d'implémentation et les précisions nécessaires au passage en asynchrone.
Les huit scénarios OCR-01 à OCR-08 et leurs messages restent inchangés.

## Découpage

La route HTTP authentifie, réserve une capacité avant de lire le corps,
valide le multipart borné et appelle `OcrRequests`. Les cas d'usage
`SuggestReceiptFields`, `ReceiptAnalyses` et `ProcessReceiptAnalysis`
utilisent des ports. La composition concrète est dans `src/composition/ocr.ts`.
L'extraction montant/date est pure et conserve les 16 cas de caractérisation
écrits et exécutés sur l'ancienne implémentation avant son déplacement.

La suggestion propose aussi une **description** : le nom du commerçant, lu
sur les six premières lignes du texte (`parseDescription`). Les lignes avec
des chiffres (adresse, numéro), les mentions légales et les montants sont
écartées, et le nom s'arrête avant les mots de document (« Facture », « Date »).
L'heuristique préfère ne rien proposer qu'un nom douteux. Le formulaire ne
remplit le champ que s'il est vide. Ajout compatible du contrat (1.1.0) : les
deux routes renvoient le même `ReceiptSuggestion`.

`TesseractOcrAdapter` lance `scripts/ocr-engine.mjs` dans un processus enfant
jetable. La reconnaissance reste une requête synchrone sur l'ancienne route ;
le nouveau parcours persiste le travail dans l'outbox avant de répondre 202.
Le worker réutilise le même cas d'usage de suggestion.

## Mémoire, charge et arrêt

- Fichier : 10 Mio ; multipart : 10 Mio + 64 Kio pour l'enveloppe. Le flux est
  compté, même sans Content-Length, et annulé au dépassement. Un seul champ
  `receipt`, non vide, est accepté. Le nom/MIME client ne suffisent pas :
  signatures, format réel, métadonnées et décodage des images sont vérifiés.
- Images : maximum 40 Mpx, une seule page ; côté long ramené à 2 500 px sans
  agrandissement. `sharp` désactive son cache et utilise un thread de traitement
  dans chaque processus enfant. Un PDF garde le résultat vide historique ;
  il n'est pas décodé par Tesseract (contrôle de signature `%PDF-`).
- Admission HTTP : 10 demandes au total par processus, uploads inclus, avant
  buffering ; 2 actives et 8 en attente. Les images ne sont décodées que dans
  les processus actifs. La limite ne promet pas un plafond exact de RSS : il
  reste les buffers multipart, les copies et les allocations natives/WASM.
- Les deux emplacements de calcul sont également protégés par des verrous
  transactionnels PostgreSQL `(247501, 0/1)`. Ancienne route, inspection au
  lancement et workers se partagent donc **deux moteurs au total par base**.
  C'est plus strict que la borne par instance de l'ADR. Les transactions ne
  verrouillent aucune ligne métier et libèrent leurs verrous à la déconnexion.
- Le budget HTTP de 15 s part après authentification, à l'admission : réception,
  attente, préparation et OCR sont inclus. La déconnexion du client annule le
  parcours synchrone. Le signal est propagé au flux, à S3 et au processus OCR.
- À expiration, le processus OCR reçoit SIGKILL, même si sharp ou l'initialisation
  Tesseract sont bloqués. La promesse ne se termine qu'après `close` du processus,
  avant de rendre le slot. Le canal IPC fait aussi quitter le fils si le parent
  disparaît. Un simple Promise.race n'offrait pas ces garanties.
- Le deadline est une demande d'annulation, pas une garantie temps réel sur la
  réponse HTTP : l'ordonnanceur, l'arrêt du fils, PostgreSQL et une compensation
  S3 peuvent ajouter une latence. Le calcul expiré ne continue pas en arrière-plan.

## Parcours asynchrone

1. `POST /api/receipt-analyses`, multipart `receipt`, clé UUID `Idempotency-Key`
   facultative. Contrôles d'entrée, métadonnées et décodage avant acceptation,
   sans démarrer Tesseract. Cette validation est répétée à l'exécution pour
   vérifier aussi le contenu effectivement relu depuis S3. Upload S3 sous
   `receipts/{companyId}/analyses/{id}`, puis transaction unique : analyse + événement
   `receipt.analysis.requested`. Si la transaction échoue, suppression S3 en best
   effort après vérification de l'absence de commit. Si son accusé est perdu mais
   l'analyse est retrouvée, elle est renvoyée ; si la base ne peut pas trancher,
   le reçu est conservé pour la reprise/réconciliation. Réponse 202 et
   `Location: /api/receipt-analyses/{id}` après commit.
2. Rejeu même utilisateur/clé/contenu : même analyse. Autre contenu : 422.
   Le quota et les replays concurrents sont arbitrés sous le verrou d'admission
   `247500`. Maximum **10 analyses persistées non terminées par base**, même si
   le worker est arrêté. Les lignes d'outbox ne contiennent jamais les octets.
3. Le worker commun (`src/worker/`, 2-484) prend l'événement en charge via
   `FOR UPDATE SKIP LOCKED` : l'essai est compté et un bail de 5 min posé.
   L'analyse est un **traitement détaché** : elle s'exécute hors transaction,
   puis le worker enregistre l'issue dans une transaction courte. Chaque écriture
   de l'analyse vérifie que l'événement est toujours au même essai : un ancien
   consommateur, dont le bail a expiré, n'écrit rien. Un crash rend le travail
   de nouveau disponible après expiration du bail.
4. Une tentative dispose de 15 s, lecture S3 et attente du slot incluses.
   Au maximum 3 tentatives pour les pannes temporaires, avec 1 s puis 5 s de
   backoff (délais propres à ce type d'événement). Les refus de contenu ne sont pas
   rejoués. Après épuisement : analyse `failed`, événement `dead`. C'est le cas
   d'usage `ProcessReceiptAnalysis` qui décide de la relance : il remet l'analyse
   en attente et lève une erreur (le worker relance), ou la clôt et lève
   `NonRetryableError` (l'événement passe `dead`). Un arrêt demandé du worker
   compte comme une panne passagère : l'analyse est remise en attente.
5. **Précision pour la file durable** : le travail entier a un budget de 60 s depuis
   son acceptation, attente et reprises comprises. Chaque tentative est plafonnée
   au minimum de 15 s et du budget restant. La règle historique de 15 s d'attente
   totale reste appliquée au parcours synchrone ; elle n'est pas assimilée à une
   attente HTTP pour les jobs persistants. Si le worker reste arrêté, le suivi
   reste queued et le navigateur cesse d'attendre au bout de 75 s ; le worker
   marquera les travaux trop anciens failed lorsqu'il reprendra.
6. `GET /api/receipt-analyses/{id}` : 200, état queued/running/succeeded/failed ;
   résultat ou problème imbriqué. Une analyse étrangère, expirée ou inconnue donne
   le même 404, même pour un autre utilisateur du même tenant. WHERE explicites
   user/company et RLS protègent les lectures.
7. Polling navigateur toutes les 300 ms, durée totale plafonnée à 75 s ; abort à
   la sortie de page et `finally` réactive le bouton sur toute erreur. La fermeture
   d'une page ne supprime pas un job déjà accepté durablement.

Le worker supprime les reçus S3 après état terminal, en réessayant les échecs de
nettoyage toutes les 10 s. Résultats et clés de rejeu expirent après 24 h ; les
lectures expirées sont invisibles immédiatement, la purge physique suit le
nettoyage du reçu. Un upload dont la compensation échoue avant insertion en base
peut rester orphelin : la réconciliation S3 générale de 2-476 reste nécessaire.

Les erreurs HTTP suivent application/problem+json, code anglais et requestId,
sans stack ni message interne. Panne, expiration et surcharge : 503 avec
Retry-After: 5. Un GET d'une analyse failed reste 200 et contient son problème.

## Intégration avec 2-484

L'analyse s'appuie sur le **socle asynchrone unique** de 2-484 (ADR-003,
amendement du 23/10) : la table `outbox_events` et sa policy d'insertion,
`PgEventOutbox` pour publier, le registre `buildHandlers()` et le worker de
`src/worker/`. Le handler de `receipt.analysis.requested` est déclaré dans
`src/worker/receiptAnalysis.ts`, avec ses propres règles de relance (3 essais,
1 s puis 5 s). Les types inconnus restent intacts et ne sont jamais acquittés.

Le worker distingue deux sortes de traitement : **en transaction** (un email,
court) et **détaché** (`run(event, signal)`, l'OCR, jusqu'à 60 s), qui ne garde
ni connexion ni verrou pendant son exécution.

Contrat de l'événement OCR v1 :

```json
{ "version": 1, "analysisId": "UUID", "companyId": "UUID", "userId": "UUID", "receiptKey": "receipts/COMPANY/analyses/ANALYSIS" }
```

## Exploitation et dépendances

- Node 24+, PostgreSQL et S3. `npm run dev` lance serveur + worker ; en production,
  `npm run build`, puis `npm run start` et `npm run worker` sous supervision.
- Exécuter depuis la racine du projet, avec `scripts/ocr-engine.mjs`, `tessdata/`
  et les dépendances de production. Les plateformes sans processus enfants ne
  conviennent pas à cet adaptateur ; le port permet un autre moteur.
- Le worker utilise `DATABASE_URL`, comme l'application. Le rôle dédié
  `expense_worker` et l'adaptation du nettoyage (qui lit `receipt_analyses` sans
  contexte utilisateur) arrivent avec la bascule 2-481 (ADR-001, point de
  coordination).
- `sharp` devient une dépendance directe, car utilisé par le moteur. `tsx` est
  une dépendance d'exécution pour le second point d'entrée TypeScript avec les
  alias du dépôt ; cela évite de maintenir une seconde version JS du worker.
- Le contrat OCR est dans `docs/api/ocr.openapi.yaml`, module à intégrer au contrat
  global de 2-486. `openapi-typescript` (dev) produit `src/types/ocr-api.d.ts`, utilisé
  par le client et le sérialiseur HTTP. `npm run generate:ocr-api` régénère ces types ;
  `npm run check` vérifie qu'ils sont à jour. Aucun type de domaine ne dépend du HTTP.
- Les logs n'exposent ni reçu, ni texte OCR, ni clé S3, ni exception interne.
  Pas de nouvelle infrastructure de métriques ; les compteurs complets T9
  restent à raccorder au chantier d'observabilité.

## Validation et découpage de livraison

Le code se relit en trois ensembles : protections du moteur/transport ; domaine,
ports et cas d'usage ; persistance, worker, API asynchrone et interface. Le fichier
`e2e/ocr-suggestion.spec.ts` d'origine reste inchangé.

`npm run check` vérifie les règles d'architecture, types et tests unitaires.
`npm run test:e2e -- e2e/ocr-suggestion.spec.ts e2e/ocr-analysis.spec.ts e2e/ocr-outbox.spec.ts`
vérifie les deux contrats HTTP et le vrai moteur via le worker. Les tests de
réception couvrent aussi un flux sans Content-Length et un upload bloqué ; les
tests d'adaptateur couvrent un moteur indisponible et bloqué dès l'initialisation.
Les tests d'outbox exercent aussi la reprise d'un bail expiré, le refus d'un
ancien consommateur, les trois tentatives et les deux slots sous PostgreSQL.

Vérification locale du 22 octobre 2026 : `npm run check` vert (149 tests unitaires
et types OpenAPI à jour), build de production vert, suite complète Playwright
sur ce build avec le vrai worker : **102/102**, dont les 8 OCR historiques
inchangés et 13 nouveaux scénarios OCR. La migration a été appliquée sur la
stack PostgreSQL/LocalStack locale.

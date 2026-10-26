# Contrat HTTP — 2-486

La source de vérité est [`openapi.yaml`](../../openapi.yaml), OpenAPI 3.1. Elle couvre les **17 opérations métier** présentes : les 14 de l’audit initial, les deux opérations d’analyse asynchrone livrées par 2-475 et l’invitation d’un salarié par la RH (`POST /api/hr/invitations`, 2-496). Auth.js, les méthodes automatiques HEAD/OPTIONS et les erreurs produites avant le handler restent hors périmètre.

## Modifier et vérifier

1. Modifier le contrat avant de changer une entrée ou une réponse.
2. Lancer `npm run generate:api` et utiliser les types de `src/types/api.d.ts` dans la couche HTTP et les écrans.
3. Mettre à jour les contrôles de contenu non exprimables par JSON Schema et leurs tests si nécessaire.
4. Lancer `npm run check`, `npm run build`, puis `make test-e2e`.

Les fichiers `src/types/api.d.ts`, `src/generated/api-contract.json` et `src/generated/receipt-policy.json` sont générés et committés ; ne pas les modifier à la main. Le JSON est la projection du même YAML, chargée par Ajv. Les validateurs sont compilés à partir de ces références et mis en cache, sans seconde définition manuelle des schémas.

`npm run check:api` vérifie le document, la fraîcheur des artefacts et la correspondance **méthode + chemin** avec les handlers. Le contrôle utilise l’AST TypeScript et reconnaît fonctions, constantes exportées et réexports `export { handler as GET }`.

Dans les E2E, `withContractChecks()` vérifie les réponses des contextes API authentifiés et anonymes : statut, type de contenu, corps et en-têtes déclarés. Les appels externes (S3, Mailpit) et Auth.js sont exclus. Les assertions métier, de permissions et de non-régression restent indépendantes du contrat. Les requêtes émises par les pages du navigateur gardent leurs tests UI ; elles ne sont pas interceptées par ce helper API.

## Validation avant effets de bord

Ordre : session, rôle, entrées structurelles, visibilité et règles métier, puis écriture/upload. Aucune nouvelle garde d’accès n’est introduite (2-487).

- Le montant multipart reste une **chaîne**, validée avant conversion : chiffres et point, une ou deux décimales facultatives, strictement positif, maximum 99 999 999,99. Pas de parsing partiel, arrondi, exposant ou virgule.
- La date est une date civile réelle `YYYY-MM-DD`, de l’année 0001 à 9999, sans fuseau. L’année zéro est refusée car PostgreSQL ne l’accepte pas. Les dates futures ne sont pas interdites.
- Les huit identifiants des opérations historiques et celui du suivi d’analyse sont validés comme UUID à la frontière HTTP. Un identifiant malformé donne 400 ; un UUID inconnu ou invisible donne 404.
- Le rattachement exige un objet JSON avec `managerId`. `{}`, JSON malformé, type incorrect et UUID malformé donnent 400 sans modification. Seul `null` explicite demande un détachement. L’admissibilité du manager reste une règle métier (409).
- Les champs multipart dupliqués ou inconnus sont refusés. Le flux est compté même sans Content-Length, à 10 Mio + 64 Kio d’enveloppe ; le fichier lui-même reste limité à 10 Mio et doit être non vide.
- À la création, les images PNG/JPEG/WebP sont vérifiées par signature, format réel et décodage avec sharp ; les PDF par un parseur et un arbre de pages valide. Les fichiers ne sont ni redimensionnés ni réécrits par cette inspection.
- L’OCR réutilise les contrôles communs, puis son processus isolé pour le décodage des images (40 Mpx, réduction à 2500 px). Un PDF valide donne toujours une suggestion vide en synchrone. Un autre type non analysable conserve ce succès vide après les bornes communes ; le lancement asynchrone accepte uniquement les quatre formats de reçu.

Le nom et le MIME déclarés ne suffisent pas. Cette validation de format ne prétend pas établir l’innocuité générale d’un fichier. Les contrôles PDF vérifient la structure, pas le rendu ou chaque instruction graphique. sharp applique aussi ses bornes natives de décodage lors de l’inspection des images à la création.

## Erreurs et transition

Les nouvelles erreurs de validation et les routes OCR utilisent `application/problem+json` : `type`, `title`, `status`, `detail`, `code`, `requestId`, et éventuellement `errors`. Les messages canoniques sont anglais, sans valeur soumise. Le membre `error` conserve transitoirement les textes historiques attendus par les écrans et les E2E.

Les refus historiques des autres routes utilisent encore `application/json` et `LegacyError`. Le contrat décrit cette coexistence réelle, au lieu de prétendre que 2-485 est déjà livré. Le wrapper global, la suppression des fuites techniques des erreurs historiques, le catalogue commun et la traduction front restent **2-485**. Le fichier `ocrProblem.ts` doit rejoindre ce constructeur lors de sa livraison ; aucune seconde garde n’est créée ici.

Les autres travaux restent dans leurs tickets : sécurisation du tri et des ressources (2-471), atomicité/idempotence de création (2-476), sérialiseur et gardes uniques (2-487), cas d’usage métier (2-488). Aucun comportement futur de ces tickets n’est présenté comme déjà implémenté, notamment l’en-tête d’idempotence de la création de note.

## Choix des outils

| Outil | Raison et placement |
|---|---|
| `openapi-typescript` (dev, déjà présent pour l’OCR) | Types de requête/réponse dérivés d’OpenAPI 3.1, sans code d’exécution ; réutilisé pour tout le contrat |
| `ajv` + `ajv-formats` (exécution) | JSON Schema 2020-12 et formats complets date/UUID ; aucune coercition, valeur par défaut ou suppression de propriété. Compilation unique par schéma, puis cache |
| `yaml` (dev) | Conversion déterministe du YAML en JSON ; pas de parseur YAML dans l’application déployée |
| `@redocly/cli` (dev) | Validation OpenAPI explicite dans le même `npm run check` que la CI |
| `pdf-lib` (exécution) | Parseur PDF JavaScript avec types, sans outil système, pour dépasser le contrôle du seul préfixe `%PDF-` |
| `sharp` (déjà présent) | Décodage des images et production des vraies fixtures JPEG/WebP ; aucun second décodeur d’images ajouté |

Les entités métier, les lignes SQL et les DTO HTTP restent distincts. Le domaine importe uniquement la politique de reçus générée, sans dépendance au document HTTP ni aux validateurs Ajv. La centralisation des sept sérialisations est laissée à 2-487 ; leurs types de sortie sont déjà vérifiés contre le type généré.

## Compatibilité

Pas de préfixe `/v1`, pas de pagination, pas de suppression de `receiptKey`. `info.version` versionne le contrat global indépendamment du package npm et de l’ancien contrat OCR partiel. Les suppressions/renommages, nouveaux champs requis et changements de statut/sens demandent une décision explicite suivant l’ADR-004. Une dépréciation annonce le retrait au moins une livraison à l’avance, après migration des consommateurs connus.

Les fixtures NDF-07 et RECU-03 sont remplacées dans un commit de tests séparé, sans changer les succès attendus. Les tests API-01 à 04 couvrent les validations strictes, les UUID, l’absence/null, les fichiers falsifiés/corrompus et l’absence de mutation. Les tests unitaires de frontière vérifient aussi qu’aucun appel DB/S3 n’a lieu sur rejet.

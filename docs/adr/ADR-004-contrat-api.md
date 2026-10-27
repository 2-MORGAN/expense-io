# ADR-004 — Contrat d'API, format d'erreur et versioning

| | |
|---|---|
| Statut | **Acceptée** le 20 octobre 2026 par le PO (Florent), avec les décisions de l'encadré ci-dessous |
| Auteur | Amiel Fabreguettes (WS4 API) |
| Date | 20 octobre 2026 |
| Ticket | [2-391](https://linear.app/2-morgan/issue/2-391) |
| Échéance | 21 octobre 2026, selon le commentaire du PO du 19/10 |
| Code étudié | `main` au commit `29ad82dc1476926b92bf915b1cd016448c8b7871`, PR #8 incluse |
| Documents de coordination | ADR-001, 003 et 005 consultées au commit `8c958e53ec8b0a43cfed15de9155ab154706a62b` de `docs/adr-001-003-005` ; ADR-002 amendée et acceptée le 20/10 (2-470) |
| Livrable | Ce document dans `docs/adr/`, à déposer dans SharePoint ARLA `Rendu/W2/ADR-004-contrat-api.md` |

> **Mise à jour du 20/10/2026 (décision du PO).**
> - **L'OCR asynchrone devient une tâche à faire** ([2-503](https://linear.app/2-morgan/issue/2-503)), au lieu d'attendre un déclencheur de l'ADR-003. Le contrat de la section 8.3 n'est donc plus seulement prospectif : il sera ajouté à l'OpenAPI avec la livraison de ses handlers. La route synchrone reste disponible (OCR-01 à 08 inchangés).
> - **Pas de pagination** : les quatre listes restent complètes (section 7.2). Le volume d'un tenant ne le justifie pas aujourd'hui ; aucun test ni écran ne change.
> - **Anglais canonique confirmé** (section 3.2) : l'API répond en anglais avec des codes stables, le front traduit, pour les utilisateurs internationaux.
> - **Génération des types confirmée** (section 5) : les types TypeScript sont produits à partir de l'OpenAPI, pas écrits à la main. Les outils sont nommés et justifiés dans 2-486 (section 5.1).
> - Pas de nouveau ticket : la validation B7 rejoint [2-486](https://linear.app/2-morgan/issue/2-486), la traduction des erreurs par le front rejoint [2-485](https://linear.app/2-morgan/issue/2-485).
> - Les alignements demandés en section 11 sont faits dans la même PR : ADR-003 sans `/v1` ni « v2 obligatoire », ERR-01 de l'ADR-001 déclenché par une panne injectée et non plus par une date invalide.

## 1. Contexte et périmètre

L'[audit WS4](../audit/WS4-Q1-Q3.md) compte **14 opérations métier dans 13 fichiers `route.ts`**. Le fichier Auth.js est exclu du contrat métier. L'expression « 14 routes » du ticket désigne ces 14 opérations.

Q1.2 et Q1.3 constatent une enveloppe `{error}` sans code applicatif stable, des messages français et anglais et 7 opérations qui retournent une promesse sans l'attendre dans leur `try`. Leurs rejets peuvent échapper au `catch`. Le helper actuel expose message interne et pile lorsqu'il capture une exception ; cela ne signifie pas que chaque réponse d'erreur contient une pile. Q2 constate l'absence de contrat et de politique de compatibilité. Q3 dénombre 7 constructions du DTO `Note` et 3 types locaux `ExpenseNote` côté front.

**Q1.1 est déjà corrigée** : le PO a décidé 401 sans session et 403 si le rôle est refusé. La [PR #8](https://github.com/2-MORGAN/expense-io/pull/8), fusionnée le 20/10, applique cette règle aux 10 opérations manager/RH et adapte les tests ACL. La présente ADR consigne cette décision ; elle ne présente pas son implémentation comme un travail restant.

Le front et le serveur sont livrés ensemble, mais la plateforme peut devenir internationale et accueillir d'autres consommateurs. Le contrat doit être utilisable par des développeurs et des agents, sans rendre les refactorings dépendants de textes d'erreur ou de représentations dupliquées.

Cette ADR décide du contrat HTTP. Les corrections de sécurité B1 à B6 et B12 restent sous l'ADR-001 ; les règles métier B8, B13 et B16 sous l'ADR-002. B9 et les traitements OCR/notifications sont coordonnés avec l'ADR-003. Le harnais, la CI et la procédure d'évolution des tests suivent l'ADR-005. Les choix ci-dessous ne valent pas validation des autres ADR ni preuve de leur implémentation.

## 2. Options et compromis

| Sujet | Options comparées | Choix et justification |
|---|---|---|
| Erreurs | Enrichir `{error}` ; adopter RFC 9457 | **RFC 9457**, extensible et déjà visée par le dépôt. Le format maison imposerait de définir et maintenir une convention équivalente |
| Langue | Français dans l'API ; traduction serveur avec `Accept-Language` ; anglais canonique et traduction front | **Anglais canonique + traduction front**, pour un contrat stable indépendant de la locale. La localisation des messages rejoint celle de l'interface |
| Capture | Corriger chaque `return await` ; wrapper commun | **Wrapper commun**, qui attend l'opération complète et centralise les réponses ; des corrections locales seules laisseraient le même oubli possible |
| Contrat | Documentation issue des handlers ; OpenAPI défini en premier | **Contract-first**, pour rendre les changements explicites avant implémentation et dériver les artefacts d'une référence commune |
| Entrées | Validation locale dans chaque handler ; schémas dérivés et contrôles partagés | **Schémas dérivés du contrat**, complétés par les contrôles de calendrier et de contenu de fichier ; moins de règles indépendantes à maintenir |
| Versioning | Ajouter `/v1` partout ; conserver les URL et formaliser la compatibilité | **URL actuelles**, tant qu'aucun besoin de contrats incompatibles simultanés ne justifie un nouveau préfixe |
| Listes | Listes exhaustives ; pagination par décalage ; pagination par curseur | **Listes exhaustives** (décision du PO du 20/10) : le volume par entreprise ne justifie pas une navigation paginée. Le curseur reste l'option à retenir si le besoin apparaît |

## 3. Décision : erreurs communes

### 3.1 Format et catalogue

Les réponses HTTP d'erreur produites par les 14 opérations métier utilisent **`Content-Type: application/problem+json`**, selon la [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html). Notre contrat exige les membres `type`, `title`, `status`, `detail`, `code` et `requestId`. Ce sont des exigences de l'application ; la RFC ne les impose pas tous. Pour ces réponses, `status` correspond toujours au véritable statut HTTP.

- `type` : référence URI stable du type de problème, par exemple `/problems/authentication-required`, identifiant principal au sens de la RFC ; une correspondance unique avec `code` est documentée dans le catalogue.
- `title` : intitulé public stable du problème ; `detail` : explication publique utilisable pour cet échec, sans donnée technique interne.
- `code` : identifiant applicatif stable en anglais, utilisable par le front, sans analyser le texte.
- `requestId` : identifiant de corrélation produit côté serveur et repris dans les logs, sans donnée personnelle.
- `errors` : extension facultative pour les validations, avec une liste d'objets `{field, code, message}`. Les chemins des champs sont documentés ; aucune valeur soumise n'est recopiée dans les erreurs.

Exemple de réponse cible, HTTP 401 :

```json
{
  "type": "/problems/authentication-required",
  "title": "Authentication required",
  "status": 401,
  "detail": "Please sign in to continue.",
  "code": "AUTHENTICATION_REQUIRED",
  "requestId": "5d693674-3f69-4ea2-bb6b-c9d502eefad9",
  "error": "Unauthorized"
}
```

Catalogue initial à formaliser dans le contrat :

| Statut | Codes applicatifs |
|---|---|
| 400 | `INVALID_JSON`, `VALIDATION_ERROR`, `RECEIPT_TOO_LARGE`, `RECEIPT_TYPE_NOT_ALLOWED`, `IMAGE_TOO_LARGE`, `INVALID_IDEMPOTENCY_KEY` |
| 401 | `AUTHENTICATION_REQUIRED` |
| 403 | `FORBIDDEN` |
| 404 | `RESOURCE_NOT_FOUND` |
| 409 | `ALREADY_DECIDED`, `INVALID_MANAGER` |
| 422 | `IDEMPOTENCY_KEY_REUSED` |
| 500 | `INTERNAL_ERROR` |
| 503 | `OCR_UNAVAILABLE`, `OCR_TIMEOUT`, `OCR_OVERLOADED` |

Pour `VALIDATION_ERROR`, les codes de champ précisent notamment `REQUIRED`, `INVALID_UUID`, `INVALID_AMOUNT`, `INVALID_DATE` et `EMPTY_FILE`. Une cause technique inattendue devient 500 `INTERNAL_ERROR`, avec un message générique, jamais `error.message` ou `stack`. Une indisponibilité identifiée de l'OCR suit le cas 503 de la section 8.

### 3.2 Internationalisation et transition de `error`

**Les textes canoniques de l'API sont en anglais** (`title`, `detail`, messages de validation). Le front choisit les traductions à partir de `code` et des codes de champ. Un code inconnu produit un message générique dans la langue de l'utilisateur. Les phrases de l'API ne servent pas de clés de traitement. Cette décision amende la convention actuelle de `CLAUDE.md` « messages utilisateur en français » : les messages d'interface restent localisés ; l'API possède une langue canonique. Les formats d'échange ne dépendent pas de `Accept-Language`.

Le membre **`error` est conservé et déprécié**, comme extension RFC 9457. Pendant la migration, il conserve les textes publics historiques pour les refus déjà connus (`Unauthorized`, `Not found`, `Already decided`, `Invalid manager`, et les messages français de validation/reçu). Cette liste est bornée à l'existant et recensée dans le contrat ; les nouvelles erreurs ont un texte anglais public. Aucun ancien message technique de 500 n'est conservé : `error` devient un message générique anglais.

Il existe donc une **exception transitoire à la langue unique pour ce seul membre historique**. Le contrat canonique reste anglais. Le champ `error` n'est pas nécessairement un alias de `detail` pendant cette période. Sa suppression suit la dépréciation de la section 7, après migration des consommateurs et des tests. Garder le champ ne rend pas tous les changements compatibles : les 500, le type de contenu et certains messages affichés évoluent explicitement.

### 3.3 Capture et garantie

Un wrapper HTTP commun attend (`await`) l'opération complète : garde, parsing/validation, cas d'usage et sérialisation. Les rejets asynchrones sont capturés avant de construire la réponse. Les refus attendus et les exceptions passent par le même constructeur de problèmes et le même catalogue ; les routes ne fabriquent plus d'enveloppes d'erreur indépendantes.

Le wrapper appelle le logger structuré de l'ADR-005 pour les erreurs techniques. Message interne et pile restent côté serveur, avec filtrage des secrets et données sensibles. `onRequestError` complète le diagnostic, sans remplacer la capture du wrapper. Les erreurs générées avant le handler par le proxy, l'hébergement ou le framework ne sont pas promises au même format ; Auth.js, les méthodes non implémentées, les `HEAD` sans corps et les `OPTIONS` automatiques sont hors de cette garantie.

## 4. Décision : authentification, rôle et visibilité

Ordre des vérifications : **session → rôle → validation structurelle des identifiants → visibilité de la ressource → règle métier → effet de bord**. La garde commune session/rôle s'intègre au wrapper ; les permissions sur les ressources restent explicites dans les politiques/cas d'usage, avec l'isolation en base de l'ADR-001. Le placement exact des helpers est à aligner avec Antoine dans 2-470/2-487 ; aucune dépendance HTTP ne doit entrer dans le domaine.

| Situation | Réponse |
|---|---|
| Session absente, expirée ou compte supprimé | 401 `AUTHENTICATION_REQUIRED` |
| Session valide, rôle actuel refusé pour l'opération | 403 `FORBIDDEN` |
| Rôle admis, ressource inconnue ou non visible, notamment autre entreprise ou autre équipe | 404 `RESOURCE_NOT_FOUND`, même réponse publique dans tous ces cas |
| Ressource visible mais transition métier impossible | Code du conflit documenté, notamment 409 `ALREADY_DECIDED` |

Le rôle et l'entreprise sont relus en base selon l'ADR-001, plutôt que de se fier aux droits figés dans le JWT. **AUTH-10 attend 403 pour un manager rétrogradé et 401 pour un compte supprimé**. Le texte de l'ADR-001 consultée comporte déjà cet amendement ; le scénario reste à implémenter dans la suite, qui s'arrête actuellement à AUTH-09.

Une précision évite une contradiction avec l'ADR-001 : sur `PUT /hr/users/{id}/manager`, une **cible** étrangère renvoie 404 ; un `managerId` syntaxiquement valide mais non admissible reste 409 `INVALID_MANAGER`, y compris un manager d'une autre entreprise (ISO-06). Aucun détail n'indique pourquoi ce manager est invalide. Une erreur SQL RLS n'est pas traduite aveuglément en 403 : l'adaptateur doit la rattacher au refus d'action ou à l'invisibilité documentés, sans exposer l'entreprise.

## 5. Décision : contrat et types partagés

### 5.1 Source de vérité et consommateurs

Un document **OpenAPI 3.1**, versionné à la racine sous `openapi.yaml`, décrit le contrat HTTP des 14 opérations : méthodes et chemins, paramètres et tris autorisés, authentification par session/cookie, droits requis, requêtes JSON/multipart, réponses de succès, problèmes et en-têtes. Le protocole interne d'Auth.js reste documenté par sa bibliothèque. **Génération retenue par le PO le 20/10.** Les outils sont choisis et justifiés dans la PR de 2-486 (`CLAUDE.md` : pas de dépendance sans justification), en dépendances de développement de préférence. Piste recommandée : `openapi-typescript` pour les types (aucun code à l'exécution) et `ajv` pour valider les entrées, les schémas d'OpenAPI 3.1 étant du JSON Schema. Aucun paquet n'est ajouté par cette ADR elle-même.

Le premier contrat caractérise le comportement réellement déployé, sans transformer une faille en comportement garanti. Les changements de la présente ADR sont identifiés comme cibles jusqu'à leur implémentation. Ensuite, **contract-first** : toute évolution modifie d'abord le contrat examiné en revue, puis le code, les artefacts dérivés et les tests dans la même PR. La version publiée du contrat correspond toujours au code de sa livraison ; une cible ou route future ne se fait pas passer pour une opération déjà disponible.

Les consommateurs du contrat sont les développeurs/intégrateurs, le front et la couche HTTP serveur via les types générés, et la CI via la validation des réponses. Les règles d'autorisation et les exemples complètent les schémas : un schéma seul ne prouve ni l'isolation ni un résultat métier correct.

### 5.2 DTO et sérialisation

Les types TypeScript de requête/réponse sont générés depuis le contrat et partagés par le front et la couche HTTP serveur. Les fichiers générés ne sont pas modifiés à la main. Le schéma `ExpenseNote` décrit initialement les champs existants `id`, `userId`, `amount`, `expenseDate`, `description`, `receiptKey`, `status` et `createdAt`. `status` est l'énumération `pending | approved | rejected`, `expenseDate` une date civile et `createdAt` un horodatage UTC. `amount` reste un nombre JSON en réponse pour préserver le contrat existant.

Un sérialiseur de note unique remplace les 7 constructions actuelles ; les 3 types locaux du front utilisent le type généré ou une sélection explicite de ses champs. Le même principe s'applique au DTO utilisateur. La classe métier `ExpenseNote` et les lignes SQL restent distinctes du DTO HTTP. Le retrait éventuel de `receiptKey` (B14) exige sa propre décision de compatibilité ; cette ADR ne le supprime pas.

Les types générés vérifient le code à la compilation, **pas les données à l'exécution**. Les validateurs d'entrée et les contrôles de réponse de la CI sont donc également dérivés du contrat, selon la section 6.

### 5.3 Développement agentique

Les instructions du dépôt doivent orienter développeurs et agents vers le ticket, les ADR acceptées et le contrat avant toute modification d'une opération. Une fois le contrat convenu, serveur et front peuvent être développés en parallèle. Les modifications du contrat lui-même restent coordonnées et relues.

La CI contrôle la validité d'OpenAPI, la correspondance **méthode + chemin** entre opérations et handlers métier, la fraîcheur des fichiers générés et la conformité des réponses des scénarios API. La suite E2E, les tests de permissions et les règles métier gardent leurs assertions indépendantes. Modifier simultanément le contrat, le code et les tests ne prouve pas que le changement était autorisé : les ruptures nécessitent une ADR acceptée et la revue prévue par l'ADR-005.

## 6. Décision : validation des entrées

Les requêtes sont validées côté serveur, après la garde et **avant toute écriture ou upload**. La validation front améliore l'expérience ; elle ne remplace pas cette vérification. Les schémas proviennent du contrat et sont compilés/générés pour l'exécution. Les contrôles non exprimables par un simple schéma sont centralisés et testés, sans maintenir une seconde définition indépendante du contrat.

| Entrée | Règle |
|---|---|
| `amount` multipart | Chaîne décimale complète, chiffres et point, sans séparateur de milliers, suffixe, notation scientifique ou arrondi implicite. `12`, `12.5`, `12.50` sont valides ; `12abc`, `12,50`, `0.001`, zéro et les négatifs sont refusés. Précision contrôlée avant conversion ; maximum 99 999 999,99, cohérent avec `numeric(10,2)` |
| `expenseDate` | Chaîne `YYYY-MM-DD`, calendrier valide ; aucune conversion de fuseau. Une interdiction des dates futures serait une règle métier distincte, non décidée ici |
| Identifiants | Validation UUID à l'exécution pour les 8 opérations comportant `{id}` et pour `managerId` non nul ; le format ne vaut pas autorisation |
| `description` | Chaîne obligatoire et non vide après vérification des espaces aux extrémités ; pas de troncature implicite |
| JSON | JSON malformé, corps de mauvais type, champ obligatoire absent ou de mauvais type : 400, sans valeur par défaut destructive |
| Reçu | Fichier requis, non vide, au plus 10 Mio ; contenu cohérent avec le MIME autorisé, vérifié à partir des octets et de contrôles adaptés au format ; le nom et le MIME client ne suffisent pas |

Pour `managerId` : `{}` ou un JSON invalide → **400 sans modification** ; `{ "managerId": null }` → détachement explicite ; `{ "managerId": "UUID" }` → demande de rattachement soumise ensuite aux permissions et règles métier. Un UUID malformé donne 400, un manager non admissible 409.

Un composant partagé valide les reçus pour création et OCR, avec des capacités propres à l'usage. La création conserve PNG/JPEG/WebP/PDF. Un PDF valide fourni à l'OCR conserve **200 `{}`** ; les autres types non pris en charge conservent le résultat vide prévu par l'ADR-003 après les contrôles communs de taille et de présence. Les images analysées suivent la limite 40 Mpx et la réduction à 2 500 px de l'ADR-003. Un fichier corrompu ou prétendant être un autre format ne constitue pas un PDF ou une image valide.

Les refus d'entrée donnent **400** au format commun, avec détail par champ lorsque pertinent. Le reçu trop volumineux reste 400, conformément à NDF-10 et l'ADR-003 ; aucun passage implicite à 413/415/422 n'est décidé pour la validation courante. Le 422 de réutilisation d'une clé d'idempotence est un cas distinct, section 8.

Le plafond doit aussi être appliqué sur le flux reçu, avant le buffering complet, avec les bornes de transport adaptées au multipart : vérifier `File.size` après `formData()` ne borne pas à lui seul la mémoire consommée. Les protections de charge OCR restent portées par 2-475.

Pour l'international, la locale ne change ni les montants transmis avec point décimal ni les dates civiles ISO. Le front adapte la saisie et l'affichage. **Le modèle actuel ne possède pas de devise** : le multi-devise, les règles de change et les précisions monétaires différentes demandent une décision métier et une évolution de contrat ; ils ne sont pas considérés comme livrés par cette ADR.

## 7. Décision : compatibilité, dépréciation et listes

### 7.1 Compatibilité et versioning

Les URL actuelles sont conservées, **sans `/v1` ajouté maintenant**. Une nouvelle version d'URL sera justifiée si des contrats incompatibles doivent coexister pour des consommateurs qui ne peuvent pas migrer ensemble. L'internationalisation ne constitue pas, à elle seule, ce besoin.

- Ajout d'une route ou d'un champ de réponse facultatif : compatible si les clients existants continuent à fonctionner. L'ajout d'une valeur d'énumération n'est pas automatiquement compatible avec leurs traitements exhaustifs.
- Suppression/renommage de champ, changement de type ou de statut HTTP, entrée devenue obligatoire et changement de sens d'une liste : incompatibles. Ils nécessitent décision explicite, migration coordonnée et tests associés selon l'ADR-005.
- Un élément déprécié est signalé dans OpenAPI, avec son remplacement et la livraison de retrait annoncée **au moins une livraison à l'avance**. Le retrait n'intervient qu'après migration des consommateurs connus. Si cette migration ne peut pas être simultanée, les contrats coexistent.
- `info.version` trace le contrat avec des versions majeures pour les ruptures, mineures pour les ajouts compatibles et correctives pour les corrections documentaires sans effet HTTP. Cela n'ajoute aucun préfixe d'URL et ne se confond pas avec la version du package npm.

**Mise à jour du 27/10/2026 : règles vérifiées par la CI.** Sur chaque PR, le job `check` compare `openapi.yaml` à celui de la branche visée avec oasdiff 1.34.1 (`scripts/check-api-breaking.sh`, binaire à empreinte SHA-256 vérifiée) et échoue sur tout changement incompatible : champ de réponse retiré, statut changé, entrée devenue obligatoire. L'ajout d'un code d'erreur à une énumération n'est qu'un avertissement (`scripts/oasdiff-levels.txt`), conformément au catalogue extensible de la section 3. Une rupture voulue demande une ADR acceptée, puis le label `rupture-contrat` sur la PR. En local : `make api-breaking`.

### 7.2 Listes : pas de pagination

**Décision du PO du 20/10 : les quatre listes restent complètes**, sans paramètre `limit` ni en-tête `Link`. Le volume d'une entreprise (quelques dizaines de notes et d'utilisateurs) ne justifie pas la migration du front et le changement de sens des listes. Aucun test E2E ne change.

Le `sort` ne devient jamais un fragment SQL fourni par le client : la liste blanche est le correctif B1 de l'ADR-001. Les usages légitimes `amount ASC` et `amount DESC` de NDF-12 restent décrits dans le contrat, avec un départage par `id` pour un ordre stable.

**Réouverture** si une liste dépasse quelques centaines d'éléments pour un tenant ou si la charge des listes devient mesurable (B10). On retiendrait alors la pagination par curseur (un décalage fait sauter des lignes quand une décision retire une note de la liste d'approbation) ; c'est un changement incompatible, à décider par une nouvelle ADR.

## 8. Coordination ADR-003 : disponibilité, idempotence et futur asynchrone

### 8.1 OCR synchrone

La route actuelle reste synchrone. Aucun résultat reconnu ou type valide non pris en charge (notamment PDF) → **200 `{}`**, conformément à OCR-03/07. Panne moteur identifiée → **503 `OCR_UNAVAILABLE`** ; timeout → **503 `OCR_TIMEOUT`** ; saturation → **503 `OCR_OVERLOADED`**. Les trois utilisent le format commun et **`Retry-After: 5`**, qui indique quand réessayer sans garantir la réussite. Les bornes de durée/concurrence sont celles de l'ADR-003. Une exception inattendue hors de ces cas reste 500.

### 8.2 Création et `Idempotency-Key`

La création conserve **201** et accepte un en-tête facultatif `Idempotency-Key` au format UUID. Portée : utilisateur, entreprise et opération ; l'unicité `(user_id, idempotency_key)` prévue pour les notes par l'ADR-003 reste cohérente avec cette portée. Une future opération possède son propre espace de clés. Une clé ne dispense jamais de l'authentification ni des droits actuels.

| Cas | Réponse et effet |
|---|---|
| En-tête absent | Comportement existant, sans déduplication |
| Clé malformée | 400 `INVALID_IDEMPOTENCY_KEY`, aucune création |
| Même clé et même empreinte de contenu | 201, même note, `Idempotent-Replayed: true`, aucun nouvel upload ni nouvel événement |
| Même clé et contenu différent | 422 `IDEMPOTENCY_KEY_REUSED`, aucune seconde note |

L'empreinte porte sur montant normalisé, date, description et octets du reçu, plutôt que sur les frontières multipart. Le formulaire conserve sa clé pour les tentatives du même envoi et la renouvelle après succès ou lorsqu'il prépare un envoi différent. L'en-tête ne sera pas rendu obligatoire sans décision de rupture ultérieure ; cette ADR ne programme pas de « v2 » automatique.

La rétention liée à la note, l'arbitrage concurrent par unicité et la compensation S3 restent sous l'ADR-003/2-476. Deux appels concurrents identiques doivent converger vers la même note. Si le contenu diffère, le perdant renvoie 422 ; aucun contenu d'une autre requête n'est retourné à un appel non autorisé.

### 8.3 Contrat prospectif asynchrone

Les déclencheurs de passage à l'asynchrone restent ceux de l'ADR-003. Le contrat prospectif prépare les opérations suivantes **sans `/v1`** :

```http
POST /api/receipt-analyses
Content-Type: multipart/form-data
Idempotency-Key: <UUID>

HTTP/1.1 202 Accepted
Location: /api/receipt-analyses/{id}
Content-Type: application/json

{ "id": "...", "status": "queued" }
```

GET `/api/receipt-analyses/{id}` renvoie 200 et l'état `queued | running | succeeded | failed`, avec le résultat en cas de succès, ou un objet de problème en cas d'échec du traitement. Un traitement échoué peut être consulté avec succès : ce GET reste 200 ; son problème imbriqué n'est pas le statut HTTP du GET. Les refus d'accès ou d'entrée de ces futures opérations suivent 401/403/404/400 ; un traitement étranger reste invisible. Les détails de rétention, reprise, taille et fréquence de polling seront fixés dans le contrat prospectif avant implémentation.

Ces deux opérations ne font pas partie des 14 opérations actuelles. **Leur implémentation est planifiée** ([2-503](https://linear.app/2-morgan/issue/2-503), décision du PO du 20/10) : elles entrent dans l'OpenAPI et dans son contrôle de couverture dans la PR qui livre leurs handlers, pas avant. La route synchrone existante est conservée. Les exemples de l'ADR-003 ont été alignés (sans `/v1`, sans « v2 »). Le transport interne, les workers et l'outbox ne sont pas redécidés ici.

## 9. Comportement observable

Le tableau distingue le comportement d'origine audité de l'état présent et des changements proposés. **Seule la ligne 401/403 est déjà appliquée sur le commit étudié** ; les autres cibles nécessitent leurs correctifs et la validation de cette ADR.

| Sujet / opérations | Avant → après | Justification et tests |
|---|---|---|
| 10 opérations manager/RH, décision du PO déjà appliquée | Manager : absence ou mauvais rôle → 401 ; RH : absence ou mauvais rôle → 403. Après : sans session → 401 partout ; rôle refusé → 403 | Distinguer authentification/autorisation. PR #8 : ACL-01, ACL-02 et ACL-04 changés ; ACL-03 confirme le 403 déjà attendu. Corps historique conservé |
| Ressource non visible, notamment reçus manager | Certains accès étrangers pouvaient répondre 200 → 404 identique à une ressource inconnue | Masquer l'existence et aligner ADR-001 : ISO-01/02/03, RECU-02/05/07, MGR-09, RH-08, ORG-08 ; ajouter ISO-04/05/09. ISO-06 conserve 409 pour le manager proposé invalide |
| Révocation des droits | Droits JWT figés → rôle/entreprise actuels ; manager rétrogradé → 403, compte supprimé → 401 | ADR-001 S9/B6 ; ajouter AUTH-10. Le texte de l'ADR-001 est déjà amendé |
| Erreurs explicites et techniques des 14 opérations | `{error}` ou réponse framework non garantie → problème commun avec code et corrélation, sans pile/message interne | Q1.2/Q1.3, B4/S6. Étendre `expectApiError` et ACL-01 à 04 ; ajouter ERR-01 de l'ADR-001 avec une panne injectée, et tests de capture. Une date invalide devient 400 : elle ne peut plus servir de déclencheur fiable d'un 500 |
| Langue et affichage des erreurs | Front affiche souvent directement `error`, textes mélangés → traductions par code, langue canonique API anglaise, `error` historique transitoire | Internationalisation. Préserver les parcours français ; MGR-05 passe de « Already decided » à « Cette note a déjà été tranchée. » en français. Les tests API gardent les anciens textes du seul champ `error` pendant la transition |
| Montant/date/UUID/JSON et `managerId` | Parsing partiel, dates/UUID donnant parfois 500, JSON invalide/absent détachant avec 200 → 400 sans mutation | B7. Conserver NDF-08 et ORG-06 ; ajouter cas stricts de montant, calendrier, UUID, JSON et absence/null |
| Reçus | MIME déclaré et fichier vide acceptés → contenu vérifié, vide refusé ; plafond création 10 Mio et code 400 conservés | B7, ADR-003. Adapter les fixtures de NDF-07 et RECU-03 : elles sont actuellement des PNG réétiquetés JPEG/WebP/PDF. Fournir de vrais formats, conserver les objectifs de succès et ajouter les cas falsifiés. Rejouer NDF-03/05/07/09/10 et RECU-01 à 07 |
| OCR | Panne/timeout/saturation → 200 `{}` ; après → 503 et `Retry-After`. PDF valide/rien reconnu → 200 `{}` inchangé | B10/B11, ADR-003. Conserver OCR-01 à 08 ; ajouter tests taille/pixels/panne/timeout/saturation et absence d'effet de bord |
| Quatre listes | Inchangées : réponses complètes, tris légitimes conservés (décision du PO, pas de pagination) | NDF-01/04/11/12, MGR-01/02/06, RH-01/02/05, ORG-01/05 inchangés |
| Création avec clé | Clé ignorée, doublons possibles → rejeu identique 201/même note, contenu différent 422, sans clé inchangé | B9, ADR-003. Conserver NDF-06 et FLOW-01 ; ajouter tests d'idempotence et de concurrence |
| OCR asynchrone (2-503) | Aucune route de suivi → contrat 202 + Location puis consultation 200 | Décision du PO du 20/10. Ajouté au contrat avec ses handlers ; OCR synchrone conservé, OCR-01 à 08 inchangés ; ajouter lancement + suivi et invisibilité d'une analyse étrangère |

## 10. Vérification et impacts

La rédaction de cette ADR ne modifie ni l'application, ni les E2E, ni le contrat HTTP déployé. Les implémentations seront acceptées lorsque :

1. **Statique/contrat** : lint OpenAPI, correspondance des 14 opérations, génération reproductible des types/validateurs, absence de différences après régénération et `npm run lint` / `npm run typecheck` verts.
2. **Erreurs** : tests de l'erreur attendue, de l'exception synchrone, du rejet asynchrone et du mapping d'infrastructure ; statut réel égal à `status`, absence de fuite technique, `requestId` corrélable. Valider les réponses de la suite API contre le contrat via `e2e/support/api.ts` (ADR-005).
3. **Entrées** : bornes et précision du montant, dates invalides/bissextiles, UUID, JSON, absent/null, fichiers vides/falsifiés et limites ; aucune mutation/upload sur rejet structurel.
4. **Permissions** : ACL/ISO sous les conditions de l'ADR-001, rôle relu en base, ressource étrangère/inconnue indistinguable ; tests de domaine indépendants des types générés.
5. **Disponibilité/idempotence** : pannes injectées, `Retry-After`, même note lors des replays et appels concurrents, aucune création supplémentaire ni nouvel upload/événement.
6. **Non-régression** : suite E2E complète ; changements d'attendus uniquement après acceptation par Florent, dans la même PR que l'implémentation avec un commit de tests distinct et la revue prévue par l'ADR-005.

Impacts positifs : contrat explicite et exploitable par les agents, erreurs traduisibles et diagnostiquables sans fuite, moins de duplication. Coûts : chaîne de génération et validation à maintenir, traduction front, fixtures réelles. Les listes restent non bornées (risque B10 accepté, voir 7.2). La validation de format d'un fichier ne constitue pas une garantie générale d'innocuité du contenu.

## 11. Correctifs et tickets

**Travaux rattachés aux tickets existants (aucun nouveau ticket, décision du PO du 20/10), plus 2-503 pour l'OCR asynchrone.** Les tickets 2-392 et 2-393 sont annulés dans Linear et ne doivent pas être réactivés comme doublons des tickets regroupés.

| Travail / critère de fin | Ticket existant ou à créer | Coordination / ordre |
|---|---|---|
| Contrat des 14 opérations, schémas communs, types/validateurs dérivés, suppression des types HTTP locaux, exemples et politique de compatibilité | [2-486](https://linear.app/2-morgan/issue/2-486), périmètre à préciser avec ces artefacts | WS4 ; base avant bascule des réponses et validations |
| Wrapper, constructeur/catalogue d'erreurs, corrélation, suppression des fuites et prise en charge des rejets asynchrones | [2-485](https://linear.app/2-morgan/issue/2-485) | WS4 + WS5 T9 (logs ADR-005) ; ne pas dupliquer le logger |
| Garde session/rôle et sérialiseur de note uniques, sans nouvelle modification du comportement | [2-487](https://linear.app/2-morgan/issue/2-487) | WS2, après correctifs sécurité 2-471 et ADR-002 amendée 2-470 ; intégrer les types de 2-486, ne pas créer une seconde garde dans 2-485 |
| Validation stricte B7, absence/null, reçus partagés et remplacement des fixtures falsifiées | [2-486](https://linear.app/2-morgan/issue/2-486) (regroupé, décision du PO) | WS4, dépend de 2-486 et du constructeur de 2-485 ; contrôles OCR partagés avec 2-475 |
| Lecture front des codes d'erreur, traductions et fallback localisé ; dépréciation de `error` | [2-485](https://linear.app/2-morgan/issue/2-485) (regroupé, décision du PO) | WS4/front, même livraison que la bascule vers le format commun ; documenter MGR-05 |
| Lint OpenAPI, couverture opérations, génération à jour et conformité des réponses API en CI | ADR-005 T10, à rattacher au ticket WS5 correspondant ou créer s'il n'existe pas | WS5 + WS4 ; dépend du contrat, aucune réécriture de scénarios pour simplement suivre les schémas |
| Bornes OCR et réponses 503/Retry-After | [2-475](https://linear.app/2-morgan/issue/2-475) | Jacques/WS3 ; réutiliser le validateur de reçu et le format commun |
| Soumission fiable et idempotence facultative | [2-476](https://linear.app/2-morgan/issue/2-476) | Jacques/WS3 ; normalisation, concurrence, compensation et tests |
| Révocation/réévaluation des droits et AUTH-10 | [2-496](https://linear.app/2-morgan/issue/2-496), selon ADR-001 | WS1 ; attendu 403/401 confirmé, ne pas rouvrir la décision |
| OCR asynchrone : lancement 202, suivi, traitement par le worker, bouton en polling | [2-503](https://linear.app/2-morgan/issue/2-503) | Jacques/WS3 ; dépend de 2-475 et du worker de 2-484 |
| Actualiser les renvois ADR-001/003/005 et les instructions agents/conventions ; publier ce document dans SharePoint | Coordination de 2-391 avec les auteurs ; 2-470 pour ADR-002 | **Fait le 20/10** pour ADR-001 (ERR-01) et ADR-003 (`/v1`, « v2 ») ; reste à aligner les vérifications WS5 |

Le contrat des analyses asynchrones est documenté avec WS3 ; son implémentation (2-503) n'est pas un prérequis de clôture de cette ADR. La validation de Florent et le dépôt SharePoint restent nécessaires pour considérer le livrable 2-391 terminé.

## 12. Références

- [Ticket 2-391 et décision du PO](https://linear.app/2-morgan/issue/2-391) ; [PR #8, correction 401/403](https://github.com/2-MORGAN/expense-io/pull/8).
- [Audit WS4 Q1–Q3 et B1–B16](../audit/WS4-Q1-Q3.md) ; [référence E2E et IDs](../tests/E2E.md).
- [Index et statuts des ADR](README.md).
- [ADR-001 — Isolation multi-tenant](ADR-001-isolation-multi-tenant.md).
- [ADR-003 — OCR, soumission et notifications](ADR-003-ocr-soumission-notifications.md).
- [ADR-005 — Harnais de validation](ADR-005-harnais-de-validation.md).
- [ADR-002 — Architecture cible](ADR-002-architecture-cible.md) (tickets [2-383](https://linear.app/2-morgan/issue/2-383) et [2-470](https://linear.app/2-morgan/issue/2-470)).
- [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html) ; [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.1.html).

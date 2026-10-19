# WS1 — Audit Sécurité : S1, S2, S3

Audit du **11 octobre 2026**, commit `4fad1d3c4683082422d67ae72979a2c1f08e3ff1` (branche `docs/audit-ws1-s1-s3`).
Périmètre : les trois failles d'isolation inter-entreprises du ticket **2-378** — injection SQL (`S1`), IDOR sur les reçus manager (`S2`), rattachement manager cross-tenant (`S3`). Aucune modification de `src/`, `migrations/` ni `scripts/` : phase d'audit, documentation seule.

**Résultat :** les trois failles sont **confirmées par reproduction** sur l'application lancée (`make dev`).

## Méthode

- Environnement local : Next.js sur `http://localhost:3000`, PostgreSQL sur `5433`, LocalStack (S3) sur `4567`.
- Reproductions menées en **requêtes HTTP authentifiées via le flux de connexion normal de l'application** (Auth.js Credentials : `GET /api/auth/csrf` puis `POST /api/auth/callback/credentials`, cookie de session réutilisé). Pas de payload d'exfiltration, pas d'accès hors de l'environnement local, pas de `DROP`/`DELETE`/`TRUNCATE`.
- **Comptes et données de test créés** (signalés comme demandé), sans toucher au seed :
  - Entreprise **B** « acme » créée par le parcours d'inscription : `hr@acme.test` (hr_admin), `emp@acme.test` (employee), une note de frais « Taxi » avec reçu `receipts/3.pdf`.
  - Entreprise **A** = seed existant (`expense.io`) : `manager@expense.io` (manager racine), `demo@expense.io` (employé rattaché).
- L'unique écriture de test (S3 : rattachement cross-tenant) a été **restaurée** via le même endpoint applicatif (`managerId=null`) en fin de reproduction, état vérifié.

**Échelle criticité × effort** (alignée sur WS2, `docs/audit/WS2-A1-A3.md`) : criticité **n/5** (impact sécurité/isolation), effort **n/5** (coût d'une correction ciblée avec test, à comportement observable inchangé).

**Interaction avec S4 (ticket 2-379) :** l'application se connecte à PostgreSQL avec un rôle superuser (`rolsuper`/`rolbypassrls`, constaté en base), donc la RLS est contournée et l'isolation repose en pratique sur les `WHERE` manuels des routes. Cela **amplifie** S1 et S2 (voir chaque section). S4 est audité en 2-379.

---

## S1 — Injection SQL via le paramètre `?sort=`

### Emplacement

- [`src/app/api/expense-notes/route.ts:42`](../../src/app/api/expense-notes/route.ts#L42) : `const sort = url.searchParams.get('sort') || 'created_at DESC'`
- [`src/app/api/expense-notes/route.ts:46`](../../src/app/api/expense-notes/route.ts#L46) : `` `SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY ${sort}` ``

La valeur du paramètre d'URL `sort` est **concaténée directement** dans la clause `ORDER BY`. Le `user_id` est bien lié (`$1`), mais ce `$1` ne protège en rien le fragment de tri. Le commentaire des lignes 39-41 assume la concaténation comme inévitable (« ORDER BY n'accepte pas de paramètre positionnel ») — exact pour un nom de colonne, mais la réponse correcte est une liste blanche, pas la concaténation de l'entrée brute.

### Reproduction

Connecté en tant que `emp@acme.test`, trois requêtes sur la route (cookie de session envoyé automatiquement) :

| Requête | Résultat | Ce que ça prouve |
|---|---|---|
| `GET /api/expense-notes?sort=created_at desc` | **200** | tri normal, référence |
| `GET /api/expense-notes?sort=length(description)` | **200** | une **expression SQL** sur une colonne est évaluée — une liste blanche ou un paramètre lié l'aurait refusée |
| `GET /api/expense-notes?sort=colonne_qui_nexiste_pas` | **500** | PostgreSQL renvoie l'erreur `42703 column "colonne_qui_nexiste_pas" does not exist`, pointant sur `ORDER BY ${sort}` ([`route.ts:46`](../../src/app/api/expense-notes/route.ts#L46)) : la chaîne arrive **brute au moteur SQL** |

L'acceptation de `length(description)` (expression de fonction) et l'erreur `42703` du parseur SQL sur une entrée arbitraire démontrent ensemble que `sort` n'est ni une donnée liée ni une valeur filtrée par liste blanche, mais du SQL exécuté.

> Précision sur la fuite d'erreur : pour **cette** route, le corps renvoyé au client sur le 500 est vide (0 octet). La route fait `return withUserScope(...)` **sans `await`** dans le `try` ([`route.ts:44`](../../src/app/api/expense-notes/route.ts#L44)), donc le rejet échappe au `catch` et n'atteint pas `respondError` : le détail (code `42703`, requête, position) part dans le **log serveur**, pas dans la réponse. La fuite de stacktrace au client (S6) sera démontrée en 2-379 sur une route qui passe réellement par `respondError`.

### Impact

Tout utilisateur **authentifié** (le plus bas privilège : un simple employé) contrôle une portion de la requête SQL. La surface exacte dépend des privilèges du rôle PostgreSQL : avec le rôle superuser réellement déployé (cf. S4), un fragment `ORDER BY` arbitraire ouvre la voie à des lectures indirectes (sous-requêtes, expressions conditionnelles, exfiltration par erreur ou par timing) bien au-delà des propres notes de l'utilisateur. Aucune démonstration d'exfiltration n'a été réalisée (hors périmètre et inutile pour qualifier la faille).

### Concept du cours et compromis

- **Concept.** C'est d'abord une violation de la règle non négociable « zéro concaténation SQL » de `CLAUDE.md`. Sur le plan architectural, c'est le symptôme « SQL dans `route.ts` » (§7, inversion des dépendances) : une couche d'accès aux données centralisée porterait la liste blanche une seule fois au lieu de laisser chaque handler concaténer. *Réserve (règle CLAUDE.local §8) : l'injection comme catégorie n'a pas de section dédiée dans les cours faits à ce jour ; le rattachement « garde-fous / contrat d'entrée » sera précisé après le cours Intégration et garde-fous.*
- **Recommandation.** Liste blanche explicite `{ colonne → expression SQL fixe }` (p. ex. `created_at`, `amount`, `expense_date`), tri par défaut si la clé est absente/inconnue ; aucune autre valeur n'atteint le SQL.
- **Compromis (axes §1).** Sécurité : gain majeur (ferme la faille). Deadline/effort : négligeable, aucune dépendance, compatible avec le gel du 28/10. Scalabilité/coûts : nul. KISS : la liste blanche est plus simple à raisonner que la concaténation « défensive ». Comportement observable inchangé pour les valeurs de tri légitimes.

### Criticité × effort

**Criticité 5/5** (SQL contrôlé par tout compte authentifié, amplifié par le rôle DB superuser — S4) · **Effort 1/5** (liste blanche locale + test).

---

## S2 — IDOR sur le reçu manager (fuite inter-entreprises)

### Emplacement

- [`src/app/api/manager/expense-notes/[id]/receipt-url/route.ts:9`](../../src/app/api/manager/expense-notes/[id]/receipt-url/route.ts#L9) : seul le **rôle** est vérifié (`role !== 'manager'`).
- [`src/app/api/manager/expense-notes/[id]/receipt-url/route.ts:17`](../../src/app/api/manager/expense-notes/[id]/receipt-url/route.ts#L17) : `SELECT receipt_key FROM expense_notes WHERE id = $1` — lecture **par id seul**, via `getPool()` (hors `withUserScope`), **sans** contrôle de subordination, de propriétaire ni d'entreprise, puis signature S3.
- Le commentaire des lignes 14-16 justifie l'absence de contrôle (« la note existe forcément dans la liste des notes en attente du manager ») : c'est faux, la route est appelable directement avec n'importe quel `id`.
- Contraste : la route reçu de l'employé fait le contrôle correct — [`src/app/api/expense-notes/[id]/receipt-url/route.ts:16`](../../src/app/api/expense-notes/[id]/receipt-url/route.ts#L16) borne par `AND user_id = $2` dans `withUserScope`.

### Reproduction

Connecté en tant que **`manager@expense.io`** (manager de l'entreprise A) :

1. **Contrôle négatif** — `GET /api/manager/expense-notes` (liste normale du manager) ne renvoie que la note de son subordonné A :
   `['Taxi aéroport (seed)']`. La note de l'entreprise B n'y figure pas.
2. **La faille** — `GET /api/manager/expense-notes/2dff4778-b937-43f7-9368-3734f44409fb/receipt-url` (note de l'**entreprise B**) → **HTTP 200** avec une URL pré-signée :
   `http://localhost:4567/receipts/receipts/3.pdf?...X-Amz-Signature=...`
3. **Exploitation confirmée** — récupération du fichier via l'URL pré-signée renvoyée → **HTTP 200**, `content-type: application/pdf`, **50 590 octets** : le reçu de l'entreprise B est effectivement servi à un manager de l'entreprise A.

La note cible n'apparaît jamais dans la liste légitime du manager (étape 1), ce qui réfute directement le commentaire du code, et le fichier est réellement exfiltré (étape 3).

### Impact

Un manager de n'importe quelle entreprise, connaissant (ou devinant/obtenant) l'`id` d'une note, télécharge le reçu correspondant de **n'importe quelle autre entreprise** — pièce potentiellement sensible (données personnelles, RGPD). Un UUID non devinable n'est pas un contrôle d'accès. À noter : la RLS ne sauve pas ici — la lecture se fait via `getPool()` hors `withUserScope`, et de toute façon le rôle DB superuser la contourne (S4).

### Concept du cours et compromis

- **Concept.** §3 (isolation inter-tenant) et règle non négociable « autorisation côté serveur, à chaque route » : la fuite inter-entreprises est « le pire incident possible pour un SaaS B2B ». Le code illustre exactement le travers décrit — l'**isolation par discipline** (« on suppose que la vérification a été faite en amont ») au lieu d'un contrôle d'accès structurel. Renvoie aussi à la centralisation des permissions (§3-4) : un contrôle d'accès aux ressources commun éviterait cet oubli route par route.
- **Recommandation.** Lire la note **sous `withUserScope`** et vérifier explicitement le lien avant de signer : la note appartient à un subordonné direct du manager **et** à la même entreprise. À terme, extraire ce contrôle dans un cas d'usage/politique d'accès partagé (§7, découplage).
- **Compromis (axes §1).** Sécurité/souveraineté (RGPD) : gain majeur. Effort : faible, correction locale, JSON de réponse inchangé pour les accès légitimes. Maturité équipe : le contrôle existe déjà sur la route employé — on réplique un patron connu.

### Criticité × effort

**Criticité 5/5** (exfiltration inter-entreprises confirmée d'un fichier réel) · **Effort 1/5** (ajout du contrôle de lien/tenant sous scope).

---

## S3 — Rattachement manager cross-tenant

### Emplacement

- [`src/app/api/hr/users/[id]/manager/route.ts:39-42`](../../src/app/api/hr/users/[id]/manager/route.ts#L39-L42) : le manager choisi n'est validé que sur son **rôle** (`WHERE id = $1 AND role = 'manager'`), **sans** condition `company_id`.
- Le commentaire des lignes 35-38 justifie l'absence de contrôle (« l'appartenance à la même entreprise est déjà garantie par l'annuaire GET /api/hr/users ») : c'est faux côté serveur — le `managerId` du corps JSON n'est pas contraint par ce que liste l'UI.
- La cible, elle, est correctement bornée à l'entreprise de la RH ([`route.ts:23-25`](../../src/app/api/hr/users/[id]/manager/route.ts#L23-L25)) — l'asymétrie est la faille.
- Amplification : la policy RLS manager ne borne que `manager_id`, sans `company_id` — [`migrations/1700000000001_init-schema.sql:50-58`](../../migrations/1700000000001_init-schema.sql#L50-L58) — donc une fois le `manager_id` cross-tenant posé, la RLS laisse voir la note (cf. S4).

### Reproduction

1. **État initial** — `manager@expense.io` (entreprise A) ne voit que sa note A : `['Taxi aéroport (seed)']`.
2. **La faille** — connecté en **`hr@acme.test`** (RH de l'entreprise B), rattacher son employé B au manager de l'entreprise A :
   `PUT /api/hr/users/44b4b5d4-…(emp B)/manager` avec `{"managerId":"1f5448e3-…(manager A)"}` → **HTTP 200** :
   `{"id":"44b4b5d4-…","email":"emp@acme.test","role":"employee","managerId":"1f5448e3-…"}`.
3. **Impact** — `manager@expense.io` voit désormais la note de l'employé **de l'entreprise B** dans sa liste à valider :
   `[('Taxi aéroport (seed)', demo A), ('Taxi', emp B)]`. Le manager A peut donc consulter **et approuver/rejeter** des notes de l'entreprise B.
4. **Restauration** — `PUT …/manager` avec `{"managerId":null}` → 200 ; la liste du manager A revient à `['Taxi aéroport (seed)']`.

### Impact

Une RH peut rattacher un de ses employés à un manager d'une **autre** entreprise, ouvrant à ce manager externe la lecture des reçus et le pouvoir de décision (approve/reject) sur les notes concernées. Le franchissement traverse l'application **et** la RLS (la policy manager ignore `company_id`). Impact bidirectionnel sur l'isolation et sur l'intégrité du workflow d'approbation.

### Concept du cours et compromis

- **Concept.** §3, cœur du sujet : isolation inter-tenant et limite de la RLS pour exprimer du RBAC. La policy `expense_notes_manager_select` ne raisonne que sur `manager_id` : elle montre qu'une règle d'autorisation (« manager et employé de la **même** entreprise ») mal adossée à la donnée laisse passer la fuite. Illustre « isolation structurelle plutôt que discipline » : ni la mutation ni la policy ne garantissent structurellement le tenant.
- **Recommandation.** Exiger `company_id` identique dans la mutation (le manager choisi doit appartenir à l'entreprise de la RH / de la cible) ; défense en profondeur : ajouter la condition `company_id` aux policies/lectures manager. Centraliser la règle « même entreprise » dans le domaine plutôt que de la réécrire par route.
- **Compromis (axes §1).** Sécurité/conformité : gain majeur. Effort : faible (une condition `AND company_id = …` dans la validation du manager, plus le durcissement RLS côté S4). Deadline : compatible gel 28/10. Comportement légitime (rattachement intra-entreprise) inchangé.

### Criticité × effort

**Criticité 5/5** (cross-tenant persistant : lecture + décision sur les notes d'une autre entreprise) · **Effort 1/5** (condition `company_id` dans la mutation ; durcissement RLS mutualisé avec S4).

---

## Synthèse

| ID | Faille | Emplacement principal | Reproduite | Criticité | Effort | Concept |
|---|---|---|---|---|---|---|
| S1 | Injection SQL via `?sort=` | `api/expense-notes/route.ts:46` | ✅ (200 sur expression SQL ; 500 `42703` sur entrée brute) | 5/5 | 1/5 | Zéro concaténation SQL / §7 |
| S2 | IDOR reçu manager | `api/manager/expense-notes/[id]/receipt-url/route.ts:17` | ✅ (reçu entreprise B exfiltré, 50 590 o) | 5/5 | 1/5 | Isolation inter-tenant, autorisation par route / §3 |
| S3 | Rattachement manager cross-tenant | `api/hr/users/[id]/manager/route.ts:39-42` | ✅ (manager A voit/décide une note B) | 5/5 | 1/5 | Isolation structurelle vs discipline, limite RLS / §3 |

**Séquençage proposé.** Les trois sont des corrections locales à faible effort et criticité maximale : à traiter en priorité, chacune dans son sujet dédié (pas « au passage »). S1 et S2 sont indépendantes ; S3 partage son durcissement RLS avec S4 (ticket 2-379). L'ensemble gagne à être posé sur la correction de S4 (rôle DB applicatif non-superuser + policies bornées par `company_id`), qui transforme ces contrôles applicatifs en défense en profondeur plutôt qu'en unique rempart.

## Annexe — Reproductibilité

Connexion via le flux Auth.js de l'application (cookie de session dans un fichier jar), puis requêtes authentifiées :

```bash
# Connexion (CSRF puis callback credentials) — un jar de cookies par compte
csrf=$(curl -s -c jar "http://localhost:3000/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
curl -s -o /dev/null -b jar -c jar -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$csrf" --data-urlencode "email=<email>" \
  --data-urlencode "password=<mdp>" --data-urlencode "callbackUrl=http://localhost:3000/expenses" \
  "http://localhost:3000/api/auth/callback/credentials"

# S1 (session emp@acme.test)
curl -s -b jar "http://localhost:3000/api/expense-notes?sort=length(description)"        # 200
curl -s -b jar "http://localhost:3000/api/expense-notes?sort=colonne_qui_nexiste_pas"    # 500 (42703, log serveur)

# S2 (session manager@expense.io)
curl -s -b jar "http://localhost:3000/api/manager/expense-notes"                          # contrôle négatif
curl -s -b jar "http://localhost:3000/api/manager/expense-notes/<noteB>/receipt-url"      # 200 + URL pré-signée
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "<url pré-signée renvoyée>"      # 200 application/pdf

# S3 (session hr@acme.test), puis restauration
curl -s -b jar -X PUT -H 'Content-Type: application/json' \
  --data '{"managerId":"<managerA>"}' "http://localhost:3000/api/hr/users/<empB>/manager" # 200 (cross-tenant)
curl -s -b jar -X PUT -H 'Content-Type: application/json' \
  --data '{"managerId":null}' "http://localhost:3000/api/hr/users/<empB>/manager"         # restauration
```

Identifiants de test (environnement local) : manager A `1f5448e3-2677-43d7-ad62-722237a535ea` · employé B `44b4b5d4-abe4-418b-bb1a-aeb130a9b2e3` · note B `2dff4778-b937-43f7-9368-3734f44409fb`.

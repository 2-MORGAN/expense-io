# WS1 — Audit Sécurité : S4 à S9

Audit du **11 octobre 2026**, commit `4fad1d3c4683082422d67ae72979a2c1f08e3ff1` (branche `docs/audit-ws1-s1-s3`).
Périmètre : les six failles du ticket **2-379** — RLS contournée (`S4`), secret d'auth codé en dur (`S5`), détails internes renvoyés sur erreur (`S6`), entreprise identifiée par domaine email (`S7`), clés de reçus prévisibles non cloisonnées (`S8`), rôle non réévalué sans reconnexion (`S9`). Aucune modification de `src/`, `migrations/` ni `scripts/` : documentation seule.

**Résultat :** S4, S6, S7, S8, S9 **confirmées par reproduction** ; S5 **confirmée par lecture du code** (la reproduction supposerait de forger un jeton de session — hors de l'audit non destructif, non réalisée).

## Méthode

- Environnement local : Next.js `http://localhost:3000`, PostgreSQL `5433`, LocalStack (S3) `4567`.
- Deux entreprises (comme demandé pour S4) : **A** = seed (`expense.io`), **B** = « acme » créée par le parcours d'inscription réel (`hr@acme.test` hr_admin, `emp@acme.test` employee, note « Taxi » reçu `receipts/3.pdf`). Comptes et données de test signalés, seed non modifié.
- Reproductions en requêtes HTTP authentifiées (flux Auth.js de l'application) et en requêtes SQL **lecture seule** avec le rôle applicatif, sauf S9 qui exige une écriture de test (promotion de rôle sur `emp@acme.test`), **restaurée** en fin de reproduction (état vérifié). Pas de `DROP`/`DELETE`/`TRUNCATE`, pas de forge de jeton, pas d'accès hors environnement local.

**Échelle criticité × effort** (alignée sur WS2) : criticité **n/5**, effort **n/5** (correction ciblée + test, comportement observable préservé).

---

## S4 — RLS contournée : l'application se connecte en superuser

### Emplacement

- [`docker-compose.yml`](../../docker-compose.yml) + [`.env.example:2`](../../.env.example#L2) : l'application se connecte avec le rôle d'initialisation PostgreSQL (`expense`), aucun rôle applicatif restreint n'est provisionné.
- [`migrations/1700000000001_init-schema.sql:39-40`](../../migrations/1700000000001_init-schema.sql#L39-L40) : RLS `ENABLE` + `FORCE` sur `expense_notes` uniquement. La table `users` n'a **aucune** RLS.
- [`migrations/1700000000001_init-schema.sql:70-100`](../../migrations/1700000000001_init-schema.sql#L70-L100) : les deux policies RH (`hr_root_manager_select/update`) ne contiennent **aucune** condition `company_id`.
- [`src/lib/db.ts:22-27`](../../src/lib/db.ts#L22-L27) : le commentaire affirme que « l'isolation entre entreprises est garantie par PostgreSQL (RLS) » — c'est faux dans la configuration déployée.

### Reproduction (deux entreprises)

Avec le rôle applicatif `expense` (celui de `DATABASE_URL`) :

1. **Attributs du rôle** — `rolsuper = t`, `rolbypassrls = t` : le rôle est superuser et contourne la RLS par construction.
2. **RLS bien active** — `expense_notes` : `relrowsecurity = t`, `relforcerowsecurity = t` ; `users` : `f`, `f` (aucune RLS).
3. **Isolation réelle** — en simulant le contexte applicatif (`SELECT set_config('app.current_user_id', <uuid aléatoire>, true)` comme le fait `withUserScope`), puis `SELECT` sur `expense_notes` joint aux entreprises :

   | entreprise | notes visibles |
   |---|---|
   | acme (B) | 1 |
   | expense (A) | 2 |

   Un utilisateur **qui ne possède rien** (uuid aléatoire) voit **toutes** les notes des **deux** entreprises. Si la RLS isolait réellement, les policies propriétaire/manager/RH renverraient 0 ligne. Elle est donc inopérante : l'isolation ne tient qu'aux `WHERE` manuels des routes.

### Impact

La RLS, présentée comme le rempart d'isolation, n'en est pas un : le rôle superuser la contourne entièrement. Toute l'isolation inter-tenant repose sur la discipline des `WHERE` applicatifs — dont on a déjà montré un oubli (S2, route reçu manager). De plus, les policies RH sans `company_id` et l'absence de RLS sur `users` signifient que **même après** passage à un rôle non-superuser, l'isolation resterait incomplète. Attention : sécuriser naïvement (rôle restreint) **casserait** des chemins actuels — `expense-notes` POST met à jour `receipt_key` hors scope et il n'existe pas de policy `UPDATE` propriétaire. Risque de fuite **ou** de régression.

### Concept du cours et compromis

- **Concept.** §3, « isolation structurelle plutôt que discipline » : une RLS effective rendrait la fuite inter-tenant *structurellement impossible* même si une route oublie son `WHERE`. Ici la structure existe sur le papier mais est désactivée par le rôle superuser → on retombe sur l'isolation par discipline, exactement le travers décrit. 12-Factor (§7) pour la config du rôle via l'environnement.
- **Recommandation.** Rôle applicatif dédié **non-superuser** et non-`BYPASSRLS` ; policies bornées par `company_id` (y compris RH) ; RLS sur `users` ; policy `UPDATE` propriétaire ; contexte de session cohérent sur toutes les routes (supprimer les `getPool()` directs sur données tenant). Valider par un test inter-entreprises.
- **Compromis (axes §1).** Sécurité/souveraineté (RGPD) : gain structurel majeur. Effort : élevé (migration policies + provisioning rôle + ajustement des routes `getPool` + tests), à cadrer en ADR. Maturité équipe : RLS demande de la rigueur opérationnelle ; le gain (défense en profondeur sous les `WHERE`) le justifie. Risque de régression à gérer par tests avant le gel du 28/10.

### Criticité × effort

**Criticité 5/5** (isolation structurelle absente, tout repose sur des `WHERE` faillibles) · **Effort 4/5** (migration + rôle + routes + tests inter-tenant).

---

## S5 — Secret d'authentification codé en dur

### Emplacement

- [`src/lib/auth.ts:8`](../../src/lib/auth.ts#L8) : constante `AUTH_SECRET` écrite en clair dans le source (valeur non recopiée ici).
- [`src/lib/auth.ts:11`](../../src/lib/auth.ts#L11) : `secret: AUTH_SECRET` passé à `NextAuth({...})` — la constante du code **prend le pas** sur la variable d'environnement `AUTH_SECRET` (que `.env.example:6` prévoit pourtant).

### Reproduction

Confirmée par **lecture du code** : le secret signant les JWT de session est une constante du dépôt, et elle est fournie explicitement à Auth.js, court-circuitant l'environnement. La démonstration active (forger un JWT valide pour usurper un compte) est hors du cadre d'audit non destructif et n'a pas été réalisée ; elle n'est pas nécessaire pour qualifier la faille.

### Impact

Quiconque a accès au source (toute l'équipe, l'historique git, un fork) connaît le secret de signature et peut forger un jeton de session valide pour **n'importe quel** utilisateur et **n'importe quel** rôle → usurpation complète, y compris `hr_admin`, sans mot de passe. Contrairement à un secret d'environnement, il ne peut pas être changé par déploiement sans modifier le code, et toutes les instances partagent la même valeur.

### Concept du cours et compromis

- **Concept.** 12-Factor App (§7) : la configuration et surtout les **secrets** vivent dans l'environnement, jamais dans le code ; séparation build/run. Règle non négociable `CLAUDE.md` n°4 (« secrets uniquement via variables d'environnement »).
- **Recommandation.** Lire le secret depuis `process.env.AUTH_SECRET` (laisser Auth.js le résoudre), le retirer du source, le **faire tourner** (rotation) et **invalider les sessions existantes** signées avec l'ancien, puisqu'il est désormais compromis par sa présence dans l'historique.
- **Compromis (axes §1).** Sécurité : gain majeur. Effort : faible pour le changement de code, modéré avec rotation + invalidation des sessions. Deadline : immédiat, sans dépendance. Note : la valeur présente dans l'historique git reste à considérer comme brûlée.

### Criticité × effort

**Criticité 5/5** (usurpation totale sans mot de passe) · **Effort 2/5** (passage en env simple ; rotation/invalidation à prévoir).

---

## S6 — Détails internes et stacktrace renvoyés au client

### Emplacement

- [`src/lib/errors.ts:3-5`](../../src/lib/errors.ts#L3-L5) : `respondError` renvoie `{ error: message, stack }` avec le message d'exception et la **stacktrace** dans le corps de la réponse 500.

### Reproduction

Sur une route qui atteint réellement `respondError` (contrairement à `GET /api/expense-notes`, cf. S1), connecté en tant que `manager@expense.io` :

`GET /api/manager/expense-notes/pas-un-uuid/receipt-url` → **HTTP 500**, corps JSON renvoyé **au client** :

```
clés: ["error", "stack"]
error: invalid input syntax for type uuid: "pas-un-uuid"
stack: error: invalid input syntax ... at /home/.../node_modules/pg-pool/index.js:45:11 ...
```

La réponse expose le message PostgreSQL et la pile avec des **chemins de fichiers absolus** et la mécanique interne (pilote `pg`).

### Impact

Fuite d'informations techniques (structure du code, chemins, détails SQL, versions) utile à un attaquant — notamment pour affiner l'injection S1. Divulgation d'informations contraire à la cible `application/problem+json` visée par `CLAUDE.md` (n°5).

### Concept du cours et compromis

- **Concept.** §5 (traçabilité : « plus de stacktrace unique », propager un identifiant de corrélation) et règle non négociable n°5 (ne jamais renvoyer message interne/stacktrace au client). Les détails vont dans les logs, pas dans la réponse.
- **Recommandation.** Réponse publique générique (`500`, format `problem+json`) + **identifiant de corrélation** renvoyé au client et journalisé côté serveur avec le détail. Ne jamais sérialiser `stack`.
- **Compromis (axes §1).** Sécurité : gain net. Effort : faible (un helper). Observabilité : améliorée (corrélation). Deadline : immédiat.

### Criticité × effort

**Criticité 3/5** (divulgation d'infos, facilite d'autres attaques) · **Effort 1/5** (helper d'erreur + corrélation).

---

## S7 — Entreprise identifiée par le domaine email

### Emplacement

- [`src/app/actions/auth.ts:41-63`](../../src/app/actions/auth.ts#L41-L63) : `domain = email.split('@')[1]`, `companyName = domain.split('.')[0]`, `INSERT ... ON CONFLICT (email_domain) DO NOTHING` ; le **premier** compte d'un domaine crée l'entreprise et devient `hr_admin`, les suivants du même domaine deviennent `employee` de cette entreprise.

### Reproduction

Confirmée via le **parcours d'inscription réel** utilisé pour créer l'entreprise B :
- `hr@acme.test` (1ʳᵉ inscription du domaine `acme.test`) → entreprise « acme » créée, rôle `hr_admin`.
- `emp@acme.test` (2ᵉ inscription, même domaine) → rattaché à la **même** entreprise « acme », rôle `employee`.

Les deux comptes partagent le même `company_id`, le premier administrant le second, sans aucune vérification d'appartenance réelle à une organisation.

### Impact

Le domaine email **n'identifie pas** une entreprise. Avec un domaine public (`gmail.com`, `outlook.com`, …), des personnes **sans lien** se retrouvent dans une même « entreprise » : le tout premier inscrit en `gmail.com` devient `hr_admin` de **tous** les comptes Gmail suivants, voit et décide leurs notes de frais. Inversement, une entreprise à plusieurs domaines est éclatée. C'est un défaut structurel du modèle de tenant, et une fuite inter-personnes directe sur domaines partagés.

### Concept du cours et compromis

- **Concept.** §3 (isolation et modèle multi-tenant) : l'appartenance à un tenant doit être une relation explicite et vérifiée, pas une déduction depuis une chaîne contrôlée par l'utilisateur. Le symptôme rejoint « faire confiance à une donnée client pour l'isolation ».
- **Recommandation.** Dissocier l'identité d'entreprise du domaine email : création d'entreprise explicite + invitations/rattachement validés (ou vérification de domaine pour les domaines d'entreprise prouvés). Interdire les domaines publics comme clé de tenant. Décision structurante → ADR.
- **Compromis (axes §1).** Sécurité/souveraineté : gain majeur. Effort : modéré (revoir signup + modèle de rattachement, migration de données). Maturité/time-to-market : le flux « premier inscrit = entreprise » est pratique pour une démo mais inacceptable en production ; arbitrer avec Florent. Build vs Buy : envisager une brique d'invitations plutôt que du maison.

### Criticité × effort

**Criticité 4/5** (collision inter-personnes sur domaines publics, RH illégitime) · **Effort 3/5** (refonte du rattachement + migration).

---

## S8 — Clés de reçus prévisibles et non cloisonnées par entreprise

### Emplacement

- [`src/lib/storage.ts:25-27`](../../src/lib/storage.ts#L25-L27) : `receiptKeyFor` renvoie `receipts/${receiptSeq}${extension}`, où `receiptSeq` est un **compteur `serial` global** ([`migrations/1700000000001_init-schema.sql:26`](../../migrations/1700000000001_init-schema.sql#L26)). Aucun préfixe par entreprise, aucune composante non devinable.

### Reproduction

Clés réellement stockées, toutes entreprises confondues :

| entreprise | receipt_key |
|---|---|
| expense (A) | `receipts/1.png` |
| expense (A) | `receipts/2.png` |
| acme (B) | `receipts/3.pdf` |

Le compteur est **partagé** entre les deux entreprises (A : 1, 2 ; B : 3) et strictement séquentiel : la clé du prochain reçu est `receipts/4.<ext>`, trivialement énumérable, sans aucune séparation par tenant.

### Impact

Les clés sont prévisibles et non cloisonnées. Couplé à l'absence de contrôle d'autorisation sur la route reçu manager (S2) et au contournement RLS (S4), cela facilite l'**énumération** des reçus de toutes les entreprises. Même un stockage par URL pré-signée ne protège pas si la clé est devinable et l'accès mal gardé.

### Concept du cours et compromis

- **Concept.** Règle non négociable n°6 (`CLAUDE.md`) : clés S3 non devinables et **préfixées par tenant**, accès uniquement par URL pré-signée **après** contrôle d'autorisation. Rejoint §3 (cloisonnement par tenant jusque dans le stockage).
- **Recommandation.** Clé non devinable incluant le `company_id` (ou un identifiant opaque) + un composant aléatoire, p. ex. `tenants/<company_id>/receipts/<uuid>.<ext>` ; migration des objets existants. Corriger conjointement l'autorisation (S2).
- **Compromis (axes §1).** Sécurité : gain net, surtout combiné à S2. Effort : faible pour les nouvelles clés, modéré avec migration des objets existants. Comportement : transparent pour l'utilisateur.

### Criticité × effort

**Criticité 3/5** (prévisibilité ; 4/5 en combinaison avec S2/S4) · **Effort 2/5** (nouveau schéma de clé + migration).

---

## S9 — Changement de rôle non pris en compte sans reconnexion

### Emplacement

- [`src/lib/auth.ts:45-51`](../../src/lib/auth.ts#L45-L51) : le callback `jwt` ne copie `role` dans le token **qu'à la connexion** (quand `user` est présent) ; aucune relecture en base ensuite.
- [`src/lib/auth.ts:52-58`](../../src/lib/auth.ts#L52-L58) : le callback `session` lit `role` **depuis le token**, jamais depuis la base. Les routes autorisent sur `session.user.role`, donc sur une valeur figée au login.

### Reproduction

Sur le compte de test `emp@acme.test` (promotion en base réversible, restaurée ensuite) :

| Étape | `role` session | `GET /api/manager/expense-notes` |
|---|---|---|
| 1. session initiale (employee) | `employee` | **401** |
| 2. après `UPDATE users SET role='manager'` en base (même session) | `employee` | **401** |
| 3. après **reconnexion** | `manager` | **200** |

Le changement de rôle en base n'a aucun effet sur la session existante ; seule la reconnexion le prend en compte. Rôle restauré à `employee` en fin de test.

### Impact

Asymétrie dangereuse surtout à la **rétrogradation / révocation** : retirer le rôle `manager` ou `hr_admin` d'un compte (départ, incident) **ne révoque pas** ses droits tant que sa session JWT reste valide — il conserve l'accès aux décisions et aux reçus jusqu'à expiration ou déconnexion. Une révocation de sécurité n'est donc pas effective immédiatement.

### Concept du cours et compromis

- **Concept.** Autorisation côté serveur à chaque route (règle n°2) mais sur une donnée fraîche : un rôle figé dans un JWT longue durée fragilise la révocation. Rejoint §3 (centraliser et fiabiliser les permissions) ; compromis classique JWT stateless vs révocation immédiate.
- **Recommandation.** Relire le rôle (et l'appartenance tenant) depuis la base au moment de l'autorisation, ou réduire fortement la durée du token + mécanisme d'invalidation de session (liste de révocation / version de session). Arbitrer stateless vs révocable.
- **Compromis (axes §1).** Sécurité : gain sur la révocation. Effort : modéré (relecture DB par requête, ou gestion d'invalidation). Scalabilité : relire le rôle à chaque requête a un coût ; un token court + cache est un compromis. Maturité : décision structurante possible → ADR.

### Criticité × effort

**Criticité 3/5** (révocation non immédiate des privilèges) · **Effort 2/5** (relecture DB ou invalidation de session).

---

## Synthèse

| ID | Faille | Emplacement principal | Reproduite | Criticité | Effort | Concept |
|---|---|---|---|---|---|---|
| S4 | RLS contournée (rôle superuser, policies RH sans `company_id`, `users` sans RLS) | `migrations/…:39-100` + `.env.example:2` | ✅ (deux entreprises visibles avec contexte aléatoire) | 5/5 | 4/5 | Isolation structurelle vs discipline / §3, 12-Factor |
| S5 | Secret d'auth codé en dur, prioritaire sur l'env | `src/lib/auth.ts:8,11` | ⚠️ lecture de code (forge de jeton non réalisée) | 5/5 | 2/5 | 12-Factor, secrets en env / §7 |
| S6 | Message interne + stacktrace au client | `src/lib/errors.ts:3-5` | ✅ (500 avec `stack` + chemins) | 3/5 | 1/5 | Traçabilité / §5 |
| S7 | Entreprise déduite du domaine email | `src/app/actions/auth.ts:41-63` | ✅ (acme : hr_admin + employee, même tenant) | 4/5 | 3/5 | Modèle multi-tenant / §3 |
| S8 | Clés reçus séquentielles, non préfixées tenant | `src/lib/storage.ts:25-27` | ✅ (séquence 1,2,3 partagée A/B) | 3/5 | 2/5 | Cloisonnement tenant du stockage / §3, règle n°6 |
| S9 | Rôle figé dans le JWT, non réévalué | `src/lib/auth.ts:45-58` | ✅ (promotion ignorée sans reconnexion) | 3/5 | 2/5 | Révocation / autorisation fraîche / §3 |

**Séquençage proposé.** S5 et S6 sont des quick wins (effort 1-2/5) à forte valeur, indépendants : à traiter en premier. S4 est le chantier central d'isolation : il conditionne la défense en profondeur de S1-S3 (ticket 2-378) et doit être cadré par une ADR (rôle applicatif, policies, tests inter-tenant), en veillant aux régressions (UPDATE hors scope de `expense-notes` POST). S7 (modèle de tenant) et S9 (révocation) sont structurants → ADR également. S8 se corrige avec S2 (autorisation + clé cloisonnée). Chaque correction dans son sujet dédié, pas « au passage », et à comportement observable préservé.

## Annexe — Reproductibilité

```bash
# S4 — avec le rôle applicatif (DATABASE_URL), lecture seule
docker exec arla-postgres-1 psql -U expense -d expense_io -c \
 "select rolsuper, rolbypassrls from pg_roles where rolname=current_user"          # t | t
docker exec arla-postgres-1 psql -U expense -d expense_io -c \
 "select relname, relrowsecurity, relforcerowsecurity from pg_class
    where relname in ('expense_notes','users')"                                     # users: f|f
docker exec arla-postgres-1 psql -U expense -d expense_io -c \
 "BEGIN; SELECT set_config('app.current_user_id', gen_random_uuid()::text, true);
  SELECT c.name, count(*) FROM expense_notes en JOIN users u ON u.id=en.user_id
    JOIN companies c ON c.id=u.company_id GROUP BY c.name; ROLLBACK;"               # 2 entreprises

# S6 — route atteignant respondError (session manager)
curl -s -b jar "http://localhost:3000/api/manager/expense-notes/pas-un-uuid/receipt-url"  # 500 {error, stack}

# S8 — clés réellement stockées
docker exec arla-postgres-1 psql -U expense -d expense_io -c \
 "select c.name, en.receipt_key from expense_notes en
    join users u on u.id=en.user_id join companies c on c.id=u.company_id order by en.receipt_key"

# S9 — session manager (emp@acme.test), promotion réversible
curl -s -b jar "http://localhost:3000/api/auth/session"                            # role: employee
docker exec arla-postgres-1 psql -U expense -d expense_io -c \
 "UPDATE users SET role='manager' WHERE email='emp@acme.test'"                      # promotion test
curl -s -b jar "http://localhost:3000/api/auth/session"                            # role: employee (figé)
# reconnexion -> role: manager ; puis restauration :
docker exec arla-postgres-1 psql -U expense -d expense_io -c \
 "UPDATE users SET role='employee' WHERE email='emp@acme.test'"                     # restauration
```

Comptes de test (environnement local) : entreprise B « acme » — `hr@acme.test` / `emp@acme.test` (mot de passe `acme1234`). Entreprise A = seed. S5 : secret situé à `src/lib/auth.ts:8` (valeur non reproduite ici).

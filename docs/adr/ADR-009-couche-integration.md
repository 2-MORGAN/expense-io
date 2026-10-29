# ADR-009 — Couche d'intégration : Vitest contre PostgreSQL, S3 et SMTP, et tests de composants

| | |
|---|---|
| Statut | **Acceptée** le 29 octobre 2026 par le PO (Florent) |
| Date | 29 octobre 2026 |
| Auteur | Stanislas Beguin (WS5) |
| Validateur | Florent (PO) |
| Tickets | audit des tests du 29/10 (testing trophy) ; amende l'[ADR-005](ADR-005-harnais-de-validation.md) §1 |

## Contexte

Audit des tests du 29/10, sur `main` @ `61e5a4e`, selon le testing trophy (statique, unitaire, intégration, système) : 418 tests unitaires, 69 d'intégration, 149 système (89 par l'API, 60 par l'interface). La forme est un sablier : la couche d'intégration, celle qui donne le plus de confiance pour son coût, est la plus mince.

- Tout ce qui touche PostgreSQL (13 adaptateurs, policies RLS, outbox) n'est vérifié que par des tests qui exigent la pile complète : Docker, `next dev` et le worker, environ 4 min en CI. Le pre-push n'en voit rien, et le statique ne voit pas le SQL, écrit à la main sans ORM (ADR-002).
- 10 des 13 adaptateurs PostgreSQL ne sont exercés qu'au travers de l'API. En unitaire, la couverture des branches est de 19 % sur `src/worker`, 20 % sur `src/adapters` et 35 % sur `src/components`.
- Le WHERE des listes répète la règle « qui voit quoi » du domaine, que les policies RLS répètent à leur tour (`CLAUDE.md`, « Dette connue »). Aucun test ne confronte ces copies : une mutation injectée le 29/10 dans le WHERE de la liste RH passe inaperçue sous la RLS.
- `docs/tests/E2E.md` déclare non testables en E2E la compensation S3 de la soumission (B9), les droits de `expense_worker` pour le code du worker, et les messages de l'interface en cas de panne serveur.
- L'ADR-005 §1 a placé les tests au niveau base dans Playwright, sans navigateur, et écarté « Vitest avec une base » : un second outillage de base et un job de CI de plus, pour quelques tests. Ils sont 45 aujourd'hui, et même les tests RLS créent leurs notes par l'API, donc exigent le serveur.

## Options

| Option | Pour | Contre |
|---|---|---|
| A — Statu quo : intégration dans Playwright seulement | Un seul outillage avec infrastructure | Retour lent, pile complète requise, aucune couche de composants, adaptateurs testés seulement par le HTTP |
| B — Vitest contre l'infrastructure de `docker-compose.yml`, plus des tests de composants dans jsdom | Quelques secondes ; adaptateurs, routes appelées dans le processus et cas d'usage testés sous la RLS ; états d'erreur de l'interface testables | 4 dépendances de dev (Testing Library ×3, jsdom) ; un job de CI ; deux jeux de fixtures (`e2e/support`, `integration/support`) |
| C — Testcontainers, une base par exécution | Isolation totale | Dépendance de plus, démarrage d'un conteneur à chaque exécution, plus lent sur nos postes Windows, diverge de `docker-compose.yml` qui fait foi |

## Décision

Option B.

1. **Deux configurations Vitest.**
   - `vitest.config.mts` contient les projets `unit` (règles pures, `*.test.ts`) et `components` (composants React rendus dans jsdom avec Testing Library, réseau simulé, `*.test.tsx`). Ils tournent sans Docker dans `npm run check`, donc au pre-push et dans le job `check`.
   - `vitest.integration.config.mts` lance les `*.integration.test.ts` contre le PostgreSQL, le LocalStack et le Mailpit de `docker-compose.yml` : `npm run test:integration`, `make test-integration`, job `integration` de la CI.
2. **Les rôles de la production.** Le code testé se connecte sous `expense_app`, RLS active, et le worker sous `expense_worker`. Les données sont créées sous le propriétaire, une entreprise par test (domaine `*.integration.test`), purgées au démarrage suivant. Un test vérifie que la connexion n'est ni superutilisateur ni `BYPASSRLS`.
3. **Placement.**
   - À côté du code, en `*.integration.test.ts` : le test d'un adaptateur, d'un cas d'usage avec ses vrais adaptateurs, d'un handler du worker.
   - Dans `integration/` : les tests transverses, comme les routes appelées dans le processus avec une session simulée (seul `auth()` est remplacé) ou la matrice domaine ⟺ requêtes.
   - En `*.test.tsx` à côté : le test d'un composant.
4. **La matrice « qui voit quoi » tourne deux fois.** Une fois sous la RLS, une fois RLS contournée, pour que le domaine soit confronté au WHERE seul.
5. **Le job `e2e`, check obligatoire, attend le job `integration`** et échoue s'il échoue. Le ruleset ne change pas.
6. **Playwright reste la référence de non-régression** (ADR-005 §1 et §2). Les tests E2E existants ne changent pas. Un nouveau test au niveau base s'écrit désormais en Vitest ; un nouveau parcours utilisateur, en Playwright.
7. **Hors périmètre** : tests visuels, mutation testing automatisé, seuil de couverture bloquant.

## Conséquences

**Positives**

- La couche d'intégration passe de 69 à environ 450 tests ; la partie Vitest tourne en une douzaine de secondes en local.
- Chaque adaptateur PostgreSQL, S3 et SMTP a ses tests, sous la RLS.
- La compensation S3 (B9), les droits de `expense_worker` et les états d'erreur de l'interface deviennent testés.
- Le test du moteur OCR réel, instable sous charge, quitte le pre-push et reste en CI.
- Une régression du WHERE masquée par la RLS est détectée.

**Négatives et risques**

- 4 dépendances de dev : `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event`, `jsdom`.
- Un job de CI d'environ 2 min, gratuit sur un dépôt public.
- `e2e/support` et `integration/support` se calquent tous deux sur le schéma : une migration qui change `users` ou `companies` les touche ensemble.
- Un worker lancé par `make dev` sur la même base peut consommer les événements écrits par les tests. Les tests ne supposent donc jamais qu'un événement réel reste « pending », et ceux du worker utilisent des types d'événement uniques.
- La matrice sans RLS exige un propriétaire superutilisateur, ce qui est le cas avec `docker-compose.yml`. Elle le vérifie en tête et échoue sinon.

## Comportement observable

Aucun changement : seuls des tests, leur configuration et la CI changent.

## Vérification

- `npm run test:integration` vert en local et dans le job `integration`. `integration/connection.integration.test.ts` échoue si le code testé ne tourne pas sous `expense_app`.
- `eslint.config.test.ts` : `.only` et `.skip` refusés dans `integration/`, les `*.integration.test.ts` et les `*.test.tsx`.
- Le 29/10, six régressions injectées une à une ont toutes fait échouer au moins un test d'intégration :
  - WHERE de la liste manager sans « en attente » ;
  - WHERE de la liste RH sans « manager racine », que la RLS masquait ;
  - soumission sans événement d'outbox ;
  - manager autorisé à trancher sa propre note ;
  - accès « company » au reçu sans contrôle d'entreprise ;
  - garde d'une route RH relâchée.

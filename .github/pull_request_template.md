<!--
Titre : il devient le message du commit de squash. Format conventionnel, comme
l'historique (fix(api): …, test(e2e): …, docs(adr): …), suivi du ticket Linear (2-xxx).
Les commentaires comme celui-ci ne s'affichent pas dans la PR : inutile de les effacer.
-->

## Quoi

<!-- Ce que change la PR, en quelques lignes. Ticket Linear, constats d'audit (S1, A1, Q1, B1…), ADR. -->

## Pourquoi

<!-- Le problème résolu ou la décision appliquée : renvoyer à l'ADR ou au constat plutôt que les recopier. -->

## Vérifications lancées

<!--
Pour chaque ligne : ce qui a été lancé et le résultat, ou « non lancé » et pourquoi.
E2E obligatoires dès que la PR touche src/app, src/lib, migrations/ ou scripts/ (CLAUDE.md, « Harnais de validation »).
-->

- `npm run check` :
- E2E (`npx playwright test -g "<ID>"`, `make test-e2e`) :
- Test ajouté (bug corrigé ou règle métier : vu rouge avant, vert après) :

## Changement de comportement

<!--
« Aucun » si les tests E2E existants passent sans modification.
Sinon (ADR-005 §2) : ADR acceptée qui le décide, tests modifiés dans un commit séparé,
approbation d'un responsable des tests. Une ligne par test E2E touché :

| Test E2E | Avant | Après | ADR |
|---|---|---|---|
| ACL-01, routes RH sans session | 403 | 401 | ADR-004 §4 |
-->

Aucun.

## Nouvelle dépendance

<!-- « Aucune », ou le paquet, pourquoi lui plutôt qu'une alternative (ADR, PR) et sa version. -->

Aucune.

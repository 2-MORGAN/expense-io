---
name: nouvelle-fonctionnalite
description: Recette pour implémenter une fonctionnalité nouvelle ou faire évoluer une fonctionnalité d'Expense.io (règle métier, opération d'API, écran, migration, traitement asynchrone), de la demande jusqu'à la PR, avec ses tests et sa doc. À utiliser dès qu'on demande d'ajouter ou de changer un comportement, même formulé simplement (« ajoute un bouton pour… », « les managers devraient pouvoir… »).
---

# Nouvelle fonctionnalité

Recette pas à pas, pour un agent comme pour un humain. Elle s'appuie sur le [CLAUDE.md](../../../CLAUDE.md) de la racine et sur l'`AGENTS.md` de chaque dossier touché : le lire au moment d'écrire dans ce dossier. Chemins donnés depuis la racine du dépôt.

## 0. Partir propre

- `git fetch`, puis une branche depuis `origin/main` nommée avec le ticket (`feat/2-xxx-sujet`) ; `npm install` si `package.json` a changé.
- Base, API ou interface touchées : lancer la stack avec `make dev` (sans `make` : section « Démarrer » de `docs/index.html`).

## 1. Cadrer, puis faire valider le plan

Avant tout code, écrire un plan court et le montrer :

- **Le besoin** en une phrase, avec le rôle concerné (`employee`, `manager`, `hr_admin`).
- **Les couches touchées**, dans l'ordre de cette recette.
- **Ce qui change pour l'utilisateur** : opération HTTP, écran, email. Si un comportement existant change (statut HTTP, champ JSON, texte affiché), s'arrêter : il faut une ADR acceptée (ADR-005 §2).
- **La sécurité** : qui a le droit, borné à quelle entreprise, quelle réponse en cas de refus (401, 403, 404).
- **Les tests** : unitaires (règle, cas d'usage) et E2E (IDs nouveaux).
- **Une décision d'architecture** (couche ou droit nouveau dans `scripts/architecture/layers.ts`, dépendance npm, nouveau service) : la proposer avec ses options. Elle appelle une ADR (`docs/adr`) ou une justification dans la PR.

Demander une validation si la demande est ambiguë, ou si le plan touche à la sécurité, au schéma ou à un comportement existant. Ne pas « corriger au passage » une dette sans rapport.

## 2. Contrat d'API

Si une opération HTTP change : `openapi.yaml` d'abord (lire `docs/api/README.md`), puis `npm run generate:api`. Code d'erreur nouveau : `src/http/AGENTS.md`.

## 3. Domaine

La règle pure et son test, vu rouge puis vert : `src/domain/AGENTS.md`. `npx vitest src/domain` relance les tests à chaque modification.

## 4. Migration

Si le schéma change : `migrations/AGENTS.md` (fichier nouveau, RLS, droits, `down`), puis `npm run migrate:up`, `npm run migrate:down`, `npm run migrate:up`.

## 5. Port et adaptateur

Si la base ou une dépendance externe est touchée : `src/ports/AGENTS.md`, puis `src/adapters/AGENTS.md`.

## 6. Cas d'usage et branchement

`src/application/AGENTS.md` (test avec de faux ports), puis `src/composition/AGENTS.md`.

## 7. Entrée

- Opération d'API : `src/app/api/AGENTS.md`, avec les briques de `src/http/AGENTS.md`.
- Page ou server action : `src/app/AGENTS.md` ; composant : `src/components/AGENTS.md`.
- Traitement asynchrone : `src/worker/AGENTS.md`.

## 8. E2E

Un scénario par comportement observable nouveau, avec un ID nouveau inscrit dans `docs/tests/E2E.md` : `e2e/AGENTS.md`. Lancer `npx playwright test -g "<ID>"`. Ne modifier aucun test existant.

## 9. Documentation

Le tableau « Documentation développeur » du CLAUDE.md dit quoi mettre à jour : sections de `docs/index.html`, vues de `docs/architecture/vues` (`docs/AGENTS.md`). `npm run generate:architecture` si une route, une couche ou un import entre couches change. Les `AGENTS.md` des dossiers touchés aussi, si une consigne n'est plus vraie.

## 10. Vérifier

- `npm run check` : lint, types, tests unitaires, contrat, architecture, doc et consignes.
- Les E2E concernés ; toute la suite (`make test-e2e`) si `src/lib`, `migrations/` ou plusieurs parcours sont touchés.
- Relire son diff : ni `any`, ni `console.log`, ni `eslint-disable` sans justification, ni fichier hors sujet, ni refacto opportuniste.

## 11. PR

`gh pr create --repo 2-MORGAN/expense-io --base main`, avec le modèle `.github/pull_request_template.md` rempli : vérifications lancées et non lancées (avec la raison), doc, changement de comportement, dépendance.

## Définition de terminé

- [ ] La règle métier est dans `src/domain` et testée.
- [ ] Chaque méthode de route nouvelle ouvre sur sa garde (`requireRole`), valide son entrée par le contrat, ne fait ni SQL ni règle métier.
- [ ] Toute donnée d'une entreprise passe par `withUserScope()` et la RLS ; aucun id venu du client n'est cru sans contrôle de périmètre.
- [ ] Les erreurs sont en `application/problem+json`, avec un `code` du contrat traduit en français dans l'interface.
- [ ] Les tests unitaires et E2E nouveaux sont verts ; aucun test existant n'a été modifié.
- [ ] `docs/index.html`, ses vues, `docs/tests/E2E.md` et les `AGENTS.md` touchés sont à jour.
- [ ] `npm run check` est vert ; les E2E ont été lancés, ou leur absence est dite dans la PR.

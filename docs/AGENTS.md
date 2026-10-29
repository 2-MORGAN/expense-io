# docs — documentation des développeurs

Consignes du dossier, en complément de l'[AGENTS.md](../AGENTS.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

`docs/index.html` est la doc d'accueil, à ouvrir dans un navigateur. Ses schémas sont des fichiers Mermaid versionnés : `docs/architecture/layers.mmd` et `docs/architecture/routes.mmd`, générés depuis le code, et les vues écrites à la main de `docs/architecture/vues`. Autour : les ADR (`docs/adr`), le registre des E2E (`docs/tests/E2E.md`), l'audit (`docs/audit`), l'API (`docs/api/README.md`), l'OCR (`docs/ocr.md`), les documents de conception (`docs/designs`), qui ne décident rien tant qu'une ADR ne les reprend pas.

## La doc fait partie du changement

La page et ses vues se mettent à jour dans la même PR que le code. Quoi mettre à jour selon le changement : tableau « Documentation développeur » de l'[AGENTS.md](../AGENTS.md) de la racine.

## Modifier un schéma

- Une vue se modifie dans son `.mmd` sous `docs/architecture/vues`, jamais entre ses marqueurs dans la page : `npm run generate:architecture` l'écraserait.
- `layers.mmd` et `routes.mmd` ne se modifient jamais à la main : `npm run generate:architecture`.
- Nouvelle vue : `docs/architecture/vues/<nom>.mmd` avec l'en-tête de commentaire des autres, une figure et ses marqueurs dans la page, puis `npm run generate:architecture`.
- Le texte de la page se modifie directement, en HTML. Un script externe porte `integrity` et `crossorigin`.

## Ajouter une ADR

1. Copier `docs/adr/ADR-000-modele.md` en `docs/adr/ADR-<NNN>-<titre-court>.md`, au numéro suivant.
2. L'ajouter au tableau de `docs/adr/README.md` au statut « Proposée » : seules les « Acceptée » font foi.
3. Sa fiche `id="adr-NNN"` dans la section « Les ADR » de la page, et `docs/architecture/vues/adr.mmd` (vérifié par `npm run check`).

## Pièges

- Une doc fausse est pire qu'une doc absente : ce qui n'est plus vrai se corrige ou se retire.
- Interface et docs en français ; code et API en anglais.
- `npm run check` vérifie les schémas, les fiches d'ADR, les tables, les types d'événements, les scripts externes et le registre des E2E (un ID de test = une ligne de `docs/tests/E2E.md`) ; le reste du texte, non : le relire.

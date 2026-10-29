Les consignes pour les agents IA de ce dépôt sont dans [`CLAUDE.md`](CLAUDE.md) : le lire en entier avant toute modification.

Chaque dossier de code a aussi son `AGENTS.md` (`src/modules/AGENTS.md`, `src/app/api/AGENTS.md`, `migrations/AGENTS.md`…) : ce que le dossier contient, ce qu'il peut importer, la recette, les fichiers modèles, les pièges. Le lire avant d'écrire dans ce dossier ; la liste est dans `CLAUDE.md`, « Consignes par dossier et recette d'une fonctionnalité ».

Pour une fonctionnalité nouvelle ou qui évolue, suivre pas à pas la recette [`.claude/skills/nouvelle-fonctionnalite/SKILL.md`](.claude/skills/nouvelle-fonctionnalite/SKILL.md) (c'est aussi la skill `/nouvelle-fonctionnalite` de Claude Code) : plan validé d'abord, puis contrat, domaine, migration, port et adaptateur, cas d'usage, entrée, E2E, doc, vérifications et PR.

Toute modification du code met aussi à jour la doc des développeurs, [`docs/index.html`](docs/index.html), et ses schémas Mermaid de [`docs/architecture/`](docs/architecture/README.md), dans la même PR. Ce qu'il faut mettre à jour selon le changement : « Documentation développeur » dans `CLAUDE.md`. `npm run generate:architecture` recopie les schémas dans la page ; `npm run check` échoue si elle a dérivé.

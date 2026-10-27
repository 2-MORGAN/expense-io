Les consignes pour les agents IA de ce dépôt sont dans [`CLAUDE.md`](CLAUDE.md) : le lire en entier avant toute modification.

Toute modification du code met aussi à jour la doc des développeurs, [`docs/index.html`](docs/index.html), et ses schémas Mermaid de [`docs/architecture/`](docs/architecture/README.md), dans la même PR. Ce qu'il faut mettre à jour selon le changement : « Documentation développeur » dans `CLAUDE.md`. `npm run generate:architecture` recopie les schémas dans la page ; `npm run check` échoue si elle a dérivé.

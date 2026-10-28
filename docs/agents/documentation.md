# Mettre à jour la doc des développeurs

Détail de la section « Documentation développeur » de [`CLAUDE.md`](../../CLAUDE.md). À lire **à la fin** d'un changement de code, pour savoir quoi mettre à jour.

[`docs/index.html`](../index.html) est la doc d'accueil des développeurs : services et processus, architecture du code, parcours clés, données, API, choix d'architecture et ADR, en schémas. Elle s'ouvre dans un navigateur. Ses schémas sont des fichiers Mermaid versionnés dans `docs/architecture/` : `layers.mmd` et `routes.mmd`, générés depuis le code, et les vues écrites à la main de `docs/architecture/vues/`. `npm run generate:architecture` les recopie dans la page, entre leurs marqueurs `<!-- début : … -->` et `<!-- fin : … -->`, et régénère [`CODEMAP.md`](../../CODEMAP.md).

**La doc fait partie du changement.** Tout agent (et tout humain) qui modifie le code met à jour la page et ses vues **dans la même PR**, sans attendre qu'on le demande :

| Si le changement… | Mettre à jour |
|---|---|
| change un import entre couches, une couche, une route ou sa garde | `npm run generate:architecture` (graphes et `CODEMAP.md`), relire le diff ; le texte de la section si le sens change |
| ajoute ou retire un service, un processus, un port, un adaptateur, un script, une variable d'environnement | `vues/systeme.mmd`, `vues/hexagone.mmd` ; sections « Démarrer », « Vue d'ensemble », « Ports et adaptateurs » |
| modifie un parcours : soumission, décision, outbox, OCR, inscription, invitation, session | la vue de séquence correspondante et le texte de « Parcours clés » |
| ajoute une migration : table, colonne, policy, rôle, fonction `SECURITY DEFINER` | `vues/schema.mmd` et « Données et isolation » |
| ajoute un type d'événement de l'outbox | le tableau des événements et `vues/outbox.mmd` |
| change une opération HTTP ou un code d'erreur | « API et contrat », après `openapi.yaml` |
| ajoute une ADR ou change son statut | sa fiche (`id="adr-NNN"`) dans « Les ADR », `vues/adr.mmd`, et « Choix d'architecture » si un choix change |
| change une commande, un script npm, un hook ou la CI | « Démarrer », « Harnais de validation », `vues/harnais.mmd` |
| solde ou crée une dette | « Dette connue » et la fiche de l'ADR concernée |

- Une vue se modifie dans son `.mmd`, jamais entre ses marqueurs dans la page : la recopie l'écraserait. Le texte de la page se modifie directement. Nouvelle vue : créer `docs/architecture/vues/nom.mmd`, placer ses marqueurs dans une figure de la page, puis `npm run generate:architecture`.
- `npm run check` échoue si la page a dérivé de ses schémas, si un schéma n'y a pas sa place ou un marqueur plus de schéma, si une ADR de `docs/adr/` n'a pas sa fiche, si `vues/schema.mmd` n'a pas exactement les tables des migrations, si un type d'événement de l'outbox n'est pas cité, si un script externe est chargé sans empreinte SRI (`integrity`, `crossorigin`), ou si `CODEMAP.md` a dérivé du code. Le reste du texte ne se vérifie pas : le tableau ci-dessus fait foi.
- Rien dans le tableau ne change (correctif local, test, refacto sans effet visible) : le dire dans la rubrique « Documentation » de la PR. Ce qui n'est plus vrai se corrige ou se retire : une doc fausse est pire qu'une doc absente.

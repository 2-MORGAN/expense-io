# ADR-NNN — Titre court de la décision

<!--
Modèle d'ADR (ADR-005 §4). Copier ce fichier en `ADR-NNN-titre-court.md`, avec le
numéro suivant de l'index (README.md de ce dossier), l'ajouter à l'index au statut
« Proposée », puis le faire accepter par le PO dans une PR. Remplir chaque rubrique
et effacer ces commentaires. Une ADR courte se relit : renvoyer aux constats, aux
autres ADR et au code plutôt que les recopier.
-->

| | |
|---|---|
| Statut | **Proposée** · Acceptée le JJ/MM/AAAA par … · Rejetée · Remplacée par [ADR-NNN](ADR-NNN-titre.md) |
| Date | JJ mois AAAA |
| Auteur | Prénom Nom (WSn) |
| Validateur | Florent (PO) |
| Tickets | [2-xxx](https://linear.app/2-morgan/issue/2-xxx) |

## Contexte

<!--
Le problème, ses contraintes et ce qui oblige à décider maintenant. Citer les
constats par leur ID (S1, A1, Q1, B1…) avec un lien vers docs/audit/, sans les redire.
-->

## Options

<!--
Au moins deux, avec leurs compromis : sécurité, coût, effort, compatibilité, risque
pour les tests E2E des correcteurs (ADR-005 §2, « élargir plutôt que casser »).
-->

| Option | Pour | Contre |
|---|---|---|
| A — … | | |
| B — … | | |

## Décision

<!--
Des phrases vérifiables : « une note d'une autre entreprise renvoie 404 », pas
« on améliore la sécurité ». Dire ce qui reste hors périmètre.
-->

## Conséquences

<!-- Positives, négatives et risques ; la dette créée ou soldée ; les tickets à créer. -->

## Comportement observable

<!--
« Aucun changement » si les tests E2E existants passent sans modification. Sinon, une
ligne par route ou écran touché, avec les IDs des tests (docs/tests/E2E.md). Une fois
l'ADR acceptée, c'est cette rubrique qui autorise à modifier ces tests, dans un commit
séparé (ADR-005 §2). Exemple :

| Route ou écran | Avant | Après | Tests E2E |
|---|---|---|---|
| Routes RH, appel sans session | 403 | 401 | ACL-01 |
-->

Aucun changement.

## Vérification

<!--
Comment on saura que la décision est appliquée : test Vitest ou E2E (avec son ID),
règle de lint, job de CI.
-->

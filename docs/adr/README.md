# Décisions d'architecture (ADR)

Seules les ADR au statut **Acceptée** font foi (règle de l'ADR-005, §2). Un test E2E ne se modifie que si une ADR acceptée décide le changement de comportement.

| ADR | Titre | Statut | Auteur | Date |
|---|---|---|---|---|
| [ADR-001](ADR-001-isolation-multi-tenant.md) | Stratégie d'isolation multi-tenant | Acceptée | Amalraj Soupramanien | 20/10/2026 |
| [ADR-002](ADR-002-architecture-cible.md) | Architecture cible (monolithe modulaire hexagonal) | Acceptée (amendée le 20/10, relecture d'Antoine dans la PR #9) | Antoine Blumenroeder | 20/10/2026 |
| [ADR-003](ADR-003-ocr-soumission-notifications.md) | OCR / IA, fiabilité de la soumission et notifications | Acceptée (choix d'API alignés sur l'ADR-004, OCR asynchrone planifié) | Jacques Dai | 20/10/2026 |
| [ADR-004](ADR-004-contrat-api.md) | Contrat d'API, format d'erreur et versioning | Acceptée (pas de pagination, API en anglais, types générés) | Amiel Fabreguettes | 20/10/2026 |
| [ADR-005](ADR-005-harnais-de-validation.md) | Harnais de validation : tests, CI et garde-fous | Acceptée (points ouverts listés) | Stanislas Beguin | 20/10/2026 |

Décisions transverses du PO (20/10/2026) :

- **401** sans session, **403** si le rôle est refusé (PR #8). Repris dans l'ADR-004 §4.
- **OCR asynchrone** : tâche à faire (2-503), sans attendre un déclencheur de l'ADR-003.
- **Pas de pagination** des listes ; **API en anglais** avec codes stables, traduite par le front (ADR-004).
- **S7** : la règle « le premier inscrit d'un domaine devient RH » est une **faille corrigée** : rejoindre une entreprise passe par une invitation de la RH, avec vérification d'email (ADR-001, §3 ; ticket 2-496).
- **B16** : chaque note garde qui l'a tranchée et quand (ADR-002, 2-488).
- Ordre de la refacto : correctifs de sécurité d'abord, puis helpers communs de l'ADR-002.

Constats d'audit référencés par les ADR : [`docs/audit/`](../audit/).

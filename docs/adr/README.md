# Décisions d'architecture (ADR)

Seules les ADR au statut **Acceptée** font foi (règle de l'ADR-005, §2). Un test E2E ne se modifie que si une ADR acceptée décide le changement de comportement.

| ADR | Titre | Statut | Auteur | Date |
|---|---|---|---|---|
| [ADR-001](ADR-001-isolation-multi-tenant.md) | Stratégie d'isolation multi-tenant | Acceptée | Amalraj Soupramanien | 20/10/2026 |
| ADR-002 | Architecture cible (monolithe modulaire hexagonal) | En cours d'amendement (ticket 2-470) | Antoine Blumenroeder | — |
| [ADR-003](ADR-003-ocr-soumission-notifications.md) | OCR / IA, fiabilité de la soumission et notifications | Acceptée (choix d'API sous réserve de l'ADR-004) | Jacques Dai | 20/10/2026 |
| ADR-004 | Contrat d'API, format d'erreur et versioning | À rédiger (ticket 2-391) | Amiel Fabreguettes | — |
| [ADR-005](ADR-005-harnais-de-validation.md) | Harnais de validation : tests, CI et garde-fous | Acceptée (points ouverts listés) | Stanislas Beguin | 20/10/2026 |

Décisions transverses du PO (20/10/2026) :

- **401** sans session, **403** si le rôle est refusé (PR #8). À reprendre dans l'ADR-004.
- **S7** : la règle « le premier inscrit d'un domaine devient RH » est une **spécification**, conservée (ADR-001, §3).
- Ordre de la refacto : correctifs de sécurité d'abord, puis helpers communs de l'ADR-002.

Constats d'audit référencés par les ADR : [`docs/audit/`](../audit/).

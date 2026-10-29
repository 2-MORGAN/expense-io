# Décisions d'architecture (ADR)

Seules les ADR au statut **Acceptée** font foi (règle de l'ADR-005, §2). Un test E2E ne se modifie que si une ADR acceptée décide le changement de comportement.

Nouvelle décision : copier le [modèle](ADR-000-modele.md) en `ADR-NNN-titre-court.md`, l'ajouter à ce tableau au statut « Proposée », puis la faire accepter par le PO dans une PR.

| ADR | Titre | Statut | Auteur | Date |
|---|---|---|---|---|
| [ADR-001](ADR-001-isolation-multi-tenant.md) | Stratégie d'isolation multi-tenant | Acceptée (précisée le 23/10 : worker et bascule 2-481) | Amalraj Soupramanien | 20/10/2026 |
| [ADR-002](ADR-002-architecture-cible.md) | Architecture cible (monolithe modulaire hexagonal) | Acceptée (amendée le 20/10, relecture d'Antoine dans la PR #9) | Antoine Blumenroeder | 20/10/2026 |
| [ADR-003](ADR-003-ocr-soumission-notifications.md) | OCR / IA, fiabilité de la soumission et notifications | Acceptée (choix d'API alignés sur l'ADR-004, OCR asynchrone planifié ; amendée le 23/10 : socle asynchrone unique) | Jacques Dai | 20/10/2026 |
| [ADR-004](ADR-004-contrat-api.md) | Contrat d'API, format d'erreur et versioning | Acceptée (pas de pagination, API en anglais, types générés) | Amiel Fabreguettes | 20/10/2026 |
| [ADR-005](ADR-005-harnais-de-validation.md) | Harnais de validation : tests, CI et garde-fous | Acceptée (points ouverts listés) | Stanislas Beguin | 20/10/2026 |
| [ADR-006](ADR-006-strategie-de-migration.md) | Stratégie de migration du code legacy (Strangler Fig, Branch by Abstraction) | Acceptée le 28/10 | Amalraj Soupramanien | 27/10/2026 |
| [ADR-007](ADR-007-observabilite.md) | Observabilité : OpenTelemetry et Grafana | Acceptée le 28/10 (optionnelle, désactivée par défaut ; amende l'ADR-005 §5) | Stanislas Beguin | 27/10/2026 |
| [ADR-008](ADR-008-mesure-usage-umami.md) | Mesure d'usage du produit : Umami | Acceptée le 28/10 (optionnelle, désactivée par défaut) ; amendement du 29/10 accepté : heatmap et replays sans texte | Stanislas Beguin | 28/10/2026 |

Décisions transverses du PO (20/10/2026) :

- **401** sans session, **403** si le rôle est refusé (PR #8). Repris dans l'ADR-004 §4.
- **OCR asynchrone** : tâche à faire (2-503), sans attendre un déclencheur de l'ADR-003.
- **Pas de pagination** des listes ; **API en anglais** avec codes stables, traduite par le front (ADR-004).
- **S7** : la règle « le premier inscrit d'un domaine devient RH » est une **faille corrigée** : rejoindre une entreprise passe par une invitation de la RH, avec vérification d'email (ADR-001, §3 ; ticket 2-496).
- **B16** : chaque note garde qui l'a tranchée et quand (ADR-002, 2-488).
- Ordre de la refacto : correctifs de sécurité d'abord, puis helpers communs de l'ADR-002.

Décisions du PO (23/10/2026) :

- **Un seul socle asynchrone**, celui de 2-484 (PR #15) ; l'OCR asynchrone (PR #13) se branche dessus (ADR-003, amendement).
- **Écarts de 2-484 acceptés** : un événement par destinataire, bail de 5 min, DLQ = 1 essai + 5 relances, `EmailPort` sous `NotificationPort` (ADR-003, amendement).
- **Notifications (PR #16) après 2-476** ; ordre de fusion : #11 → #14 → #15 → 2-476 → #16 → #13 → #17.
- **2-481** livre aussi le rôle du worker et ses garde-fous (ADR-001, point de coordination).

Mises à jour du 27/10/2026 (garde-fous d'exploitation, livrés) :

- **ADR-001 §4** : `AUTH_SECRET` vérifié au démarrage (CONF-01) et procédure de rotation ; limite de tentatives de connexion, 429 + `Retry-After` sur l'API (AUTH-11).
- **ADR-003** : métriques `ocr_requests_total{outcome}` et état de l'outbox dérivés des logs (T9, OBS-01) ; réconciliation quotidienne planifiée dans `ops/cron/` (T5).
- **ADR-004 §7.1** : absence de rupture du contrat vérifiée par oasdiff dans la CI.
- **ADR-005 §5** : métriques dérivées des logs ajoutées au périmètre ; traces distribuées toujours hors périmètre.

Constats d'audit référencés par les ADR : [`docs/audit/`](../audit/).

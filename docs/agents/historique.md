# Historique des corrections et dette détaillée

Sorti de [`CLAUDE.md`](../../CLAUDE.md) pour qu'un agent ne le lise pas à chaque tâche. À lire seulement pour travailler sur l'un de ces sujets, ou pour préparer la soutenance. Constats détaillés : [`docs/audit/`](../audit/) ; décisions : [`docs/adr/`](../adr/README.md) ; tickets : projet Linear ARLA, jalon J4.

## Identité et inscription (S7 corrigée, ADR-001 §3, 2-496)

Le domaine de l'email ne donne **aucun droit**. S'inscrire sans invitation crée sa propre entreprise, dont on devient RH ; la connexion n'est possible qu'après le lien de vérification reçu par email. Un compte non vérifié ne bloque pas son adresse : une nouvelle inscription ou une invitation acceptée le remplace (`purge_unverified_account`), et l'email de vérification peut être renvoyé depuis `/signup/verify`. On rejoint une entreprise uniquement par une **invitation de sa RH** (`/hr`, `POST /api/hr/invitations`) : lien à usage unique, valable 7 jours, qui vaut vérification d'email. Les jetons ne sont stockés qu'en empreinte SHA-256 ; le worker les crée à l'envoi (l'outbox ne transporte que des ids). Inscription, acceptation et vérification passent par des fonctions `SECURITY DEFINER` (`register_user`, `accept_invitation`, `verify_email`…).

## Dette connue, en détail

Constats de l'audit en cours, chacun à vérifier avant de s'y fier :

- `src/utils/` (`validators.ts`, `format.ts`) n'est importé par aucun code : la validation passe par les schémas du contrat (2-486). Les contrôles de rôle des routes API passent tous par `requireRole()` (2-487) ; seules les pages `/manager` et `/hr` refont le leur, pour l'affichage. Toutes les routes passent par un cas d'usage (ADR-006, 2-536) ; la règle « qui voit quoi » vit dans le domaine pour une note et dans le `WHERE` des listes (`PostgresExpenseNoteListRepository`) : les garder alignées.
- Création de NDF : reçu stocké d'abord puis une seule transaction (2-476 étape 1, `SubmitExpenseNote`) ; renvoi sans doublon par `Idempotency-Key` (étape 2, colonnes `idempotency_key` et `request_fingerprint`) ; nettoyage de l'existant (étape 3) : contrainte `CHECK (receipt_key <> '')` posée `NOT VALID` par migration, puis `npm run clean:notes-without-receipt` (dry-run par défaut ; `-- --execute --out <dossier>` exporte en CSV, supprime les notes `pending` sans reçu, garde les décidées pour la RH et valide la contrainte quand il n'en reste plus). Réconciliation des objets orphelins (bonus) : `npm run reconcile:orphan-receipts` (dry-run par défaut ; `-- --execute` supprime les objets de `receipts/` non référencés par une note ni une analyse OCR et vieux de plus de 24 h), à planifier une fois par jour après un premier dry-run relu. Les bornes OCR et son parcours asynchrone, branché sur le socle commun de l'outbox (2-484), sont décrits dans `docs/ocr.md`.
- Contrat global dans `openapi.yaml`, types et JSON de validation générés (2-486). Erreurs communes sans détail interne et traductions front (2-485), logger serveur de 2-490 réutilisé.

## Déjà corrigé

- Notifications par email de la soumission (approbateur) et de la décision (soumetteur), émises dans la transaction de la note via l'outbox (2-484, `src/adapters/PgNotificationEvents.ts`, handlers dans `src/worker/notificationHandlers.ts`).
- Codes **401** sans session / **403** rôle refusé sur toutes les routes (Q1.1, PR #8).
- Tests unitaires (Vitest, dans `npm run check` et la CI) et règles d'architecture vérifiées par le lint (2-489).
- OCR : montant lu sur la dernière ligne de total chiffrée, « TTC » en priorité, et description suggérée (nom du commerçant), règles pures dans `src/domain/receipt/parseReceiptText.ts` (PR #17).
- Sécurité WS1 (2-471) : tri `?sort=` par liste blanche (S1), reçu manager limité à son équipe (S2), rattachement limité aux managers de l'entreprise (S3), `AUTH_SECRET` lu dans l'environnement (S5).
- Identité (2-496) : invitations par la RH et vérification d'email du créateur, le domaine ne donne plus aucun droit (S7), rôle relu en base à chaque requête et session de 8 h d'inactivité (S9).
- Isolation par la base (S4, 2-478 puis 2-481) : l'application se connecte sous `expense_app` et le worker sous `expense_worker`, soumis à la RLS, le propriétaire ne sert qu'aux migrations et au seed (`MIGRATION_DATABASE_URL`), et chaque processus refuse de démarrer en production sous un rôle superuser ou `BYPASSRLS` (tests ISO-07, ISO-10, ISO-11).
- Garde-fous d'exploitation (27/10) : `AUTH_SECRET` vérifié au démarrage, refus en production s'il est absent, court ou d'exemple (`src/lib/authSecret.ts`, CONF-01) ; limite de tentatives de connexion par email et par IP, 429 + `Retry-After` sur l'API d'Auth.js (`src/lib/loginThrottle.ts`, table `login_attempts` accessible seulement par fonctions `SECURITY DEFINER`, AUTH-11) ; métriques dérivées des logs `ocr.request` et `outbox.stats` (OBS-01) ; contrat d'API sans rupture vérifié par oasdiff en CI (`make api-breaking`) ; réconciliation des reçus planifiée dans `ops/cron/`.

# Carte du code

<!-- Généré par npm run generate:architecture (scripts/architecture/codemap.ts) : ne pas modifier à la main. -->

Pour chaque point d'entrée : les fichiers qu'il atteint par ses imports, rangés par couche, les tables et fonctions SQL touchées et les specs E2E qui appellent la route. **Lire cette carte avant d'explorer le dépôt** : elle dit quels fichiers ouvrir pour une fonctionnalité voisine. Elle est vérifiée par `npm run check` (`scripts/architecture/architecture.test.ts`) : à jour avec le code, sinon le test échoue.

Lecture : une nouvelle opération imite la route la plus proche (même rôle, même ressource). Recette complète : skill `/nouvelle-fonctionnalite` (`.claude/skills/nouvelle-fonctionnalite/SKILL.md`).

## Socle commun des routes

Atteint par au moins la moitié des routes, donc omis sous chacune : `src/http/dto.ts`, `src/http/errors.ts`, `src/http/problem.ts`, `src/http/requestContext.ts`, `src/http/requireRole.ts`, `src/http/validation.ts`, `src/http/withApiErrors.ts`, `src/lib/auth.ts`, `src/lib/authErrors.ts`, `src/lib/db.ts`, `src/lib/log.ts`, `src/lib/loginThrottle.ts`, `src/lib/sessionUser.ts`.

## Routes d’API

### `/api/auth/[...nextauth]`

- Fichier : `src/app/api/auth/[...nextauth]/route.ts`
- GET : publique
- POST : publique
- E2E : `e2e/auth.spec.ts`, `e2e/login-throttle.spec.ts`

### `/api/expense-notes`

- Fichier : `src/app/api/expense-notes/route.ts`
- GET : session
- POST : session
- Composition : `src/composition/expenseNoteLists.ts`, `src/composition/receipts.ts`, `src/composition/submissions.ts`
- Cas d’usage : `src/application/ListExpenseNotes.ts`, `src/application/SubmitExpenseNote.ts`
- Domaine : `src/domain/Notification.ts`, `src/domain/User.ts`, `src/domain/expense/NoteSort.ts`, `src/domain/receipt/OcrError.ts`, `src/domain/receipt/Receipt.ts`, `src/domain/receipt/limits.ts`
- Ports : `src/ports/EventOutbox.ts`, `src/ports/ExpenseNoteListRepository.ts`, `src/ports/ExpenseNoteSubmissionRepository.ts`, `src/ports/NotificationPort.ts`, `src/ports/ReceiptInspector.ts`, `src/ports/ReceiptStoragePort.ts`
- Adaptateurs : `src/adapters/PgEventOutbox.ts`, `src/adapters/PgNotificationEvents.ts`, `src/adapters/PostgresExpenseNoteListRepository.ts`, `src/adapters/PostgresExpenseNoteSubmissionRepository.ts`, `src/adapters/S3ReceiptAdapter.ts`, `src/adapters/inspectReceipt.ts`
- HTTP : `src/http/expenseNote.ts`, `src/http/readExpenseInput.ts`, `src/http/readMultipart.ts`
- Infrastructure : `src/lib/storage.ts`
- Tables : `expense_notes`, `outbox_events`, `users`
- E2E : `e2e/access-control.spec.ts`, `e2e/api-errors.spec.ts`, `e2e/auth.spec.ts`, `e2e/idempotency.spec.ts`

### `/api/expense-notes/[id]/receipt-url`

- Fichier : `src/app/api/expense-notes/[id]/receipt-url/route.ts`
- GET : session
- Composition : `src/composition/receiptUrls.ts`
- Cas d’usage : `src/application/GetReceiptUrl.ts`
- Domaine : `src/domain/User.ts`, `src/domain/expense/ReceiptAccess.ts`, `src/domain/receipt/limits.ts`
- Ports : `src/ports/ReceiptAccessRepository.ts`, `src/ports/ReceiptStoragePort.ts`
- Adaptateurs : `src/adapters/PostgresReceiptAccessRepository.ts`, `src/adapters/S3ReceiptAdapter.ts`
- Infrastructure : `src/lib/storage.ts`
- Tables : `expense_notes`, `users`
- E2E : `e2e/access-control.spec.ts`, `e2e/api-contract.spec.ts`

### `/api/expense-notes/receipt-suggestion`

- Fichier : `src/app/api/expense-notes/receipt-suggestion/route.ts`
- POST : session
- Composition : `src/composition/ocr.ts`, `src/composition/receipts.ts`
- Cas d’usage : `src/application/OcrCapacity.ts`, `src/application/OcrRequests.ts`, `src/application/ReceiptAnalyses.ts`, `src/application/SuggestReceiptFields.ts`
- Domaine : `src/domain/receipt/OcrError.ts`, `src/domain/receipt/Receipt.ts`, `src/domain/receipt/analysisPayload.ts`, `src/domain/receipt/limits.ts`, `src/domain/receipt/parseReceiptText.ts`
- Ports : `src/ports/EventOutbox.ts`, `src/ports/OcrExecutionPort.ts`, `src/ports/OcrPort.ts`, `src/ports/ReceiptAnalysisRepository.ts`, `src/ports/ReceiptInspector.ts`, `src/ports/ReceiptStoragePort.ts`
- Adaptateurs : `src/adapters/PgEventOutbox.ts`, `src/adapters/PostgresOcrExecution.ts`, `src/adapters/PostgresReceiptAnalysisRepository.ts`, `src/adapters/S3ReceiptAdapter.ts`, `src/adapters/TesseractOcrAdapter.ts`, `src/adapters/inspectReceipt.ts`
- HTTP : `src/http/ocrHandlers.ts`, `src/http/ocrMetrics.ts`, `src/http/readMultipart.ts`, `src/http/readReceipt.ts`
- Infrastructure : `src/lib/storage.ts`
- Tables : `outbox_events`, `receipt_analyses`, `users`
- Fonctions SQL : `pending_receipt_analyses`
- E2E : `e2e/access-control.spec.ts`, `e2e/ocr-analysis.spec.ts`

### `/api/hr/expense-notes`

- Fichier : `src/app/api/hr/expense-notes/route.ts`
- GET : rôle `hr_admin`
- Composition : `src/composition/expenseNoteLists.ts`
- Cas d’usage : `src/application/ListExpenseNotes.ts`
- Domaine : `src/domain/expense/NoteSort.ts`
- Ports : `src/ports/ExpenseNoteListRepository.ts`
- Adaptateurs : `src/adapters/PostgresExpenseNoteListRepository.ts`
- HTTP : `src/http/expenseNote.ts`
- Tables : `expense_notes`, `users`
- E2E : `e2e/access-control.spec.ts`

### `/api/hr/expense-notes/[id]/approve`

- Fichier : `src/app/api/hr/expense-notes/[id]/approve/route.ts`
- POST : rôle `hr_admin`
- Composition : `src/composition/decisions.ts`
- Cas d’usage : `src/application/DecideExpenseNote.ts`
- Domaine : `src/domain/ExpenseNote.ts`, `src/domain/Notification.ts`, `src/domain/User.ts`, `src/domain/validation/DecideExpenseNote.ts`
- Ports : `src/ports/EventOutbox.ts`, `src/ports/ExpenseNoteDecisionRepository.ts`, `src/ports/NotificationPort.ts`
- Adaptateurs : `src/adapters/PgEventOutbox.ts`, `src/adapters/PgNotificationEvents.ts`, `src/adapters/PostgresExpenseNoteDecisionRepository.ts`
- HTTP : `src/http/expenseNote.ts`
- Tables : `expense_notes`, `outbox_events`, `users`
- E2E : `e2e/access-control.spec.ts`, `e2e/api-contract.spec.ts`

### `/api/hr/expense-notes/[id]/receipt-url`

- Fichier : `src/app/api/hr/expense-notes/[id]/receipt-url/route.ts`
- GET : rôle `hr_admin`
- Composition : `src/composition/receiptUrls.ts`
- Cas d’usage : `src/application/GetReceiptUrl.ts`
- Domaine : `src/domain/User.ts`, `src/domain/expense/ReceiptAccess.ts`, `src/domain/receipt/limits.ts`
- Ports : `src/ports/ReceiptAccessRepository.ts`, `src/ports/ReceiptStoragePort.ts`
- Adaptateurs : `src/adapters/PostgresReceiptAccessRepository.ts`, `src/adapters/S3ReceiptAdapter.ts`
- Infrastructure : `src/lib/storage.ts`
- Tables : `expense_notes`, `users`
- E2E : `e2e/access-control.spec.ts`, `e2e/api-contract.spec.ts`

### `/api/hr/expense-notes/[id]/reject`

- Fichier : `src/app/api/hr/expense-notes/[id]/reject/route.ts`
- POST : rôle `hr_admin`
- Composition : `src/composition/decisions.ts`
- Cas d’usage : `src/application/DecideExpenseNote.ts`
- Domaine : `src/domain/ExpenseNote.ts`, `src/domain/Notification.ts`, `src/domain/User.ts`, `src/domain/validation/DecideExpenseNote.ts`
- Ports : `src/ports/EventOutbox.ts`, `src/ports/ExpenseNoteDecisionRepository.ts`, `src/ports/NotificationPort.ts`
- Adaptateurs : `src/adapters/PgEventOutbox.ts`, `src/adapters/PgNotificationEvents.ts`, `src/adapters/PostgresExpenseNoteDecisionRepository.ts`
- HTTP : `src/http/expenseNote.ts`
- Tables : `expense_notes`, `outbox_events`, `users`
- E2E : `e2e/access-control.spec.ts`, `e2e/api-contract.spec.ts`

### `/api/hr/invitations`

- Fichier : `src/app/api/hr/invitations/route.ts`
- POST : rôle `hr_admin`
- Composition : `src/composition/identity.ts`
- Cas d’usage : `src/application/InviteEmployee.ts`
- Domaine : `src/domain/identity/identity.ts`
- Ports : `src/ports/EventOutbox.ts`, `src/ports/InvitationRepository.ts`
- Adaptateurs : `src/adapters/PgEventOutbox.ts`, `src/adapters/PostgresInvitationRepository.ts`
- Tables : `invitations`, `outbox_events`, `users`
- E2E : `e2e/invitations.spec.ts`

### `/api/hr/users`

- Fichier : `src/app/api/hr/users/route.ts`
- GET : rôle `hr_admin`
- Composition : `src/composition/companyDirectory.ts`
- Ports : `src/ports/CompanyDirectory.ts`
- Adaptateurs : `src/adapters/PostgresCompanyDirectory.ts`
- Tables : `users`
- E2E : `e2e/access-control.spec.ts`, `e2e/auth.spec.ts`, `e2e/parcours-complet.spec.ts`

### `/api/hr/users/[id]/manager`

- Fichier : `src/app/api/hr/users/[id]/manager/route.ts`
- PUT : rôle `hr_admin`
- Composition : `src/composition/companyDirectory.ts`
- Ports : `src/ports/CompanyDirectory.ts`
- Adaptateurs : `src/adapters/PostgresCompanyDirectory.ts`
- Tables : `users`
- E2E : `e2e/access-control.spec.ts`, `e2e/api-contract.spec.ts`, `e2e/hr-org-chart.spec.ts`

### `/api/manager/expense-notes`

- Fichier : `src/app/api/manager/expense-notes/route.ts`
- GET : rôle `manager`
- Composition : `src/composition/expenseNoteLists.ts`
- Cas d’usage : `src/application/ListExpenseNotes.ts`
- Domaine : `src/domain/expense/NoteSort.ts`
- Ports : `src/ports/ExpenseNoteListRepository.ts`
- Adaptateurs : `src/adapters/PostgresExpenseNoteListRepository.ts`
- HTTP : `src/http/expenseNote.ts`
- Tables : `expense_notes`, `users`
- E2E : `e2e/access-control.spec.ts`, `e2e/api-errors.spec.ts`

### `/api/manager/expense-notes/[id]/approve`

- Fichier : `src/app/api/manager/expense-notes/[id]/approve/route.ts`
- POST : rôle `manager`
- Composition : `src/composition/decisions.ts`
- Cas d’usage : `src/application/DecideExpenseNote.ts`
- Domaine : `src/domain/ExpenseNote.ts`, `src/domain/Notification.ts`, `src/domain/User.ts`, `src/domain/validation/DecideExpenseNote.ts`
- Ports : `src/ports/EventOutbox.ts`, `src/ports/ExpenseNoteDecisionRepository.ts`, `src/ports/NotificationPort.ts`
- Adaptateurs : `src/adapters/PgEventOutbox.ts`, `src/adapters/PgNotificationEvents.ts`, `src/adapters/PostgresExpenseNoteDecisionRepository.ts`
- HTTP : `src/http/expenseNote.ts`
- Tables : `expense_notes`, `outbox_events`, `users`
- E2E : `e2e/access-control.spec.ts`, `e2e/api-contract.spec.ts`

### `/api/manager/expense-notes/[id]/receipt-url`

- Fichier : `src/app/api/manager/expense-notes/[id]/receipt-url/route.ts`
- GET : rôle `manager`
- Composition : `src/composition/receiptUrls.ts`
- Cas d’usage : `src/application/GetReceiptUrl.ts`
- Domaine : `src/domain/User.ts`, `src/domain/expense/ReceiptAccess.ts`, `src/domain/receipt/limits.ts`
- Ports : `src/ports/ReceiptAccessRepository.ts`, `src/ports/ReceiptStoragePort.ts`
- Adaptateurs : `src/adapters/PostgresReceiptAccessRepository.ts`, `src/adapters/S3ReceiptAdapter.ts`
- Infrastructure : `src/lib/storage.ts`
- Tables : `expense_notes`, `users`
- E2E : `e2e/access-control.spec.ts`, `e2e/api-contract.spec.ts`

### `/api/manager/expense-notes/[id]/reject`

- Fichier : `src/app/api/manager/expense-notes/[id]/reject/route.ts`
- POST : rôle `manager`
- Composition : `src/composition/decisions.ts`
- Cas d’usage : `src/application/DecideExpenseNote.ts`
- Domaine : `src/domain/ExpenseNote.ts`, `src/domain/Notification.ts`, `src/domain/User.ts`, `src/domain/validation/DecideExpenseNote.ts`
- Ports : `src/ports/EventOutbox.ts`, `src/ports/ExpenseNoteDecisionRepository.ts`, `src/ports/NotificationPort.ts`
- Adaptateurs : `src/adapters/PgEventOutbox.ts`, `src/adapters/PgNotificationEvents.ts`, `src/adapters/PostgresExpenseNoteDecisionRepository.ts`
- HTTP : `src/http/expenseNote.ts`
- Tables : `expense_notes`, `outbox_events`, `users`
- E2E : `e2e/access-control.spec.ts`, `e2e/api-contract.spec.ts`

### `/api/receipt-analyses`

- Fichier : `src/app/api/receipt-analyses/route.ts`
- POST : session
- Composition : `src/composition/ocr.ts`, `src/composition/receipts.ts`
- Cas d’usage : `src/application/OcrCapacity.ts`, `src/application/OcrRequests.ts`, `src/application/ReceiptAnalyses.ts`, `src/application/SuggestReceiptFields.ts`
- Domaine : `src/domain/receipt/OcrError.ts`, `src/domain/receipt/Receipt.ts`, `src/domain/receipt/analysisPayload.ts`, `src/domain/receipt/limits.ts`, `src/domain/receipt/parseReceiptText.ts`
- Ports : `src/ports/EventOutbox.ts`, `src/ports/OcrExecutionPort.ts`, `src/ports/OcrPort.ts`, `src/ports/ReceiptAnalysisRepository.ts`, `src/ports/ReceiptInspector.ts`, `src/ports/ReceiptStoragePort.ts`
- Adaptateurs : `src/adapters/PgEventOutbox.ts`, `src/adapters/PostgresOcrExecution.ts`, `src/adapters/PostgresReceiptAnalysisRepository.ts`, `src/adapters/S3ReceiptAdapter.ts`, `src/adapters/TesseractOcrAdapter.ts`, `src/adapters/inspectReceipt.ts`
- HTTP : `src/http/ocrHandlers.ts`, `src/http/ocrMetrics.ts`, `src/http/readMultipart.ts`, `src/http/readReceipt.ts`
- Infrastructure : `src/lib/storage.ts`
- Tables : `outbox_events`, `receipt_analyses`, `users`
- Fonctions SQL : `pending_receipt_analyses`
- E2E : `e2e/ocr-analysis.spec.ts`

### `/api/receipt-analyses/[id]`

- Fichier : `src/app/api/receipt-analyses/[id]/route.ts`
- GET : session
- Composition : `src/composition/ocr.ts`, `src/composition/receipts.ts`
- Cas d’usage : `src/application/OcrCapacity.ts`, `src/application/OcrRequests.ts`, `src/application/ReceiptAnalyses.ts`, `src/application/SuggestReceiptFields.ts`
- Domaine : `src/domain/receipt/OcrError.ts`, `src/domain/receipt/Receipt.ts`, `src/domain/receipt/analysisPayload.ts`, `src/domain/receipt/limits.ts`, `src/domain/receipt/parseReceiptText.ts`
- Ports : `src/ports/EventOutbox.ts`, `src/ports/OcrExecutionPort.ts`, `src/ports/OcrPort.ts`, `src/ports/ReceiptAnalysisRepository.ts`, `src/ports/ReceiptInspector.ts`, `src/ports/ReceiptStoragePort.ts`
- Adaptateurs : `src/adapters/PgEventOutbox.ts`, `src/adapters/PostgresOcrExecution.ts`, `src/adapters/PostgresReceiptAnalysisRepository.ts`, `src/adapters/S3ReceiptAdapter.ts`, `src/adapters/TesseractOcrAdapter.ts`, `src/adapters/inspectReceipt.ts`
- HTTP : `src/http/ocrHandlers.ts`, `src/http/ocrMetrics.ts`, `src/http/readMultipart.ts`, `src/http/readReceipt.ts`
- Infrastructure : `src/lib/storage.ts`
- Tables : `outbox_events`, `receipt_analyses`, `users`
- Fonctions SQL : `pending_receipt_analyses`
- E2E : `e2e/api-contract.spec.ts`, `e2e/ocr-analysis.spec.ts`, `e2e/ocr-outbox.spec.ts`

### `/verify-email`

- Fichier : `src/app/verify-email/route.ts`
- GET : publique
- Composition : `src/composition/identity.ts`
- Cas d’usage : `src/application/SignUp.ts`
- Domaine : `src/domain/identity/identity.ts`
- Ports : `src/ports/AccountRegistry.ts`
- Adaptateurs : `src/adapters/PostgresAccountRegistry.ts`
- Infrastructure : `src/lib/tokens.ts`
- Fonctions SQL : `accept_invitation`, `auth_find_user`, `invitation_preview`, `register_user`, `request_email_verification`, `verify_email`
- E2E : aucune spec ne cite cette route

## Pages

### `/`

- Fichier : `src/app/page.tsx`
- Routes appelées : aucune

### `/expenses`

- Fichier : `src/app/expenses/page.tsx`
- Composants : `src/components/apiError.ts`, `src/components/receiptAnalysisClient.ts`
- Routes appelées : `/api/expense-notes`, `/api/expense-notes/[id]/receipt-url`, `/api/receipt-analyses`, `/api/receipt-analyses/[id]`

### `/hr`

- Fichier : `src/app/hr/page.tsx`
- Composants : `src/components/AdminConsole.tsx`, `src/components/InviteEmployeeForm.tsx`, `src/components/apiError.ts`
- Routes appelées : `/api/hr/expense-notes`, `/api/hr/expense-notes/[id]/approve`, `/api/hr/expense-notes/[id]/receipt-url`, `/api/hr/expense-notes/[id]/reject`, `/api/hr/invitations`, `/api/hr/users`, `/api/hr/users/[id]/manager`

### `/login`

- Fichier : `src/app/login/page.tsx`
- Composition : `src/composition/identity.ts`
- Cas d’usage : `src/application/SignUp.ts`
- Domaine : `src/domain/identity/identity.ts`
- Ports : `src/ports/AccountRegistry.ts`
- Adaptateurs : `src/adapters/PostgresAccountRegistry.ts`
- Actions serveur : `src/app/actions/auth.ts`
- Routes appelées : aucune

### `/manager`

- Fichier : `src/app/manager/page.tsx`
- Composants : `src/components/PendingApprovalsPanel.tsx`, `src/components/apiError.ts`
- Routes appelées : `/api/manager/expense-notes`, `/api/manager/expense-notes/[id]/approve`, `/api/manager/expense-notes/[id]/receipt-url`, `/api/manager/expense-notes/[id]/reject`

### `/signup`

- Fichier : `src/app/signup/page.tsx`
- Composition : `src/composition/identity.ts`
- Cas d’usage : `src/application/SignUp.ts`
- Domaine : `src/domain/identity/identity.ts`
- Ports : `src/ports/AccountRegistry.ts`
- Adaptateurs : `src/adapters/PostgresAccountRegistry.ts`
- Composants : `src/components/SignupForm.tsx`
- Actions serveur : `src/app/actions/auth.ts`
- Routes appelées : aucune

### `/signup/verify`

- Fichier : `src/app/signup/verify/page.tsx`
- Composition : `src/composition/identity.ts`
- Cas d’usage : `src/application/SignUp.ts`
- Domaine : `src/domain/identity/identity.ts`
- Ports : `src/ports/AccountRegistry.ts`
- Adaptateurs : `src/adapters/PostgresAccountRegistry.ts`
- Composants : `src/components/ResendVerificationForm.tsx`
- Actions serveur : `src/app/actions/auth.ts`
- Routes appelées : aucune

## Worker de l’outbox

- Registre des handlers : `src/worker/handlers.ts`
- Composition : `src/composition/ocr.ts`
- Cas d’usage : `src/application/OcrCapacity.ts`, `src/application/ProcessReceiptAnalysis.ts`, `src/application/SendIdentityEmails.ts`, `src/application/SuggestReceiptFields.ts`
- Domaine : `src/domain/Notification.ts`, `src/domain/User.ts`, `src/domain/identity/identity.ts`, `src/domain/receipt/OcrError.ts`, `src/domain/receipt/Receipt.ts`, `src/domain/receipt/analysisPayload.ts`, `src/domain/receipt/limits.ts`, `src/domain/receipt/parseReceiptText.ts`
- Ports : `src/ports/EmailPort.ts`, `src/ports/EventOutbox.ts`, `src/ports/IdentityEmailTokens.ts`, `src/ports/NotificationPort.ts`, `src/ports/OcrExecutionPort.ts`, `src/ports/OcrPort.ts`, `src/ports/ReceiptAnalysisWorkPort.ts`, `src/ports/ReceiptStoragePort.ts`
- Adaptateurs : `src/adapters/EmailNotificationAdapter.ts`, `src/adapters/PgEventOutbox.ts`, `src/adapters/PgIdentityEmailTokens.ts`, `src/adapters/PgNotificationEvents.ts`, `src/adapters/PostgresOcrExecution.ts`, `src/adapters/PostgresReceiptAnalysisWork.ts`, `src/adapters/S3ReceiptAdapter.ts`, `src/adapters/SmtpEmailAdapter.ts`, `src/adapters/TesseractOcrAdapter.ts`
- Worker : `src/worker/identityEmails.ts`, `src/worker/log.ts`, `src/worker/notificationHandlers.ts`, `src/worker/processNextEvent.ts`, `src/worker/receiptAnalysis.ts`, `src/worker/retry.ts`
- Infrastructure : `src/lib/db.ts`, `src/lib/email.ts`, `src/lib/log.ts`, `src/lib/outbox.ts`, `src/lib/storage.ts`, `src/lib/tokens.ts`
- Tables : `outbox_events`, `receipt_analyses`, `users`
- Fonctions SQL : `issue_invitation_token`, `issue_verification_token`, `purge_expired_receipt_analyses`, `receipt_cleanup_candidates`

import { canViewReceipt, ReceiptNotVisible, type ReceiptScope } from '@/modules/expenses/domain/ReceiptAccess'
import type { ReceiptAccessRepository } from '@/modules/expenses/ports/ReceiptAccessRepository'
import type { ReceiptStoragePort } from '@/ports/ReceiptStoragePort'

// URL pré-signée d'un reçu, pour les 3 routes receipt-url (employé, manager,
// RH). Les routes gardent l'authentification (401/403) ; une note absente ou
// hors du périmètre lève `ReceiptNotVisible` (404), sans appel au stockage.
export class GetReceiptUrl {
  constructor(
    private readonly repository: ReceiptAccessRepository,
    private readonly storage: ReceiptStoragePort
  ) {}

  async execute(noteId: string, viewerId: string, scope: ReceiptScope): Promise<string> {
    const access = await this.repository.findReceipt(noteId, viewerId)
    if (!access || !canViewReceipt(scope, access.viewer, access.submitter)) {
      throw new ReceiptNotVisible()
    }
    // Durée par défaut du port (300 s), comme avant la migration.
    return this.storage.getSignedUrl(access.receiptKey)
  }
}

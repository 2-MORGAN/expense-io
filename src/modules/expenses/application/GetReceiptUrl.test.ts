import { describe, expect, it, vi } from 'vitest'
import { GetReceiptUrl } from './GetReceiptUrl'
import { ReceiptNotVisible } from '@/modules/expenses/domain/ReceiptAccess'
import type { ReceiptAccess, ReceiptAccessRepository } from '@/ports/ReceiptAccessRepository'
import type { ReceiptStoragePort } from '@/ports/ReceiptStoragePort'

const access: ReceiptAccess = {
  receiptKey: 'receipts/company-1/note-1.jpg',
  viewer: { id: 'manager-1', role: 'manager', companyId: 'company-1' },
  submitter: { id: 'employee-1', role: 'employee', managerId: 'manager-1', companyId: 'company-1' },
}

function storage(): ReceiptStoragePort {
  return {
    upload: vi.fn(),
    getSignedUrl: vi.fn(async (key: string) => `https://s3.local/${key}?signed`),
    read: vi.fn(),
    delete: vi.fn(),
  }
}

describe('GetReceiptUrl', () => {
  it('renvoie l’URL pré-signée du reçu visible, avec la durée par défaut du port', async () => {
    const repository: ReceiptAccessRepository = { findReceipt: vi.fn(async () => access) }
    const receipts = storage()

    await expect(new GetReceiptUrl(repository, receipts).execute('note-1', 'manager-1', 'team')).resolves.toBe(
      'https://s3.local/receipts/company-1/note-1.jpg?signed'
    )
    expect(repository.findReceipt).toHaveBeenCalledWith('note-1', 'manager-1')
    expect(receipts.getSignedUrl).toHaveBeenCalledWith('receipts/company-1/note-1.jpg')
  })

  it('lève ReceiptNotVisible pour une note introuvable, sans appeler le stockage', async () => {
    const repository: ReceiptAccessRepository = { findReceipt: vi.fn(async () => null) }
    const receipts = storage()

    await expect(new GetReceiptUrl(repository, receipts).execute('note-1', 'manager-1', 'team')).rejects.toBeInstanceOf(
      ReceiptNotVisible
    )
    expect(receipts.getSignedUrl).not.toHaveBeenCalled()
  })

  it('lève ReceiptNotVisible hors du périmètre de la route, sans appeler le stockage', async () => {
    const repository: ReceiptAccessRepository = { findReceipt: vi.fn(async () => access) }
    const receipts = storage()

    await expect(new GetReceiptUrl(repository, receipts).execute('note-1', 'manager-1', 'own')).rejects.toBeInstanceOf(
      ReceiptNotVisible
    )
    expect(receipts.getSignedUrl).not.toHaveBeenCalled()
  })
})

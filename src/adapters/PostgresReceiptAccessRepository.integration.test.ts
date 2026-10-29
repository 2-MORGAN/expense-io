import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PostgresReceiptAccessRepository } from './PostgresReceiptAccessRepository'
import { submitNote } from '../../integration/support/notes'
import { createTenant } from '../../integration/support/tenant'

// Faits lus pour décider de l'accès à un reçu (la règle est dans le domaine,
// `canViewReceipt`) : le lecteur, la note, son auteur, sous la RLS du lecteur.
// La matrice complète est dans integration/visibility.integration.test.ts.

const repository = new PostgresReceiptAccessRepository()

describe('findReceipt', () => {
  it('rend la clé du reçu, le lecteur et l’auteur avec leur entreprise et leur manager', async () => {
    const { employee, manager } = await createTenant('acces-recu')
    const note = await submitNote(employee)
    expect(await repository.findReceipt(note.id, manager.id)).toEqual({
      receiptKey: note.receipt_key,
      viewer: { id: manager.id, role: 'manager', companyId: manager.companyId },
      submitter: { id: employee.id, role: 'employee', managerId: manager.id, companyId: employee.companyId },
    })
  })

  it('l’auteur lit les faits de sa propre note', async () => {
    const { employee } = await createTenant('acces-recu-auteur')
    const note = await submitNote(employee)
    expect((await repository.findReceipt(note.id, employee.id))?.submitter.id).toBe(employee.id)
  })

  it('note d’une autre entreprise : la RLS la masque, rien n’est rendu', async () => {
    const a = await createTenant('acces-recu-a')
    const b = await createTenant('acces-recu-b')
    const note = await submitNote(a.manager)
    expect(await repository.findReceipt(note.id, b.hr.id)).toBeNull()
  })

  it('note ou lecteur inconnus : rien n’est rendu', async () => {
    const { employee } = await createTenant('acces-recu-inconnu')
    const note = await submitNote(employee)
    expect(await repository.findReceipt(randomUUID(), employee.id)).toBeNull()
    expect(await repository.findReceipt(note.id, randomUUID())).toBeNull()
  })
})

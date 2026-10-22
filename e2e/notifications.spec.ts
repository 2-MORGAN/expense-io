import { closePool } from '@/lib/db'
import { expectApiError } from './support/api'
import { addUser, expect, test } from './support/fixtures'
import { outboxEventsForNote } from './support/outbox'

test.afterAll(closePool)

test.describe('Notifications — émission', () => {
  test('[NOTIF-01] soumission d’un employé → un événement pour son manager', async ({ org, apiAs }) => {
    const note = await (await apiAs(org.employee)).submitNote({ description: 'Taxi gare' })
    expect(await outboxEventsForNote(note.id)).toMatchObject([{
      type: 'expense_note.submitted', companyId: org.company.id, status: 'pending',
      payload: { noteId: note.id, description: 'Taxi gare', submitterName: 'Emile Employe', recipientIds: [org.manager.id] },
    }])
  })

  test('[NOTIF-02] soumission d’un manager racine → toutes les RH de l’entreprise', async ({ org, apiAs }) => {
    const hr2 = await addUser(org, { name: 'Helene Rh', role: 'hr_admin' })
    const note = await (await apiAs(org.manager)).submitNote({ description: 'Hôtel' })
    const [event] = await outboxEventsForNote(note.id)
    expect((event.payload.recipientIds as string[]).sort()).toEqual([org.hr.id, hr2.id].sort())
  })

  test('[NOTIF-03] soumetteur sans approbateur → note créée, aucun événement', async ({ org, apiAs }) => {
    const alone = await addUser(org, { name: 'Sans Manager', role: 'employee', managerId: null })
    const note = await (await apiAs(alone)).submitNote({ description: 'Repas' })
    expect(await outboxEventsForNote(note.id)).toEqual([])
  })

  test('[NOTIF-04] décision du manager → un seul événement, même après des décisions répétées', async ({ org, apiAs }) => {
    const note = await (await apiAs(org.employee)).submitNote({ description: 'Train' })
    const managerApi = await apiAs(org.manager)
    expect((await managerApi.managerDecide(note.id, 'approve')).status()).toBe(200)
    await expectApiError(await managerApi.managerDecide(note.id, 'approve'), 409, 'Already decided')
    await expectApiError(await managerApi.managerDecide(note.id, 'reject'), 409, 'Already decided')

    const decided = (await outboxEventsForNote(note.id)).filter((event) => event.type === 'expense_note.decided')
    expect(decided).toMatchObject([{ payload: { noteId: note.id, description: 'Train', decision: 'approved', recipientIds: [org.employee.id] } }])
  })

  test('[NOTIF-05] rejet par la RH d’une note de manager racine → événement pour le manager', async ({ org, apiAs }) => {
    const note = await (await apiAs(org.manager)).submitNote({ description: 'Salon' })
    expect((await (await apiAs(org.hr)).hrDecide(note.id, 'reject')).status()).toBe(200)
    const decided = (await outboxEventsForNote(note.id)).filter((event) => event.type === 'expense_note.decided')
    expect(decided).toMatchObject([{ payload: { decision: 'rejected', recipientIds: [org.manager.id] } }])
  })
})

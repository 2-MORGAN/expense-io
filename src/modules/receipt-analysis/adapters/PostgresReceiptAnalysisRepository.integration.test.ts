import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PostgresReceiptAnalysisRepository } from './PostgresReceiptAnalysisRepository'
import { RECEIPT_ANALYSIS_REQUESTED } from '@/modules/receipt-analysis/domain/analysisPayload'
import type { NewReceiptAnalysis } from '@/modules/receipt-analysis/ports/ReceiptAnalysisRepository'
import { eventsOfCompany } from '../../../../integration/support/outbox'
import { addMember, createTenant, owner } from '../../../../integration/support/tenant'

// Analyse OCR asynchrone, côté application (`expense_app`) : demande
// idempotente par clé, lecture réservée à son auteur sous la RLS de
// `receipt_analyses`, événement du worker publié dans la même transaction.
// Statuts relus sans exiger « queued » : un worker lancé sur la même base
// (`make dev`) peut déjà avoir pris l'analyse (ADR-003 §5).

const repository = new PostgresReceiptAnalysisRepository()

function request(companyId: string, overrides: Partial<NewReceiptAnalysis> = {}): NewReceiptAnalysis {
  const id = randomUUID()
  return {
    id,
    receiptKey: `receipts/${companyId}/analyses/${id}`,
    mimeType: 'image/png',
    fingerprint: 'empreinte-a',
    idempotencyKey: randomUUID(),
    ...overrides,
  }
}

describe('actor', () => {
  it('lit l’entreprise de l’utilisateur ; un inconnu doit se reconnecter', async () => {
    const { employee } = await createTenant('analyse-acteur')
    expect(await repository.actor(employee.id)).toEqual({ userId: employee.id, companyId: employee.companyId })
    await expect(repository.actor(randomUUID())).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
  })
})

describe('enqueue', () => {
  it('enregistre l’analyse et publie sa demande dans la même transaction', async () => {
    const { employee } = await createTenant('analyse-demande')
    const actor = await repository.actor(employee.id)
    const input = request(actor.companyId)
    expect(await repository.enqueue(actor, input)).toEqual({ id: input.id, status: 'queued' })
    const stored = await owner().query('SELECT user_id, company_id, receipt_key, mime_type FROM receipt_analyses WHERE id = $1', [input.id])
    expect(stored.rows[0]).toEqual({ user_id: employee.id, company_id: actor.companyId, receipt_key: input.receiptKey, mime_type: 'image/png' })
    expect((await eventsOfCompany(actor.companyId)).map((event) => [event.type, event.payload])).toEqual([
      [RECEIPT_ANALYSIS_REQUESTED, { version: 1, analysisId: input.id, userId: employee.id, companyId: actor.companyId, receiptKey: input.receiptKey }],
    ])
  })

  it('même clé, même reçu : rend l’analyse existante sans en créer une autre', async () => {
    const { employee } = await createTenant('analyse-rejeu')
    const actor = await repository.actor(employee.id)
    const first = request(actor.companyId)
    await repository.enqueue(actor, first)
    const again = await repository.enqueue(actor, { ...request(actor.companyId), idempotencyKey: first.idempotencyKey })
    expect(again.id).toBe(first.id)
    expect(await eventsOfCompany(actor.companyId)).toHaveLength(1)
  })

  it('même clé, autre reçu : IDEMPOTENCY_KEY_REUSED, rien de créé', async () => {
    const { employee } = await createTenant('analyse-cle-reutilisee')
    const actor = await repository.actor(employee.id)
    const first = request(actor.companyId)
    await repository.enqueue(actor, first)
    const other = request(actor.companyId, { idempotencyKey: first.idempotencyKey, fingerprint: 'empreinte-b' })
    await expect(repository.enqueue(actor, other)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    expect((await owner().query('SELECT 1 FROM receipt_analyses WHERE id = $1', [other.id])).rowCount).toBe(0)
  })

  it('une clé expirée n’empêche pas une nouvelle analyse', async () => {
    const { employee } = await createTenant('analyse-cle-expiree')
    const actor = await repository.actor(employee.id)
    const first = request(actor.companyId)
    await repository.enqueue(actor, first)
    await owner().query("UPDATE receipt_analyses SET expires_at = now() - interval '1 second' WHERE id = $1", [first.id])
    const next = request(actor.companyId, { idempotencyKey: first.idempotencyKey, fingerprint: 'empreinte-b' })
    expect(await repository.enqueue(actor, next)).toEqual({ id: next.id, status: 'queued' })
  })
})

describe('find et replay', () => {
  it('l’auteur relit son analyse ; un collègue de la même entreprise ne la voit pas', async () => {
    const tenant = await createTenant('analyse-lecture')
    const colleague = await addMember(tenant.company, { name: 'Clara Collegue', role: 'employee' })
    const actor = await repository.actor(tenant.employee.id)
    const input = request(actor.companyId)
    await repository.enqueue(actor, input)
    expect(await repository.find(actor, input.id)).toMatchObject({ id: input.id })
    expect(await repository.find(await repository.actor(colleague.id), input.id)).toBeNull()
  })

  it('une analyse expirée n’est plus lisible', async () => {
    const { employee } = await createTenant('analyse-expiree')
    const actor = await repository.actor(employee.id)
    const input = request(actor.companyId)
    await repository.enqueue(actor, input)
    await owner().query("UPDATE receipt_analyses SET expires_at = now() - interval '1 second' WHERE id = $1", [input.id])
    expect(await repository.find(actor, input.id)).toBeNull()
  })

  it('replay : même empreinte rend l’analyse, autre empreinte refusée, clé inconnue absente', async () => {
    const { employee } = await createTenant('analyse-replay')
    const actor = await repository.actor(employee.id)
    const input = request(actor.companyId)
    await repository.enqueue(actor, input)
    expect(await repository.replay(actor, input.idempotencyKey, input.fingerprint)).toMatchObject({ id: input.id })
    await expect(repository.replay(actor, input.idempotencyKey, 'autre')).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    expect(await repository.replay(actor, randomUUID(), input.fingerprint)).toBeNull()
  })
})

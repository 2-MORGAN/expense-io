import { validateId } from './validation'
import { auth } from '@/lib/auth'
import { requireRole } from './requireRole'
import { ocrCapacity, ocrRequests } from '@/composition/ocr'
import type { ReceiptAnalysis } from '@/ports/ReceiptAnalysisRepository'
import { readReceipt } from './readReceipt'
import { withApiErrors } from './withApiErrors'
import { problemBody } from './problem'
import { ocrErrorOutcome, ocrSuccessOutcome, recordOcrRequest } from './ocrMetrics'
import type { components } from '@/types/api'

export const suggest = withApiErrors('/api/expense-notes/receipt-suggestion', async function suggest(request: Request) {
  let reservation: ReturnType<typeof ocrCapacity.reserve> | undefined
  const actor = requireRole(await auth())
  if (actor instanceof Response) return actor
  // Compté à partir d'ici : une requête sans session n'est pas un appel OCR.
  const startedAt = performance.now()
  try {
    reservation = ocrCapacity.reserve(request.signal)
    const receipt = await readReceipt(request, reservation.signal, { allowUnsupported: true })
    return await reservation.run(async (signal) => {
      const result = await ocrRequests.suggest(actor.id, receipt, signal)
      recordOcrRequest(ocrSuccessOutcome(result), startedAt)
      return Response.json(result)
    })
  } catch (error) {
    recordOcrRequest(ocrErrorOutcome(error), startedAt)
    throw error
  } finally { reservation?.release() }
})

export const launch = withApiErrors('/api/receipt-analyses', async function launch(request: Request) {
  let reservation: ReturnType<typeof ocrCapacity.reserve> | undefined
  try {
    const actor = requireRole(await auth())
    if (actor instanceof Response) return actor
    reservation = ocrCapacity.reserve(request.signal)
    const receipt = await readReceipt(request, reservation.signal)
    return await reservation.run(async (signal) => {
      const analysis = await ocrRequests.launch(actor.id, receipt, request.headers.get('idempotency-key'), signal)
      return Response.json({ id: analysis.id, status: analysis.status }, {
        status: 202, headers: { Location: `/api/receipt-analyses/${analysis.id}`, 'Cache-Control': 'no-store' },
      })
    })
  } finally { reservation?.release() }
})

export function analysisDto(analysis: ReceiptAnalysis): components['schemas']['ReceiptAnalysis'] {
  return {
    id: analysis.id, status: analysis.status,
    ...(analysis.result ? { result: analysis.result } : {}),
    ...(analysis.errorCode ? { error: problemBody(analysis.errorCode, { requestId: analysis.id }) } : {}),
  }
}

export const find = withApiErrors('/api/receipt-analyses/[id]', async function find(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = requireRole(await auth())
  if (actor instanceof Response) return actor
  const { id } = await context.params
  validateId(id)
  return Response.json(analysisDto(await ocrRequests.find(actor.id, id)), { headers: { 'Cache-Control': 'no-store' } })
})

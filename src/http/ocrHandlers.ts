import { auth } from '@/lib/auth'
import { OcrError } from '@/domain/receipt/OcrError'
import { ocrCapacity, ocrRequests } from '@/composition/ocr'
import type { ReceiptAnalysis } from '@/ports/ReceiptAnalysisRepository'
import { readReceipt } from './readReceipt'
import { ocrProblem } from './ocrProblem'
import type { components } from '@/types/ocr-api'

export async function suggest(request: Request) {
  let reservation: ReturnType<typeof ocrCapacity.reserve> | undefined
  try {
    const session = await auth()
    if (!session?.user?.id) throw new OcrError('AUTHENTICATION_REQUIRED')
    reservation = ocrCapacity.reserve(request.signal)
    const receipt = await readReceipt(request, reservation.signal)
    return await reservation.run(async (signal) => {
      const result = await ocrRequests.suggest(session.user.id, receipt, signal)
      return Response.json(result)
    })
  } catch (error) { return ocrProblem(error) }
  finally { reservation?.release() }
}

export async function launch(request: Request) {
  let reservation: ReturnType<typeof ocrCapacity.reserve> | undefined
  try {
    const session = await auth()
    if (!session?.user?.id) throw new OcrError('AUTHENTICATION_REQUIRED')
    reservation = ocrCapacity.reserve(request.signal)
    const receipt = await readReceipt(request, reservation.signal)
    return await reservation.run(async (signal) => {
      const analysis = await ocrRequests.launch(session.user.id, receipt, request.headers.get('idempotency-key'), signal)
      return Response.json({ id: analysis.id, status: analysis.status }, {
        status: 202, headers: { Location: `/api/receipt-analyses/${analysis.id}`, 'Cache-Control': 'no-store' },
      })
    })
  } catch (error) { return ocrProblem(error) }
  finally { reservation?.release() }
}

export function analysisDto(analysis: ReceiptAnalysis): components['schemas']['ReceiptAnalysis'] {
  return {
    id: analysis.id, status: analysis.status,
    ...(analysis.result ? { result: analysis.result } : {}),
    ...(analysis.errorCode ? { error: {
      type: `/problems/${analysis.errorCode.toLowerCase().replaceAll('_', '-')}`,
      code: analysis.errorCode, title: 'Receipt analysis failed',
      status: analysis.errorCode.startsWith('OCR_') ? 503 : 400,
      detail: 'Receipt analysis could not be completed.', requestId: analysis.id,
    } } : {}),
  }
}

export async function find(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) throw new OcrError('AUTHENTICATION_REQUIRED')
    const { id } = await context.params
    return Response.json(analysisDto(await ocrRequests.find(session.user.id, id)), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return ocrProblem(error) }
}

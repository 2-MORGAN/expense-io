import { OcrError } from '@/domain/receipt/OcrError'
import { MAX_RECEIPT_BYTES } from '@/domain/receipt/limits'
import { validateReceipt, type Receipt } from '@/domain/receipt/Receipt'

// Le fichier a une borne exacte ; la requête inclut aussi l'enveloppe multipart.
const MAX_MULTIPART_BYTES = MAX_RECEIPT_BYTES + 64 * 1024

export async function readReceipt(request: Request, signal: AbortSignal): Promise<Receipt> {
  signal.throwIfAborted()
  const length = Number(request.headers.get('content-length'))
  if (length > MAX_MULTIPART_BYTES) throw new OcrError('RECEIPT_TOO_LARGE')
  if (!request.body) throw new OcrError('VALIDATION_ERROR')
  const reader = request.body.getReader()
  let size = 0
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  const limited = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        signal.throwIfAborted()
        const { value, done } = await reader.read()
        signal.throwIfAborted()
        if (done) { controller.close(); return }
        size += value.byteLength
        if (size > MAX_MULTIPART_BYTES) throw new OcrError('RECEIPT_TOO_LARGE')
        controller.enqueue(value)
      } catch (error) {
        controller.error(error)
        void reader.cancel().catch(() => {})
      }
    },
    cancel() { return reader.cancel() },
  }, { highWaterMark: 0 })
  try {
    const bounded = new Response(limited, { headers: { 'content-type': request.headers.get('content-type') ?? '' } })
    const form = await bounded.formData()
    const values = form.getAll('receipt')
    if (values.length !== 1 || !(values[0] instanceof File) || [...form.keys()].some((key) => key !== 'receipt')) {
      throw new OcrError('VALIDATION_ERROR')
    }
    const file = values[0]
    if (file.size > MAX_RECEIPT_BYTES) throw new OcrError('RECEIPT_TOO_LARGE')
    const receipt = { data: Buffer.from(await file.arrayBuffer()), mimeType: file.type }
    validateReceipt(receipt)
    return receipt
  } catch (error) {
    if (signal.aborted) throw signal.reason
    if (error instanceof OcrError) throw error
    throw new OcrError('VALIDATION_ERROR')
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

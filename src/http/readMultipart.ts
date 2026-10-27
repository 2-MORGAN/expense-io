import contract from '@/generated/api-contract.json'
import { InputError } from './validation'

const policy = contract.components.schemas.Receipt
const MAX_MULTIPART_BYTES = policy['x-maxBytes'] + policy['x-multipartOverheadBytes']

/** Count actual chunks even with an absent/false Content-Length; cancel on overflow/abort. */
export async function readMultipart(request: Request, signal = request.signal): Promise<FormData> {
  signal.throwIfAborted()
  if (Number(request.headers.get('content-length')) > MAX_MULTIPART_BYTES) throw new InputError('RECEIPT_TOO_LARGE')
  if (!request.body) throw new InputError()
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
        if (size > MAX_MULTIPART_BYTES) throw new InputError('RECEIPT_TOO_LARGE')
        controller.enqueue(value)
      } catch (error) {
        controller.error(error)
        void reader.cancel().catch(() => {})
      }
    },
    cancel() { return reader.cancel() },
  }, { highWaterMark: 0 })
  try {
    return await new Response(limited, { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData()
  } catch (error) {
    if (signal.aborted) throw signal.reason
    if (error instanceof InputError) throw error
    throw new InputError()
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Preserve strings as strings; a File is represented only for JSON Schema validation. */
export function multipartFields(form: FormData): Record<string, string | File> {
  const input: Record<string, string | File> = {}
  for (const [key, value] of form) {
    if (Object.hasOwn(input, key)) throw new InputError('VALIDATION_ERROR', [{ field: key, code: 'DUPLICATE_FIELD', message: 'Only one value is allowed.' }])
    input[key] = value
  }
  return input
}

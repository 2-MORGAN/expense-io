import { OcrError } from '@/modules/receipt-analysis/domain/OcrError'
import { OCR_CONCURRENCY, OCR_WAITING, OCR_TIMEOUT_MS } from '@/modules/receipt-analysis/domain/limits'

interface Waiter { start: () => void }

// Une réservation précède toute lecture du corps : les uploads en cours comptent aussi.
export class OcrCapacity {
  private admitted = 0
  private active = 0
  private waiting: Waiter[] = []

  constructor(private concurrency = OCR_CONCURRENCY, private queueSize = OCR_WAITING) {}

  reserve(parent?: AbortSignal, timeout = OCR_TIMEOUT_MS) {
    if (this.admitted >= this.concurrency + this.queueSize) throw new OcrError('OCR_OVERLOADED')
    parent?.throwIfAborted()
    this.admitted++
    const controller = new AbortController()
    const abort = () => controller.abort(parent?.reason ?? new OcrError('OCR_TIMEOUT'))
    parent?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(new OcrError('OCR_TIMEOUT')), timeout)
    let released = false
    let used = false
    const release = () => {
      if (released) return
      released = true
      clearTimeout(timer)
      parent?.removeEventListener('abort', abort)
      this.admitted--
    }
    return {
      signal: controller.signal,
      release,
      run: async <T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> => {
        if (used || released) throw new Error('OCR reservation already used')
        used = true
        try {
          await this.acquire(controller.signal)
          try {
            controller.signal.throwIfAborted()
            const result = await task(controller.signal)
            controller.signal.throwIfAborted()
            return result
          } catch (error) {
            throw controller.signal.aborted ? controller.signal.reason : error
          } finally {
            this.active--
            this.waiting.shift()?.start()
          }
        } finally { release() }
      },
    }
  }

  private acquire(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.active < this.concurrency) {
      this.active++
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const entry: Waiter = { start: () => {
        signal.removeEventListener('abort', abort)
        this.active++
        resolve()
      } }
      const abort = () => {
        this.waiting = this.waiting.filter((item) => item !== entry)
        reject(signal.reason)
      }
      signal.addEventListener('abort', abort, { once: true })
      this.waiting.push(entry)
    })
  }
}

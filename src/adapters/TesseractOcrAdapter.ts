import { spawn } from 'node:child_process'
import path from 'node:path'
import { OcrError } from '@/domain/receipt/OcrError'
import type { Receipt } from '@/domain/receipt/Receipt'
import type { OcrPort } from '@/ports/OcrPort'
import { MAX_RECEIPT_BYTES, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE } from '@/domain/receipt/limits'

export class TesseractOcrAdapter implements OcrPort {
  constructor(private enginePath = path.join(process.cwd(), 'scripts/ocr-engine.mjs')) {}

  async inspect(receipt: Receipt, signal: AbortSignal): Promise<void> {
    await this.execute(receipt, signal, 'inspect')
  }

  recognize(receipt: Receipt, signal: AbortSignal): Promise<string> {
    return this.execute(receipt, signal, 'recognize')
  }

  private execute(receipt: Receipt, signal: AbortSignal, mode: string): Promise<string> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [this.enginePath, mode, receipt.mimeType,
        JSON.stringify({ maxBytes: MAX_RECEIPT_BYTES, maxPixels: MAX_IMAGE_PIXELS, maxSide: MAX_IMAGE_SIDE })], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'], windowsHide: true,
      })
      const output: Buffer[] = []
      let bytes = 0
      let failed = false
      const stop = () => { child.kill('SIGKILL') }
      signal.addEventListener('abort', stop, { once: true })
      // Ni le texte OCR ni le stderr du moteur ne sont journalisés (données de reçu).
      // Les trois premiers descripteurs sont explicitement des pipes ci-dessus.
      child.stderr!.resume()
      child.stdout!.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 1024 * 1024) { failed = true; stop() }
        else output.push(chunk)
      })
      child.on('error', () => { failed = true })
      child.stdin!.on('error', () => { /* EPIPE si le processus a déjà été arrêté. */ })
      child.on('close', () => {
        signal.removeEventListener('abort', stop)
        // close confirme la fin du processus : aucune place n'est libérée avant.
        if (signal.aborted) { reject(signal.reason); return }
        try {
          if (failed) throw new OcrError('OCR_UNAVAILABLE')
          const result: { text?: unknown; code?: unknown } = JSON.parse(Buffer.concat(output).toString())
          if (result.code === 'IMAGE_TOO_LARGE' || result.code === 'RECEIPT_TOO_LARGE' || result.code === 'RECEIPT_TYPE_NOT_ALLOWED') {
            throw new OcrError(result.code)
          }
          if (typeof result.text !== 'string') throw new OcrError('OCR_UNAVAILABLE')
          resolve(result.text)
        } catch (error) {
          reject(error instanceof OcrError ? error : new OcrError('OCR_UNAVAILABLE'))
        }
      })
      child.stdin!.end(receipt.data)
      if (signal.aborted) stop()
    })
  }
}

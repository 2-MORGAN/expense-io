// Processus jetable : le parent peut l'arrêter pendant sharp ET createWorker().
import path from 'node:path'
import sharp from 'sharp'
import { createWorker } from 'tesseract.js'

process.once('disconnect', () => process.exit(1))
sharp.cache(false)
sharp.concurrency(1)
let replied = false
function reply(body, code) {
  if (replied) return
  replied = true
  process.stdout.write(JSON.stringify(body), () => process.exit(code))
}
const { maxBytes, maxPixels, maxSide } = JSON.parse(process.argv[4])
const chunks = []
let size = 0
try {
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > maxBytes) throw new Error('RECEIPT_TOO_LARGE')
    chunks.push(chunk)
  }
  const input = Buffer.concat(chunks)
  const image = sharp(input, { limitInputPixels: maxPixels, animated: false })
  let metadata
  try {
    metadata = await image.metadata()
  } catch (error) {
    throw new Error(/pixel limit/i.test(String(error)) ? 'IMAGE_TOO_LARGE' : 'RECEIPT_TYPE_NOT_ALLOWED')
  }
  const expectedFormat = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[process.argv[3]]
  if (metadata.format !== expectedFormat || (metadata.pages ?? 1) > 1) {
    throw new Error('RECEIPT_TYPE_NOT_ALLOWED')
  }
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels) {
    throw new Error('IMAGE_TOO_LARGE')
  }
  // L'inspection avant 202 valide aussi les pixels, pas seulement l'en-tête.
  let prepared
  try {
    prepared = await image.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
  } catch {
    throw new Error('RECEIPT_TYPE_NOT_ALLOWED')
  }
  let text = ''
  if (process.argv[2] !== 'inspect') {
    const worker = await createWorker('fra', undefined, {
      langPath: path.join(process.cwd(), 'tessdata'), cacheMethod: 'none',
      errorHandler: () => reply({ code: 'OCR_UNAVAILABLE' }, 1),
    })
    try {
      text = (await worker.recognize(prepared)).data.text
    } finally {
      await worker.terminate()
    }
  }
  reply({ text }, 0)
} catch (error) {
  const known = ['RECEIPT_TOO_LARGE', 'IMAGE_TOO_LARGE', 'RECEIPT_TYPE_NOT_ALLOWED']
  const code = error instanceof Error && known.includes(error.message) ? error.message : 'OCR_UNAVAILABLE'
  console.error('[ocr-engine]', code)
  reply({ code }, 1)
}

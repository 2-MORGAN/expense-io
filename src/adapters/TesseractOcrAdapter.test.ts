import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { TesseractOcrAdapter } from './TesseractOcrAdapter'
import { fixtureImage, pngReceipt } from '../../e2e/support/files'
import { OcrError } from '@/domain/receipt/OcrError'

let directory: string
beforeAll(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'ocr-engine-test-')) })
afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

describe('isolated Tesseract engine', () => {
  it('recognizes the existing fixture using the real engine', async () => {
    const file = fixtureImage('recu-ocr-complet.png')
    const text = await new TesseractOcrAdapter().recognize({ data: file.buffer, mimeType: file.mimeType }, AbortSignal.timeout(10_000))
    expect(text).toContain('42,50')
    expect(text).toContain('11/10/2026')
  })
  it('rejects a highly compressed image above 40 megapixels', async () => {
    const image = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: 'white' } }).png().toBuffer()
    expect(image.length).toBeLessThan(10 * 1024 * 1024)
    await expect(new TesseractOcrAdapter().inspect({ data: image, mimeType: 'image/png' }, AbortSignal.timeout(10_000))).rejects.toThrow('IMAGE_TOO_LARGE')
  })
  it('returns unavailable when the process cannot initialize', async () => {
    await expect(new TesseractOcrAdapter(path.join(directory, 'missing.mjs')).recognize({ data: Buffer.alloc(0), mimeType: 'image/png' }, AbortSignal.timeout(2000))).rejects.toThrow('OCR_UNAVAILABLE')
  })
  it('refuses a PNG with valid metadata but corrupted pixel data before acceptance', async () => {
    const data = Buffer.from(pngReceipt('corrupt-pixels').buffer)
    const offset = data.indexOf(Buffer.from('IDAT'))
    data[offset + 4] ^= 255
    await expect(new TesseractOcrAdapter().inspect({ data, mimeType: 'image/png' }, AbortSignal.timeout(2000))).rejects.toThrow('RECEIPT_TYPE_NOT_ALLOWED')
  })
  it('kills a process stuck before worker initialization completes', async () => {
    const engine = path.join(directory, 'blocked.mjs')
    await writeFile(engine, 'setInterval(() => {}, 1000)')
    const controller = new AbortController()
    const promise = new TesseractOcrAdapter(engine).recognize({ data: Buffer.alloc(0), mimeType: 'image/png' }, controller.signal)
    controller.abort(new OcrError('OCR_TIMEOUT'))
    // La promesse ne rejette qu'après close du processus, pas juste après le signal.
    await expect(promise).rejects.toThrow('OCR_TIMEOUT')
  })
})

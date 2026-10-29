import { describe, expect, it } from 'vitest'
import { readReceipt } from './readReceipt'
import { MAX_RECEIPT_BYTES } from '@/modules/receipt-analysis/domain/limits'
import { pngReceipt } from '../../e2e/support/files'

function upload(data: Buffer) {
  const form = new FormData()
  form.set('receipt', new File([new Uint8Array(data)], 'receipt.png', { type: 'image/png' }))
  return new Request('http://localhost/test', { method: 'POST', body: form })
}

describe('bounded multipart input', () => {
  it('reads a valid image', async () => {
    const image = pngReceipt('bounded')
    expect(await readReceipt(upload(image.buffer), new AbortController().signal)).toEqual({ data: image.buffer, mimeType: 'image/png' })
  })
  it('rejects a file one byte above the exact limit', async () => {
    await expect(readReceipt(upload(Buffer.alloc(MAX_RECEIPT_BYTES + 1)), new AbortController().signal)).rejects.toThrow('RECEIPT_TOO_LARGE')
  })
  it('stops reading an oversized body even without Content-Length', async () => {
    let reads = 0
    let cancelled = false
    const body = new ReadableStream({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(1024 * 1024)) },
      cancel() { cancelled = true },
    }, { highWaterMark: 0 })
    const request = new Request('http://localhost/test', {
      method: 'POST', body, headers: { 'Content-Type': 'multipart/form-data; boundary=test' }, duplex: 'half',
    } as RequestInit)
    await expect(readReceipt(request, new AbortController().signal)).rejects.toThrow('RECEIPT_TOO_LARGE')
    expect(reads).toBeLessThanOrEqual(11)
    expect(cancelled).toBe(true)
  })
  it('cancels a stalled upload on timeout', async () => {
    let cancelled = false
    const body = new ReadableStream({ pull() { return new Promise(() => {}) }, cancel() { cancelled = true } })
    const request = new Request('http://localhost/test', { method: 'POST', body,
      headers: { 'Content-Type': 'multipart/form-data; boundary=test' }, duplex: 'half' } as RequestInit)
    const controller = new AbortController()
    const receipt = readReceipt(request, controller.signal)
    controller.abort(new Error('upload timeout'))
    await expect(receipt).rejects.toThrow('upload timeout')
    expect(cancelled).toBe(true)
  })
  it('rejects a misleading MIME type and duplicate receipt fields', async () => {
    await expect(readReceipt(upload(Buffer.from('not a PNG')), new AbortController().signal)).rejects.toThrow('RECEIPT_TYPE_NOT_ALLOWED')
    const form = new FormData()
    form.append('receipt', new File(['one'], 'one.png'))
    form.append('receipt', new File(['two'], 'two.png'))
    await expect(readReceipt(new Request('http://localhost', { method: 'POST', body: form }), new AbortController().signal)).rejects.toThrow('VALIDATION_ERROR')
  })
})

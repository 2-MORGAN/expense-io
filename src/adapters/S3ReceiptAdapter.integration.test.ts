import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { S3ReceiptAdapter } from './S3ReceiptAdapter'

// Stockage des reçus contre le S3 de docker-compose.yml (LocalStack) : envoi,
// relecture bornée, URL pré-signée de courte durée qui sert le fichier avec
// son type, suppression.

const storage = new S3ReceiptAdapter()
const keyOf = (extension: string) => `receipts/integration-${randomUUID()}/${randomUUID()}${extension}`
const timeout = () => AbortSignal.timeout(10_000)

describe('S3ReceiptAdapter', () => {
  it('relit exactement les octets envoyés', async () => {
    const key = keyOf('.png')
    const body = Buffer.from(`reçu ${randomUUID()}`)
    await storage.upload(key, body, 'image/png')
    expect(Buffer.compare(await storage.read(key, timeout()), body)).toBe(0)
  })

  it('l’URL pré-signée expire en 300 s par défaut et sert le fichier avec son type', async () => {
    const key = keyOf('.pdf')
    const body = Buffer.from('%PDF-1.4 reçu')
    await storage.upload(key, body, 'application/pdf')
    const url = await storage.getSignedUrl(key)
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('300')
    const response = await fetch(url, { signal: timeout() })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await response.arrayBuffer()).equals(body)).toBe(true)
  })

  it('après suppression, la relecture échoue', async () => {
    const key = keyOf('.webp')
    await storage.upload(key, Buffer.from('webp'), 'image/webp')
    await storage.delete(key)
    await expect(storage.read(key, timeout())).rejects.toThrow()
  })

  it('supprimer un objet absent ne lève rien (compensation rejouable)', async () => {
    await expect(storage.delete(keyOf('.png'))).resolves.toBeUndefined()
  })

  it('un envoi interrompu par son signal échoue', async () => {
    const controller = new AbortController()
    controller.abort(new Error('client parti'))
    await expect(storage.upload(keyOf('.png'), Buffer.from('x'), 'image/png', controller.signal)).rejects.toThrow()
  })
})

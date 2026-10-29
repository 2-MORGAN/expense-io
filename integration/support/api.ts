import { NextRequest } from 'next/server'
import { checkApiResponse } from '@/http/contractResponses'

// Appel d'un handler de route comme le fait Next.js (`route.ts` importé
// directement), sans serveur HTTP : requête standard, paramètres de chemin
// en promesse. Chaque réponse est contrôlée contre openapi.yaml, comme dans
// les E2E (`withContractChecks`).

export interface Reply<T = unknown> {
  status: number
  headers: Record<string, string>
  body: T
}

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>

export interface CallOptions {
  /** Corps JSON (sérialisé), ou texte brut tel quel. */
  json?: unknown
  raw?: string
  form?: FormData
  headers?: Record<string, string>
  params?: Record<string, string>
}

export async function call<T = unknown>(handler: unknown, method: string, path: string, options: CallOptions = {}): Promise<Reply<T>> {
  const headers = new Headers(options.headers)
  let body: BodyInit | undefined
  if (options.form) body = options.form
  else if (options.raw !== undefined) body = options.raw
  else if (options.json !== undefined) {
    body = JSON.stringify(options.json)
    headers.set('content-type', 'application/json')
  }
  const request = new NextRequest(`http://localhost${path}`, { method, headers, body })
  const response = await (handler as Handler)(request, { params: Promise.resolve(options.params ?? {}) })
  const replyHeaders = Object.fromEntries(response.headers.entries())
  const text = await response.text()
  const parsed = text ? (JSON.parse(text) as T) : (undefined as T)
  checkApiResponse(method, path, response.status, replyHeaders, parsed)
  return { status: response.status, headers: replyHeaders, body: parsed }
}

/** Formulaire d'une note de frais, comme l'envoie l'interface. */
export function noteForm(fields: { amount?: string; expenseDate?: string; description?: string; receipt?: { buffer: Buffer; name: string; mimeType: string } }): FormData {
  const form = new FormData()
  if (fields.amount !== undefined) form.set('amount', fields.amount)
  if (fields.expenseDate !== undefined) form.set('expenseDate', fields.expenseDate)
  if (fields.description !== undefined) form.set('description', fields.description)
  if (fields.receipt) form.set('receipt', new File([new Uint8Array(fields.receipt.buffer)], fields.receipt.name, { type: fields.receipt.mimeType }))
  return form
}

import { setTimeout as sleep } from 'node:timers/promises'
import type { APIRequestContext } from '@playwright/test'
// Charge `.env` (même source de configuration que le reste de la suite).
import './env'

// Lecture des emails captés par Mailpit (docker-compose), via son API HTTP.
// Mailpit ne fait sortir aucun email : tout ce que l'application envoie en
// local y arrive, ce qui permet de tester l'envoi de bout en bout.

/** Interface et API de Mailpit. Par défaut celles de `docker compose`. */
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025'

/** Champs de `GET /api/v1/message/{ID}` utilisés par les tests. */
export interface MailpitMessage {
  ID: string
  MessageID: string
  From: { Address: string }
  To: { Address: string }[]
  Subject: string
  Text: string
}

interface MailpitSearch {
  messages_count: number
  messages: { ID: string }[]
}

const POLL_INTERVAL_MS = 250

async function search(request: APIRequestContext, to: string): Promise<MailpitSearch> {
  const response = await request.get(`${MAILPIT_URL}/api/v1/search`, {
    params: { query: `to:${to}` },
  })
  if (!response.ok()) {
    throw new Error(`Mailpit /api/v1/search : HTTP ${response.status()}`)
  }
  return (await response.json()) as MailpitSearch
}

/**
 * Attend qu'un email adressé à `to` soit arrivé dans Mailpit et le renvoie en
 * entier (corps compris). Les adresses de test sont uniques, pas besoin de
 * vider la boîte avant.
 */
export async function waitForEmail(
  request: APIRequestContext,
  to: string,
  timeoutMs = 10_000
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs
  do {
    const [first] = (await search(request, to)).messages
    if (first) {
      const response = await request.get(`${MAILPIT_URL}/api/v1/message/${first.ID}`)
      if (!response.ok()) {
        throw new Error(`Mailpit /api/v1/message/${first.ID} : HTTP ${response.status()}`)
      }
      return (await response.json()) as MailpitMessage
    }
    await sleep(POLL_INTERVAL_MS)
  } while (Date.now() < deadline)
  throw new Error(`Aucun email pour ${to} dans Mailpit`)
}

/** Nombre d'emails adressés à `to` dans Mailpit (0 si aucun). */
export async function countEmails(request: APIRequestContext, to: string): Promise<number> {
  return (await search(request, to)).messages_count
}

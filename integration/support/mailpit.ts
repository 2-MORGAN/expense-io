import { setTimeout as sleep } from 'node:timers/promises'
import { MAILPIT_URL } from './env'

// Lecture des emails captés par le Mailpit de docker-compose.yml, par son API
// HTTP (comme e2e/support/mailpit.ts, sans Playwright). Les adresses de test
// sont uniques : inutile de vider la boîte.

export interface MailpitMessage {
  ID: string
  MessageID: string
  From: { Address: string; Name: string }
  To: { Address: string }[]
  Subject: string
  Text: string
}

async function search(to: string): Promise<{ messages_count: number; messages: { ID: string }[] }> {
  const query = encodeURIComponent(`to:${to}`)
  const response = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`)
  if (!response.ok) throw new Error(`Mailpit /api/v1/search : HTTP ${response.status}`)
  return response.json()
}

/** Attend le premier email adressé à `to` et le rend en entier, corps compris. */
export async function waitForEmail(to: string, timeoutMs = 10_000): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs
  do {
    const [first] = (await search(to)).messages
    if (first) {
      const response = await fetch(`${MAILPIT_URL}/api/v1/message/${first.ID}`)
      if (!response.ok) throw new Error(`Mailpit /api/v1/message : HTTP ${response.status}`)
      return response.json()
    }
    await sleep(200)
  } while (Date.now() < deadline)
  throw new Error(`Aucun email pour ${to} dans Mailpit`)
}

export async function countEmails(to: string): Promise<number> {
  return (await search(to)).messages_count
}

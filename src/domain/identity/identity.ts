import { UUID } from '@/domain/receipt/analysisPayload'
import type { EmailMessage } from '@/ports/EmailPort'
import { NonRetryableError, type OutboxEventRecord } from '@/ports/EventOutbox'

// Identité (S7, ADR-001 §3) : le domaine de l'email ne donne aucun droit.
// S'inscrire sans invitation crée sa propre entreprise ; la rejoindre passe
// par une invitation de sa RH, dont le lien vaut vérification d'email.

/** Types d'événements de l'outbox : l'email part du worker, qui crée le jeton. */
export const INVITATION_REQUESTED = 'invitation.requested'
export const EMAIL_VERIFICATION_REQUESTED = 'email.verification.requested'

export const INVITATION_TTL_DAYS = 7
export const VERIFICATION_TTL_HOURS = 24

const EMAIL_PATTERN = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/

export interface ParsedEmail {
  email: string
  domain: string
}

/** Adresse au format attendu par l'inscription, sinon `null`. Le domaine est rendu en minuscules. */
export function parseEmail(value: unknown): ParsedEmail | null {
  if (typeof value !== 'string') return null
  const match = EMAIL_PATTERN.exec(value)
  return match ? { email: value, domain: match[1].toLowerCase() } : null
}

/** Adresse d'une invitation : sans espaces autour, en minuscules, sinon `null`. */
export function normalizeInvitationEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return parseEmail(value.trim().toLowerCase())?.email ?? null
}

export function invitationExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000)
}

/** Nom donné à l'entreprise d'un nouvel inscrit : la première partie du domaine, comme avant. */
export function companyNameFromDomain(domain: string): string {
  return domain.split('.')[0]
}

export class InvalidEmail extends Error {
  constructor() {
    super('Invalid email')
    this.name = 'InvalidEmail'
  }
}

function payloadId(event: OutboxEventRecord, key: string): string {
  const value = (event.payload as Record<string, unknown> | null)?.[key]
  if (typeof value !== 'string' || !UUID.test(value)) {
    // Un payload invalide le restera : pas de relance.
    throw new NonRetryableError(`${event.type}: payload.${key} must be a UUID`)
  }
  return value
}

export function invitationIdOf(event: OutboxEventRecord): string {
  return payloadId(event, 'invitationId')
}

export function userIdOf(event: OutboxEventRecord): string {
  return payloadId(event, 'userId')
}

export function invitationUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/signup?invitation=${encodeURIComponent(token)}`
}

export function verificationUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/verify-email?token=${encodeURIComponent(token)}`
}

export function invitationEmail(input: {
  to: string
  companyName: string
  url: string
  expiresAt: Date
}): EmailMessage {
  const expires = input.expiresAt.toISOString().slice(0, 10)
  return {
    to: input.to,
    subject: `Invitation à rejoindre ${input.companyName} sur Expense.io`,
    text: [
      'Bonjour,',
      '',
      `Les RH de ${input.companyName} vous invitent à créer votre compte Expense.io pour déposer vos notes de frais.`,
      '',
      `Créer mon compte : ${input.url}`,
      '',
      `Ce lien est personnel, utilisable une seule fois, et valable jusqu'au ${expires}.`,
    ].join('\n'),
  }
}

export function verificationEmail(input: { to: string; name: string; url: string }): EmailMessage {
  return {
    to: input.to,
    subject: 'Confirmez votre adresse email Expense.io',
    text: [
      `Bonjour ${input.name},`,
      '',
      'Confirmez votre adresse email pour activer votre compte Expense.io :',
      input.url,
      '',
      `Ce lien est valable ${VERIFICATION_TTL_HOURS} heures. Si vous n'avez pas créé de compte, ignorez cet email.`,
    ].join('\n'),
  }
}

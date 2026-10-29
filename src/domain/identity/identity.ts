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

const WHITESPACE = /\s/

export interface ParsedEmail {
  email: string
  domain: string
}

/**
 * Adresse au format attendu par l'inscription, sinon `null`. Le domaine est
 * rendu en minuscules. Même règle que l'ancienne `^[^\s@]+@([^\s@]+\.[^\s@]+)$` :
 * un seul @, aucun blanc, une partie locale non vide, un point dans le
 * domaine ni au début ni à la fin. Vérifiée sans retour arrière : l'email
 * vient du formulaire public d'inscription, et l'expression mettait plusieurs
 * secondes sur une adresse piégée (ReDoS, constat SonarJS super-linear-regex).
 */
export function parseEmail(value: unknown): ParsedEmail | null {
  if (typeof value !== 'string' || WHITESPACE.test(value)) return null
  const at = value.indexOf('@')
  if (at < 1 || at !== value.lastIndexOf('@')) return null
  const domain = value.slice(at + 1)
  return domain.slice(1, -1).includes('.') ? { email: value, domain: domain.toLowerCase() } : null
}

// Syntaxe d'adresse du contrat (`format: email` d'OpenAPI, ajv-formats en mode
// full) : partie locale en atomes séparés par des points, domaine en libellés
// DNS d'au plus 63 caractères, sans tiret au bord. Vérifiée morceau par
// morceau pour rester en temps linéaire (pas de regex à retour arrière).
const LOCAL_ATOM = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+$/i
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i

function hasContractSyntax(email: string): boolean {
  const at = email.indexOf('@')
  if (at !== email.lastIndexOf('@')) return false
  const labels = email.slice(at + 1).split('.')
  return email.slice(0, at).split('.').every((atom) => LOCAL_ATOM.test(atom))
    && labels.length >= 2 && labels.every((label) => DOMAIN_LABEL.test(label))
}

/**
 * Adresse d'une invitation : sans espaces autour, en minuscules, sinon `null`.
 * Plus stricte que l'inscription : l'adresse acceptée est renvoyée en 201 et
 * doit respecter le format email du contrat (`Invitation.email`).
 */
export function normalizeInvitationEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = parseEmail(value.trim().toLowerCase())?.email
  return email !== undefined && hasContractSyntax(email) ? email : null
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

/** L'adresse sans ses barres finales, en temps linéaire (constat SonarJS super-linear-regex). */
function withoutTrailingSlashes(url: string): string {
  let end = url.length
  while (end > 0 && url[end - 1] === '/') end--
  return url.slice(0, end)
}

export function invitationUrl(appUrl: string, token: string): string {
  return `${withoutTrailingSlashes(appUrl)}/signup?invitation=${encodeURIComponent(token)}`
}

export function verificationUrl(appUrl: string, token: string): string {
  return `${withoutTrailingSlashes(appUrl)}/verify-email?token=${encodeURIComponent(token)}`
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

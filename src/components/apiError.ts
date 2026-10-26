import type { components } from '@/types/api'

type Problem = components['schemas']['Problem']

// The current interface is French. API text is never used as a translation key or shown verbatim.
const messages: Record<Problem['code'], string> = {
  AUTHENTICATION_REQUIRED: 'Connecte-toi pour continuer.',
  FORBIDDEN: 'Tu n’as pas les droits nécessaires pour cette action.',
  RESOURCE_NOT_FOUND: 'La ressource demandée est introuvable.',
  ALREADY_DECIDED: 'Cette note a déjà été tranchée.',
  INVALID_MANAGER: 'Le manager sélectionné ne peut pas être affecté.',
  INVALID_JSON: 'La requête envoyée est invalide.',
  VALIDATION_ERROR: 'Champs invalides',
  RECEIPT_TOO_LARGE: 'Fichier trop volumineux',
  RECEIPT_TYPE_NOT_ALLOWED: 'Type de fichier non autorisé pour le reçu',
  IMAGE_TOO_LARGE: 'L’image dépasse la limite de 40 mégapixels.',
  INVALID_IDEMPOTENCY_KEY: 'La clé de la requête est invalide.',
  IDEMPOTENCY_KEY_REUSED: 'Cette clé a déjà été utilisée pour un autre reçu.',
  INTERNAL_ERROR: 'Une erreur est survenue. Réessaie plus tard.',
  OCR_UNAVAILABLE: 'Impossible d’analyser ce reçu.',
  OCR_TIMEOUT: 'Impossible d’analyser ce reçu.',
  OCR_OVERLOADED: 'Impossible d’analyser ce reçu.',
}
const fieldMessages: Record<NonNullable<Problem['errors']>[number]['code'], string> = {
  REQUIRED: 'Ce champ est obligatoire.',
  INVALID_UUID: 'L’identifiant est invalide.',
  INVALID_AMOUNT: 'Le montant doit être positif et avoir au plus deux décimales.',
  INVALID_DATE: 'La date est invalide.',
  EMPTY_FILE: 'Le reçu est vide.',
  INVALID_TYPE: 'Le format du champ est invalide.',
  UNKNOWN_FIELD: 'La requête contient un champ inconnu.',
  DUPLICATE_FIELD: 'La requête contient un champ en double.',
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function apiErrorMessage(body: unknown, fallback = messages.INTERNAL_ERROR): string {
  if (!record(body) || typeof body.code !== 'string' || !Object.hasOwn(messages, body.code)) return fallback
  if (body.code === 'VALIDATION_ERROR' && Array.isArray(body.errors)) {
    const error: unknown = body.errors[0]
    if (record(error) && typeof error.code === 'string' && Object.hasOwn(fieldMessages, error.code)) {
      return fieldMessages[error.code as keyof typeof fieldMessages]
    }
  }
  return messages[body.code as keyof typeof messages]
}

export async function responseErrorMessage(response: Response): Promise<string> {
  return apiErrorMessage(await response.json().catch(() => null))
}

// Only this explicitly localized error may be displayed by the receipt workflow.
export class ApiResponseError extends Error {
  constructor(body: unknown, fallback?: string) { super(apiErrorMessage(body, fallback)) }
}

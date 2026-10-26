import { randomUUID } from 'node:crypto'
import type { components } from '@/types/api'
import { requestContext } from './requestContext'

type Problem = components['schemas']['Problem']
export type ProblemCode = Problem['code']
export type FieldError = NonNullable<Problem['errors']>[number]

// Public text only. Never use an exception message or a submitted value here.
export const problemCatalogue = {
  INVALID_JSON: [400, 'Invalid JSON', 'A valid JSON object is required.', 'Champs invalides'],
  VALIDATION_ERROR: [400, 'Validation failed', 'The request does not satisfy the API contract.', 'Champs invalides'],
  RECEIPT_TOO_LARGE: [400, 'Receipt too large', 'Receipt exceeds the 10 MiB limit.', 'Fichier trop volumineux'],
  RECEIPT_TYPE_NOT_ALLOWED: [400, 'Invalid receipt', 'Invalid or unsupported receipt content.', 'Type de fichier non autorisé pour le reçu'],
  IMAGE_TOO_LARGE: [400, 'Image too large', 'Image exceeds the 40 megapixel limit.'],
  INVALID_IDEMPOTENCY_KEY: [400, 'Invalid idempotency key', 'Idempotency-Key must be a UUID.', 'Invalid idempotency key'],
  AUTHENTICATION_REQUIRED: [401, 'Authentication required', 'Please sign in to continue.', 'Unauthorized'],
  FORBIDDEN: [403, 'Forbidden', 'You are not allowed to perform this action.', 'Unauthorized'],
  RESOURCE_NOT_FOUND: [404, 'Resource not found', 'Resource not found.', 'Not found'],
  ALREADY_DECIDED: [409, 'Already decided', 'This expense note has already been decided.', 'Already decided'],
  INVALID_MANAGER: [409, 'Invalid manager', 'The selected manager cannot be assigned.', 'Invalid manager'],
  INVALID_EMAIL: [400, 'Invalid email', 'A valid email address is required.', 'Invalid email'],
  IDEMPOTENCY_KEY_REUSED: [422, 'Idempotency key reused', 'Idempotency-Key was already used with another receipt.'],
  INTERNAL_ERROR: [500, 'Internal server error', 'An unexpected error occurred.'],
  OCR_UNAVAILABLE: [503, 'OCR unavailable', 'Receipt analysis is temporarily unavailable.'],
  OCR_TIMEOUT: [503, 'OCR timeout', 'Receipt analysis exceeded its time limit.'],
  OCR_OVERLOADED: [503, 'OCR overloaded', 'Receipt analysis capacity has been reached.'],
} satisfies Record<ProblemCode, readonly [number, string, string, string?]>

export function problemBody(code: ProblemCode, options: { requestId?: string; errors?: FieldError[]; legacy?: string } = {}): Problem {
  const [status, title, detail, legacy] = problemCatalogue[code]
  return {
    type: `/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title, status, detail, code,
    requestId: options.requestId ?? requestContext.getStore()?.requestId ?? randomUUID(),
    error: options.legacy ?? legacy ?? detail,
    ...(options.errors?.length ? { errors: options.errors } : {}),
  }
}

export function problemResponse(code: ProblemCode, options: Parameters<typeof problemBody>[1] = {}): Response {
  const body = problemBody(code, options)
  return Response.json(body, {
    status: body.status,
    headers: {
      'Content-Type': 'application/problem+json',
      'X-Request-Id': body.requestId,
      ...(body.status === 503 ? { 'Retry-After': '5' } : {}),
    },
  })
}

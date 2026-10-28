import { problemResponse } from './problem'
import { randomUUID } from 'node:crypto'
import Ajv2020, { type ErrorObject, type ValidateFunction, type AnySchema } from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import contract from '@/generated/api-contract.json'
import type { components } from '@/types/api'

type Schemas = components['schemas']
type FieldError = NonNullable<Schemas['Problem']['errors']>[number]
type InputCode = 'VALIDATION_ERROR' | 'INVALID_JSON' | 'RECEIPT_TOO_LARGE' | 'RECEIPT_TYPE_NOT_ALLOWED' | 'INVALID_IDEMPOTENCY_KEY'

// OpenAPI annotations (including x-* policies) are not validation keywords.
// No coercion, defaults or property removal: a rejection must never change data.
const ajv = new Ajv2020({ strict: false, allErrors: true, multipleOfPrecision: 12, coerceTypes: false, useDefaults: false, removeAdditional: false })
addFormats(ajv, { mode: 'full' })
ajv.addFormat('binary', true) // File bytes are validated separately, never by a string format.
ajv.addSchema(contract, 'expense-api')
const validators = new Map<string, ValidateFunction>()

export function schemaValidator(name: keyof Schemas): ValidateFunction {
  let validator = validators.get(name)
  if (!validator) {
    validator = ajv.compile({ $ref: `expense-api#/components/schemas/${name}` })
    validators.set(name, validator)
  }
  return validator
}

const responseValidators = new WeakMap<object, ValidateFunction>()
export function compileContractSchema(schema: AnySchema): ValidateFunction {
  if (typeof schema === 'boolean') return ajv.compile(schema)
  let validate = responseValidators.get(schema)
  if (!validate) {
    // Nested local references retain the root OpenAPI document as their base URI.
    validate = ajv.compile({ $id: `expense-response-${randomUUID()}`, ...schema, components: contract.components })
    responseValidators.set(schema, validate)
  }
  return validate
}

function fieldError(error: ErrorObject): FieldError {
  const field = error.instancePath.slice(1).replaceAll('/', '.') || String(error.params.missingProperty ?? '')
  const code: FieldError['code'] = error.keyword === 'required' ? 'REQUIRED'
    : field === 'amount' ? 'INVALID_AMOUNT'
      : field === 'expenseDate' ? 'INVALID_DATE'
        : error.keyword === 'format' && error.params.format === 'uuid' ? 'INVALID_UUID'
          : error.keyword === 'additionalProperties' ? 'UNKNOWN_FIELD' : 'INVALID_TYPE'
  return { field, code, message: 'The field does not satisfy the API contract.' }
}

export class InputError extends Error {
  constructor(
    readonly code: InputCode = 'VALIDATION_ERROR',
    readonly errors: FieldError[] = [],
    readonly legacy?: string,
  ) { super(code) }
}

export function validateInput<K extends keyof Schemas>(name: K, input: unknown): Schemas[K] {
  // The reference and the TS type are both generated from the same OpenAPI schema.
  const validator = schemaValidator(name) as ValidateFunction<Schemas[K]>
  if (!validator(input)) throw new InputError('VALIDATION_ERROR', (validator.errors ?? []).map(fieldError))
  return input
}

export function validateId(id: string): void {
  if (!schemaValidator('Uuid')(id)) {
    throw new InputError('VALIDATION_ERROR', [{ field: 'id', code: 'INVALID_UUID', message: 'A UUID is required.' }])
  }
}

/** Corps JSON de la requête ; un JSON malformé donne 400 `INVALID_JSON` (ADR-004 §6). */
export async function readJsonBody(request: Request): Promise<unknown> {
  try { return await request.json() }
  catch { throw new InputError('INVALID_JSON') }
}

export async function readManagerInput(request: Request): Promise<Schemas['SetManager']> {
  return validateInput('SetManager', await readJsonBody(request))
}

export function inputProblem(error: InputError): Response {
  return problemResponse(error.code, { errors: error.errors, legacy: error.legacy })
}

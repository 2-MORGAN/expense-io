import type { AnySchema } from 'ajv'
import contract from '@/generated/api-contract.json'
import { compileContractSchema } from './validation'

type ResponseSpec = { $ref?: string; content?: Record<string, { schema: AnySchema }>; headers?: Record<string, { required?: boolean; schema?: AnySchema }> }
type Operation = { responses: Record<string, ResponseSpec> }
const api = contract as unknown as { paths: Record<string, Record<string, Operation>>; components: { responses: Record<string, ResponseSpec> } }

export function checkApiResponse(method: string, url: string, status: number, headers: Record<string, string>, body: unknown): void {
  const pathname = new URL(url, 'http://localhost').pathname
  const path = Object.keys(api.paths).find((candidate) => {
    const pattern = candidate.split('/').map((part) => part.startsWith('{') ? '[^/]+' : part).join('/')
    return new RegExp(`^${pattern}$`).test(pathname)
  })
  if (!path || !api.paths[path][method.toLowerCase()]) throw new Error(`Undocumented operation: ${method} ${pathname}`)
  let response = api.paths[path][method.toLowerCase()].responses[String(status)]
  if (!response) throw new Error(`Undocumented status: ${method} ${path} → ${status}`)
  if (response.$ref) response = api.components.responses[response.$ref.split('/').at(-1)!]
  const mediaType = headers['content-type']?.split(';')[0].trim()
  const schema = response.content?.[mediaType]
  if (!schema) throw new Error(`Undocumented Content-Type: ${method} ${path} → ${status} ${mediaType}`)
  const validate = compileContractSchema(schema.schema)
  if (!validate(body)) throw new Error(`Contract mismatch: ${method} ${path} → ${status}: ${JSON.stringify(validate.errors)}`)
  if (mediaType === 'application/problem+json' && (body as { status?: number }).status !== status) throw new Error('Problem status differs from HTTP status')
  for (const [name, spec] of Object.entries(response.headers ?? {})) {
    const value = headers[name.toLowerCase()]
    if (spec.required && value === undefined) throw new Error(`Missing response header: ${name}`)
    if (value !== undefined && spec.schema && !compileContractSchema(spec.schema)(value)) throw new Error(`Invalid response header: ${name}`)
  }
}

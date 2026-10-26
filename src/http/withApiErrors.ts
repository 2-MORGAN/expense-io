import { randomUUID } from 'node:crypto'
import { respondError } from './errors'
import { requestContext } from './requestContext'

/** Covers authentication, parsing, use case, transaction completion and serialization.
 * Session/role authorization stays in requireRole (ADR-004, no second guard).
 */
export function withApiErrors<Args extends unknown[]>(route: string, handler: (...args: Args) => Response | Promise<Response>) {
  return async (...args: Args): Promise<Response> => requestContext.run({
    requestId: randomUUID(), route,
    method: args[0] instanceof Request ? args[0].method : 'GET',
  }, async () => {
    try {
      return await handler(...args)
    } catch (error) {
      return respondError(error)
    }
  })
}

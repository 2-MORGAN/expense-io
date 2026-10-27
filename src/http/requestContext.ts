import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  requestId: string
  method: string
  route: string
  userId?: string
  companyId?: string
}

// One server-generated correlation id per execution, isolated across concurrent requests.
export const requestContext = new AsyncLocalStorage<RequestContext>()

import { vi } from 'vitest'
import type { components } from '@/types/api'

// Réseau des tests de composants : `fetch` remplacé par des réponses écrites
// route par route, au format du contrat. Un appel sans route prévue fait
// échouer le test : un composant qui appelle une URL inattendue se voit.

type Problem = components['schemas']['Problem']

export interface Route {
  method?: string
  path: string | RegExp
  reply: (init: RequestInit) => Response | Promise<Response>
}

export interface Call {
  method: string
  path: string
  init: RequestInit
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Erreur au format du contrat (`application/problem+json`, ADR-004). */
export function problem(code: Problem['code'], status: number, extra: Partial<Problem> = {}): Response {
  const body = { type: `/problems/${code.toLowerCase()}`, title: code, status, detail: 'Detail in English, never shown.', code, requestId: 'test', error: 'legacy', ...extra }
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/problem+json' } })
}

/**
 * Remplace `fetch` ; la dernière route qui correspond l'emporte, ce qui permet
 * de changer une réponse en cours de test (`routes.push(…)`). Rend la liste des
 * appels, dans l'ordre.
 */
function pathOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.pathname : new URL(input.url).pathname
}

export function stubFetch(routes: Route[]): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = pathOf(input)
      const method = (init.method ?? 'GET').toUpperCase()
      calls.push({ method, path, init })
      const route = [...routes]
        .reverse()
        .find((candidate) => (candidate.method ?? 'GET') === method && (typeof candidate.path === 'string' ? candidate.path === path : candidate.path.test(path)))
      if (!route) throw new Error(`fetch inattendu : ${method} ${path}`)
      return route.reply(init)
    })
  )
  return calls
}

import { describe, expect, it } from 'vitest'
import type { SourceFile } from './graph'
import { routeGuards } from './routes'

// La garde de chaque méthode de route (routes.ts), lue dans le handler :
// l'idiome requireRole vérifié, la vérification de session des handlers OCR,
// les routes publiques déclarées. Tout le reste compte comme sans garde.

const route = (path: string, ...lines: string[]): SourceFile => ({
  path: `src/app/api/${path}/route.ts`,
  text: `${lines.join('\n')}\n`,
})

const guarded = (role?: string) => [
  'const session = await auth()',
  `const actor = requireRole(session${role ? `, '${role}'` : ''})`,
  'if (actor instanceof Response) return actor',
  'return Response.json({ ok: true })',
]

describe('gardes des routes', () => {
  it('requireRole avec un rôle, ou sans rôle pour une simple session', () => {
    const { methods } = routeGuards(
      [
        route('hr/users', 'export async function GET() {', ...guarded('hr_admin'), '}'),
        route('notes', 'export const POST = async () => {', ...guarded(), '}'),
      ],
      []
    )
    expect(methods).toEqual([
      { method: 'GET', route: '/api/hr/users', guard: { kind: 'role', role: 'hr_admin' } },
      { method: 'POST', route: '/api/notes', guard: { kind: 'session' } },
    ])
  })

  it('un résultat de requireRole non vérifié, ou une garde dans un callback, ne protègent pas la route', () => {
    const { methods } = routeGuards(
      [
        route('a', 'export async function GET() {', "requireRole(await auth(), 'manager')", 'return Response.json([])', '}'),
        route('b', 'export async function GET() {', "const actor = requireRole(await auth(), 'manager')", 'return Response.json(actor)', '}'),
        route('c', 'export async function GET() {', 'return run(async () => {', ...guarded('manager'), '})', '}'),
        route('d', 'export async function GET() {', 'return Response.json([])', '}'),
      ],
      []
    )
    expect(methods.map((m) => [m.route, m.guard.kind])).toEqual([
      ['/api/a', 'none'],
      ['/api/b', 'none'],
      ['/api/c', 'none'],
      ['/api/d', 'none'],
    ])
    expect(methods[1].guard).toMatchObject({ reason: expect.stringMatching(/actor n’est pas vérifié/) })
  })

  it('la vérification de session des handlers OCR, suivie à travers un export … from', () => {
    const handlers: SourceFile = {
      path: 'src/http/ocr.ts',
      text: [
        'export async function suggest() {',
        '  const session = await auth()',
        "  if (!session?.user?.id) throw new OcrError('AUTHENTICATION_REQUIRED')",
        '  return Response.json({})',
        '}',
        'export async function open() {',
        '  return Response.json({})',
        '}',
      ].join('\n'),
    }
    const { methods } = routeGuards(
      [
        handlers,
        route('suggestion', "export { suggest as POST } from '@/http/ocr'"),
        route('open', "export { open as GET } from '../../../http/ocr'"),
        route('missing', "export { gone as GET } from '@/http/ocr'"),
      ],
      []
    )
    expect(methods).toEqual([
      { method: 'GET', route: '/api/missing', guard: { kind: 'none', reason: 'handler introuvable : gone de @/http/ocr' } },
      { method: 'GET', route: '/api/open', guard: expect.objectContaining({ kind: 'none' }) },
      { method: 'POST', route: '/api/suggestion', guard: { kind: 'session' } },
    ])
  })

  it('un wrapper se traverse : la garde se lit dans la fonction enveloppée, jusque dans un export … from', () => {
    const handlers: SourceFile = {
      path: 'src/http/ocr.ts',
      text: [
        "export const suggest = withApiErrors('/api/s', async function suggest() {",
        ...guarded(),
        '})',
      ].join('\n'),
    }
    const { methods } = routeGuards(
      [
        handlers,
        route('a', "export const GET = withApiErrors('/api/a', async function GET() {", ...guarded('manager'), '})'),
        route('b', "export const GET = withApiErrors('/api/b', async () => Response.json([]))"),
        route('s', "export { suggest as POST } from '@/http/ocr'"),
      ],
      []
    )
    expect(methods.map((m) => [m.route, m.guard])).toEqual([
      ['/api/a', { kind: 'role', role: 'manager' }],
      ['/api/b', expect.objectContaining({ kind: 'none' })],
      ['/api/s', { kind: 'session' }],
    ])
  })

  it('export * cache les méthodes : la route compte comme non analysable', () => {
    const { methods } = routeGuards([route('all', "export * from '@/http/ocr'")], [])
    expect(methods).toEqual([
      { method: '*', route: '/api/all', guard: { kind: 'none', reason: "handler non analysable : export * from '@/http/ocr'" } },
    ])
  })

  it('une route publique se déclare ; une entrée publique sans route est signalée', () => {
    const result = routeGuards(
      [route('auth/[...nextauth]', "import { handlers } from '@/lib/auth'", 'export const { GET, POST } = handlers')],
      ['GET /api/auth/[...nextauth]', 'GET /api/old']
    )
    expect(result.methods).toEqual([
      { method: 'GET', route: '/api/auth/[...nextauth]', guard: { kind: 'public' } },
      {
        method: 'POST',
        route: '/api/auth/[...nextauth]',
        guard: { kind: 'none', reason: 'handler non analysable : handlers' },
      },
    ])
    expect(result.stalePublic).toEqual(['GET /api/old'])
  })

  it('chemin d’URL sans les groupes (nom), trié par chemin puis par méthode', () => {
    const { methods } = routeGuards(
      [
        route('(admin)/z/[id]', 'export async function DELETE() {', ...guarded('hr_admin'), '}', 'export async function GET() {', ...guarded('hr_admin'), '}'),
        route('a', 'export async function POST() {', ...guarded(), '}'),
        { path: 'src/app/api/a/helpers.ts', text: 'export async function GET() {}\n' },
      ],
      []
    )
    expect(methods.map((m) => `${m.method} ${m.route}`)).toEqual(['POST /api/a', 'GET /api/z/[id]', 'DELETE /api/z/[id]'])
  })
})

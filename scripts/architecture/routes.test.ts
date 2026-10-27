import { describe, expect, it } from 'vitest'
import type { SourceFile } from './graph'
import { routeGuards } from './routes'

// La garde de chaque méthode de route (routes.ts), lue dans le handler : elle
// doit l'ouvrir, sur la session de `await auth()`, avec le requireRole et le
// auth du projet. Tout le reste compte comme sans garde : les contournements
// ci-dessous viennent d'une relecture indépendante.

const IMPORTS = ["import { auth } from '@/lib/auth'", "import { requireRole } from '@/http/requireRole'"]

/** Un fichier de route, avec les imports du projet. */
const route = (path: string, ...lines: string[]): SourceFile => ({
  path: `src/app/api/${path}/route.ts`,
  text: `${[...IMPORTS, ...lines].join('\n')}\n`,
})

const guarded = (role?: string) => {
  const args = role ? `session, '${role}'` : 'session'
  return [
    'const session = await auth()',
    `const actor = requireRole(${args})`,
    'if (actor instanceof Response) return actor',
    'return Response.json({ ok: true })',
  ]
}

describe('gardes des routes', () => {
  it('requireRole avec un rôle, ou sans rôle pour une simple session ; la session peut s’écrire en ligne', () => {
    const { methods } = routeGuards(
      [
        route('hr/users', 'export async function GET() {', ...guarded('hr_admin'), '}'),
        route('notes', 'export const POST = async () => {', ...guarded(), '}'),
        route(
          'inline',
          'export async function GET() {',
          "const actor = requireRole(await auth(), 'manager')",
          'if (actor instanceof Response) {',
          '  return actor',
          '}',
          'return Response.json([])',
          '}'
        ),
      ],
      []
    )
    expect(methods).toEqual([
      { method: 'GET', route: '/api/hr/users', guard: { kind: 'role', role: 'hr_admin' } },
      { method: 'GET', route: '/api/inline', guard: { kind: 'role', role: 'manager' } },
      { method: 'POST', route: '/api/notes', guard: { kind: 'session' } },
    ])
  })

  it('la garde peut ouvrir un try dont le catch sort, comme dans les routes actuelles', () => {
    const { methods } = routeGuards(
      [
        route(
          'a',
          'export async function POST() {',
          'let draft: string | undefined',
          'try {',
          ...guarded('manager'),
          '} catch (error) {',
          '  return respondError(error)',
          '}',
          '}'
        ),
      ],
      []
    )
    expect(methods[0].guard).toEqual({ kind: 'role', role: 'manager' })
  })

  it.each([
    [
      'données renvoyées avant la garde',
      'const session = await auth()',
      "if (new URL(request.url).searchParams.has('all')) return Response.json(await listAllUsers())",
      "const actor = requireRole(session, 'hr_admin')",
      'if (actor instanceof Response) return actor',
    ],
    [
      'vérification sous condition',
      "const actor = requireRole(await auth(), 'hr_admin')",
      "if (process.env.ENFORCE_AUTH === 'true') {",
      '  if (actor instanceof Response) return actor',
      '}',
    ],
    [
      'effet de bord avant la vérification',
      "const actor = requireRole(await auth(), 'hr_admin')",
      'await deleteUser(await request.text())',
      'if (actor instanceof Response) return actor',
    ],
    [
      'garde dans une seule branche',
      'const body = await request.json()',
      'if (body.managerId) {',
      "  const actor = requireRole(await auth(), 'hr_admin')",
      '  if (actor instanceof Response) return actor',
      '}',
    ],
    [
      'exception de la garde avalée par le catch',
      "let userId = 'anonymous'",
      'try {',
      '  const session = await auth()',
      "  if (!session?.user?.id) throw new Error('unauthenticated')",
      '  userId = session.user.id',
      '} catch { /* anonyme */ }',
    ],
    [
      'session fournie par le client',
      "const session = JSON.parse(request.headers.get('x-session') ?? 'null')",
      "const actor = requireRole(session, 'hr_admin')",
      'if (actor instanceof Response) return actor',
    ],
    [
      'garde inatteignable',
      'return Response.json(await listAllUsers())',
      "const actor = requireRole(await auth(), 'hr_admin')",
      'if (actor instanceof Response) return actor',
    ],
    [
      'vérification avant l’appel (var remontée)',
      'if (actor instanceof Response) return actor',
      "var actor = requireRole(await auth(), 'hr_admin')",
    ],
    [
      'session : une autre propriété que user ou id',
      'const session = await auth()',
      'if (!session?.user?.isDemoDisabled) throw new Error()',
    ],
    ['session : un return au lieu d’un throw', 'const session = await auth()', 'if (!session) return Response.json(await listAllUsers())'],
    ['aucune garde', 'return Response.json(await listAllUsers())'],
  ])('ne compte pas comme gardée : %s', (_name, ...body) => {
    const { methods } = routeGuards([route('x', 'export async function GET(request: Request) {', ...body, '}')], [])
    expect(methods[0].guard.kind).toBe('none')
  })

  it('ne comptent pas non plus : requireRole local, auth d’ailleurs, handler réassignable, wrapper inconnu, export déstructuré', () => {
    const bare = (path: string, ...lines: string[]): SourceFile => ({ path: `src/app/api/${path}/route.ts`, text: lines.join('\n') })
    const { methods } = routeGuards(
      [
        bare(
          'local',
          "import { auth } from '@/lib/auth'",
          "const requireRole = (_s: unknown, _r?: string) => ({ id: 'x' })",
          'export async function GET() {',
          ...guarded('hr_admin'),
          '}'
        ),
        bare(
          'other-auth',
          "import { auth } from '@/lib/fake-auth'",
          "import { requireRole } from '@/http/requireRole'",
          'export async function GET() {',
          ...guarded('hr_admin'),
          '}'
        ),
        route('let', 'export let GET = async () => {', ...guarded('hr_admin'), '}', 'GET = async () => Response.json([])'),
        route('wrapper', 'export const GET = withFallback(async () => Response.json([]), async () => {', ...guarded(), '})'),
        route('array', 'export const [GET, POST] = [listAll, createNote]'),
        route('nested', "import mod from '@/lib/x'", 'export const { handlers: { GET } } = mod'),
      ],
      []
    )
    expect(methods.map((m) => `${m.method} ${m.route} ${m.guard.kind}`)).toEqual([
      'GET /api/array none',
      'POST /api/array none',
      'GET /api/let none',
      'GET /api/local none',
      'GET /api/nested none',
      'GET /api/other-auth none',
      'GET /api/wrapper none',
    ])
  })

  it('la vérification de session des handlers OCR, suivie à travers un export … from', () => {
    const handlers: SourceFile = {
      path: 'src/http/ocr.ts',
      text: [
        "import { auth } from '@/lib/auth'",
        'export async function suggest() {',
        '  let reservation: string | undefined',
        '  try {',
        '    const session = await auth()',
        "    if (!session?.user?.id) throw new OcrError('AUTHENTICATION_REQUIRED')",
        '    return Response.json({})',
        '  } catch (error) { return ocrProblem(error) }',
        '  finally { reservation = undefined }',
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

  it('un wrapper déclaré (withApiErrors) se traverse : la garde se lit dans la fonction enveloppée', () => {
    const handlers: SourceFile = {
      path: 'src/http/ocr.ts',
      text: [...IMPORTS, "export const suggest = withApiErrors('/api/s', async function suggest() {", ...guarded(), '})'].join('\n'),
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
        guard: { kind: 'none', reason: 'handler non analysable : { GET, POST } = handlers' },
      },
    ])
    expect(result.stalePublic).toEqual(['GET /api/old'])
  })

  it('toute route de src/app compte, hors de api/ aussi ; chemin sans les groupes (nom), trié par chemin puis par méthode', () => {
    const plain = (path: string, text: string): SourceFile => ({ path, text })
    const { methods } = routeGuards(
      [
        route('(admin)/z/[id]', 'export async function DELETE() {', ...guarded('hr_admin'), '}', 'export async function GET() {', ...guarded('hr_admin'), '}'),
        route('a', 'export async function POST() {', ...guarded(), '}'),
        plain('src/app/api/a/helpers.ts', 'export async function GET() {}\n'),
        plain('src/app/hr/export/route.ts', 'export async function GET() { return Response.json([]) }\n'),
        plain('src/app/(internal)/api/x/route.ts', 'export async function GET() { return Response.json([]) }\n'),
      ],
      []
    )
    expect(methods.map((m) => `${m.method} ${m.route} ${m.guard.kind}`)).toEqual([
      'POST /api/a session',
      'GET /api/x none',
      'GET /api/z/[id] role',
      'DELETE /api/z/[id] role',
      'GET /hr/export none',
    ])
  })
})

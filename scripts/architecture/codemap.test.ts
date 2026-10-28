import { describe, expect, it } from 'vitest'
import { apiCalls, callMatches, codemap, migrationFunctions, urlPath, type CodemapInputs } from './codemap'
import type { RouteMethod } from './routes'

// La carte du code (CODEMAP.md) sur un mini-dépôt : ce qu'elle range sous
// chaque route, ce qu'elle laisse au socle, et comment elle relie routes,
// tables et specs E2E.

const file = (path: string, text: string) => ({ path, text })

const ROUTE = (useCase: string) => `import { requireRole } from '@/http/requireRole'
import { ${useCase} } from '@/composition/notes'
export async function POST() { requireRole(); return ${useCase}.execute() }
`

const sources = [
  file('src/app/api/notes/[id]/approve/route.ts', ROUTE('approveNote')),
  file('src/app/api/notes/route.ts', ROUTE('listNotes')),
  file(
    'src/composition/notes.ts',
    `import { ApproveNote } from '@/application/ApproveNote'
import { ListNotes } from '@/application/ListNotes'
import { PgNotes } from '@/adapters/PgNotes'
const repository = new PgNotes()
export const approveNote = new ApproveNote(repository)
export const listNotes = new ListNotes()
`
  ),
  file('src/application/ApproveNote.ts', `import type { NoteRepository } from '@/ports/NoteRepository'\nexport class ApproveNote {}\n`),
  file('src/application/ApproveNote.test.ts', `import { ApproveNote } from './ApproveNote'\n`),
  file('src/application/ListNotes.ts', 'export class ListNotes {}\n'),
  file('src/ports/NoteRepository.ts', `import type { Note } from '@/domain/Note'\nexport interface NoteRepository {}\n`),
  file('src/domain/Note.ts', 'export interface Note {}\n'),
  file('src/adapters/PgNotes.ts', `const SQL = 'UPDATE notes SET status = $1 WHERE id = approve_note($2)'\nexport class PgNotes {}\n`),
  file('src/http/requireRole.ts', `import { getPool } from '@/lib/db'\nexport const requireRole = () => getPool()\n`),
  file('src/lib/db.ts', `const q = 'SELECT 1 FROM users'\nexport const getPool = () => q\n`),
  file('src/app/notes/page.tsx', `import { Panel } from '@/components/Panel'\nexport default Panel\n`),
  file('src/components/Panel.tsx', 'export const Panel = () => fetch(`/api/notes/${id}/approve`)\n'),
]

const methods: RouteMethod[] = [
  { method: 'POST', route: '/api/notes', guard: { kind: 'session' } },
  { method: 'POST', route: '/api/notes/[id]/approve', guard: { kind: 'role', role: 'manager' } },
]

const inputs: CodemapInputs = {
  sources,
  methods,
  tables: ['notes', 'users'],
  sqlFunctions: ['approve_note'],
  specs: [file('e2e/notes.spec.ts', "await api.post(`/api/notes/${noteId}/approve`)\nawait api.get('/api/other')\n")],
}

/** Le bloc d'une rubrique (`### …`) de la carte. */
const block = (map: string, title: string): string => map.split('\n### ').find((b) => b.startsWith(title)) ?? ''

describe('codemap', () => {
  const map = codemap(inputs)

  it('range sous une route les seuls cas d’usage de la composition qu’elle importe', () => {
    const approve = block(map, '`/api/notes/[id]/approve`')
    expect(approve).toContain('- POST : rôle `manager`')
    expect(approve).toContain('`src/application/ApproveNote.ts`')
    expect(approve).toContain('`src/adapters/PgNotes.ts`')
    expect(approve).not.toContain('ListNotes')
    const list = block(map, '`/api/notes`\n')
    expect(list).toContain('`src/application/ListNotes.ts`')
    expect(list).not.toContain('ApproveNote')
    expect(list).not.toContain('PgNotes')
  })

  it('ne montre le domaine que s’il est importé hors du cœur, et jamais les tests', () => {
    const approve = block(map, '`/api/notes/[id]/approve`')
    expect(approve).toContain('`src/ports/NoteRepository.ts`')
    expect(approve).not.toContain('src/domain/Note.ts')
    expect(map).not.toContain('ApproveNote.test.ts')
  })

  it('met au socle ce qu’atteignent la moitié des routes, sans le suivre ni y lire du SQL', () => {
    expect(map).toMatch(/Socle commun[\s\S]*`src\/http\/requireRole\.ts`/)
    const approve = block(map, '`/api/notes/[id]/approve`')
    expect(approve).not.toContain('requireRole')
    expect(approve).toContain('- Tables : `notes`')
    expect(approve).not.toContain('users')
    expect(approve).toContain('- Fonctions SQL : `approve_note`')
  })

  it('relie route, spec E2E et page qui l’appelle', () => {
    expect(block(map, '`/api/notes/[id]/approve`')).toContain('- E2E : `e2e/notes.spec.ts`')
    expect(block(map, '`/api/notes`\n')).toContain('aucune spec ne cite cette route')
    const page = block(map, '`/notes`')
    expect(page).toContain('`src/components/Panel.tsx`')
    expect(page).toContain('- Routes appelées : `/api/notes/[id]/approve`')
  })

  it('est déterministe, quel que soit l’ordre des fichiers', () => {
    expect(codemap({ ...inputs, sources: [...sources].reverse() })).toBe(map)
  })
})

describe('chemins et appels', () => {
  it('donne l’URL d’un fichier de route ou de page, sans groupes ni emplacements', () => {
    expect(urlPath('src/app/api/notes/[id]/route.ts')).toBe('/api/notes/[id]')
    expect(urlPath('src/app/(public)/@modal/login/page.tsx')).toBe('/login')
    expect(urlPath('src/app/page.tsx')).toBe('/')
    expect(urlPath('src/lib/db.ts')).toBeUndefined()
  })

  it('lit les chemins d’API cités, gabarits compris', () => {
    expect(apiCalls("get('/api/a?sort=x'); post(`/api/b/${id}/${decision}`)")).toEqual(['/api/a', '/api/b/*/*'])
  })

  it('apparie un appel aux segments dynamiques d’une route', () => {
    expect(callMatches('/api/notes/[id]/approve', '/api/notes/*/approve')).toBe(true)
    expect(callMatches('/api/notes/[id]/approve', '/api/notes/42/*')).toBe(true)
    expect(callMatches('/api/notes/[id]/approve', '/api/notes/42')).toBe(false)
    expect(callMatches('/api/notes', '/api/notes/')).toBe(true)
    expect(callMatches('/api/auth/[...nextauth]', '/api/auth/callback/credentials')).toBe(true)
    expect(callMatches('/api/auth/[...nextauth]', '/api/auth')).toBe(false)
  })

  it('lit les fonctions SQL créées par la partie « Up » des migrations', () => {
    const migration = file(
      'migrations/1.sql',
      'CREATE OR REPLACE FUNCTION public.register_user(x text)\n-- Down Migration\nCREATE FUNCTION old_one()\n'
    )
    expect(migrationFunctions([migration])).toEqual(['register_user'])
  })
})

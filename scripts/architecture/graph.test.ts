import { describe, expect, it } from 'vitest'
import { layerGraph, layerOf, type Architecture, type SourceFile } from './graph'

// Le graphe des couches (graph.ts) : chaque import jugé selon la matrice,
// une flèche par paire, les exceptions legacy qui ne font que raccourcir, et
// ce que le graphe ne sait pas juger signalé au lieu d'être ignoré.

const ARCH: Architecture = {
  layers: [
    { path: 'src/app', group: 'entrees', may: [] },
    { path: 'src/app/api', group: 'entrees', may: ['src/application', 'src/domain'] },
    { path: 'src/application', group: 'coeur', may: ['src/domain', 'src/ports'] },
    { path: 'src/domain', group: 'coeur', may: [] },
    { path: 'src/ports', group: 'coeur', may: ['src/domain'] },
    { path: 'src/lib/db', group: 'infra', may: ['pg'] },
  ],
  packages: [
    { name: '@aws-sdk', packages: ['@aws-sdk/*'] },
    { name: 'pg', packages: ['pg'] },
  ],
  legacy: [{ from: 'src/app/api', to: 'src/lib/db', why: 'test' }],
}

const file = (path: string, ...lines: string[]): SourceFile => ({ path, text: `${lines.join('\n')}\n` })

const FILES = [
  file(
    'src/app/api/notes/route.ts',
    `import { decide } from '@/application/decide'`,
    `import { pool } from '@/lib/db'`,
    `import { pool as again } from '../../../lib/db'`
  ),
  file('src/application/decide.ts', `import type { Note } from '../domain/Note'`, `import { S3Client } from '@aws-sdk/client-s3'`),
  file('src/domain/Note.ts', 'export type Note = { id: string }'),
  file('src/lib/db.ts', `import { Pool } from 'pg'`, 'export const pool = new Pool()'),
]

describe('graphe des couches', () => {
  it('une flèche par paire de couches, jugée selon la matrice : permise, legacy ou interdite', () => {
    const graph = layerGraph(FILES, ARCH)
    expect(graph.edges).toEqual([
      { from: 'src/app/api', to: 'src/application', verdict: 'allowed' },
      { from: 'src/app/api', to: 'src/lib/db', verdict: 'legacy' },
      { from: 'src/application', to: '@aws-sdk', verdict: 'forbidden' },
      { from: 'src/application', to: 'src/domain', verdict: 'allowed' },
      { from: 'src/lib/db', to: 'pg', verdict: 'allowed' },
    ])
    expect(graph.modules).toEqual(['src/app/api', 'src/application', 'src/domain', 'src/lib/db', '@aws-sdk', 'pg'])
    expect(graph).toMatchObject({ unclassified: [], unsure: [], staleLegacy: [] })
  })

  it('la couche la plus précise gagne, à la frontière d’un segment de chemin', () => {
    expect(layerOf('src/app/api/notes/route.ts', ARCH.layers)?.path).toBe('src/app/api')
    expect(layerOf('src/app/login/page.tsx', ARCH.layers)?.path).toBe('src/app')
    expect(layerOf('src/lib/db.ts', ARCH.layers)?.path).toBe('src/lib/db')
    expect(layerOf('src/lib/dbx.ts', ARCH.layers)).toBeUndefined()
    expect(layerOf('src/domain/receipt', ARCH.layers)?.path).toBe('src/domain')
  })

  it('ni les tests, ni un import cité dans une chaîne ou un commentaire, ni un paquet non dessiné ne comptent', () => {
    const graph = layerGraph(
      [
        file('src/domain/Note.test.ts', `import { Pool } from 'pg'`),
        file(
          'src/domain/Note.ts',
          `const text = "import { Pool } from 'pg'"`,
          `// import { pool } from '@/lib/db'`,
          `import { readFileSync } from 'node:fs'`,
          `import { z } from 'zod'`
        ),
      ],
      { ...ARCH, legacy: [] }
    )
    expect(graph.edges).toEqual([])
    expect(graph.modules).toEqual(['src/domain'])
  })

  it('un fichier ou un import hors des couches, et un import au chemin calculé, sont signalés', () => {
    const graph = layerGraph(
      [
        file('src/misc/x.ts', 'export const x = 1'),
        file('src/domain/a.ts', `import { db } from '../../e2e/support/db'`),
        file('src/application/b.ts', 'export const load = (name: string) => import(`./${name}`)'),
      ],
      { ...ARCH, legacy: [] }
    )
    expect(graph.unclassified).toEqual(['src/domain/a.ts → e2e/support/db', 'src/misc/x.ts'])
    expect(graph.unsure).toEqual(['src/application/b.ts'])
  })

  it('une exception legacy disparue, ou devenue permise, ne sert plus : elle est signalée', () => {
    expect(layerGraph(FILES.slice(1), ARCH).staleLegacy).toEqual(['src/app/api → src/lib/db'])
    const permitted: Architecture = {
      ...ARCH,
      layers: ARCH.layers.map((l) => (l.path === 'src/app/api' ? { ...l, may: [...l.may, 'src/lib/db'] } : l)),
    }
    expect(layerGraph(FILES, permitted).staleLegacy).toEqual(['src/app/api → src/lib/db'])
  })

  it('déterministe : le même graphe quel que soit l’ordre de lecture des fichiers', () => {
    expect(layerGraph([...FILES].reverse(), ARCH)).toEqual(layerGraph(FILES, ARCH))
  })

  it('une déclaration qui vise une couche ou un paquet inconnu est refusée', () => {
    const typo: Architecture = { ...ARCH, layers: [{ path: 'src/domain', group: 'coeur', may: ['src/port'] }] }
    expect(() => layerGraph(FILES, typo)).toThrow(/src\/domain peut importer src\/port/)
  })
})

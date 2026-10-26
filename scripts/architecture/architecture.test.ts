import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyze, readSources, README } from './architecture'
import { edgeName } from './graph'
import { readmeWith } from './mermaid'
import { routeName } from './routes'

// Les graphes de docs/architecture, régénérés depuis le code de src/ et
// comparés octet pour octet aux fichiers versionnés : un import entre couches
// ou une route qui change sans que son graphe suive fait échouer ce test. Les
// autres vérifications ne se règlent pas en régénérant : une flèche interdite
// ou une route sans garde restent rouges (docs/architecture/README.md).

const root = process.cwd()
const analysis = analyze(readSources(root))

const read = (file: string): string | undefined => {
  try {
    return readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n')
  } catch {
    return undefined
  }
}

const REGENERATE = 'régénérer avec npm run generate:architecture, relire le diff, puis le commiter'

describe('architecture du dépôt (docs/architecture)', () => {
  it.each(Object.entries(analysis.graphs))('%s est à jour avec le code', (file, text) => {
    expect(read(file), `${file} a dérivé du code : ${REGENERATE}`).toBe(text)
  })

  it('le README recopie les graphes à jour', () => {
    const readme = read(README) ?? ''
    expect(readme, `${README} : ${REGENERATE}`).toBe(readmeWith(readme, analysis.graphs))
  })

  it('aucune flèche interdite entre couches', () => {
    const forbidden = analysis.layers.edges.filter((e) => e.verdict === 'forbidden').map(edgeName)
    expect(forbidden, 'corriger l’import (cas d’usage, port, composition) ; un nouveau droit se justifie dans la PR (ADR-002)').toEqual([])
  })

  it('chaque fichier de src/ appartient à une couche, et chaque import se lit', () => {
    expect(analysis.layers.unclassified, 'déclarer la couche dans scripts/architecture/layers.ts').toEqual([])
    expect(analysis.layers.unsure, 'écrire le chemin de l’import en toutes lettres').toEqual([])
  })

  it('chaque exception de LEGACY_EDGES sert encore', () => {
    expect(analysis.layers.staleLegacy, 'retirer l’exception de layers.ts : la liste ne fait que raccourcir').toEqual([])
  })

  it('chaque méthode de route a une garde', () => {
    const unguarded = analysis.routes.methods.flatMap((m) =>
      m.guard.kind === 'none' ? [`${routeName(m)} : ${m.guard.reason}`] : []
    )
    expect(unguarded, 'CLAUDE.md, règle 2 : autorisation côté serveur, à chaque route').toEqual([])
  })

  it('chaque route publique déclarée existe', () => {
    expect(analysis.routes.stalePublic, 'retirer l’entrée de PUBLIC_ROUTES').toEqual([])
  })
})

describe('lecture de src/', () => {
  it('lit les fichiers de code, dossiers cachés compris, triés et sans BOM', () => {
    const dir = mkdtempSync(join(tmpdir(), 'expense-io-sources-'))
    try {
      mkdirSync(join(dir, 'src/.hidden'), { recursive: true })
      writeFileSync(join(dir, 'src/b.ts'), '﻿export const b = 1\n')
      writeFileSync(join(dir, 'src/.hidden/a.ts'), 'export const a = 1\n')
      writeFileSync(join(dir, 'src/style.css'), 'a {}\n')
      expect(readSources(dir)).toEqual([
        { path: 'src/.hidden/a.ts', text: 'export const a = 1\n' },
        { path: 'src/b.ts', text: 'export const b = 1\n' },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

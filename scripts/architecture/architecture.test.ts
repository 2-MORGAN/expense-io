import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyze, codemapFor, readSources, README } from './architecture'
import { CODEMAP } from './codemap'
import { DATA_VIEW, DIAGRAMS, DOC_PAGE, docGaps, pageDiagrams, pageWith, readDocInputs, readViews } from './docs'
import { edgeName } from './graph'
import { fileImports } from './imports'
import { readmeWith } from './mermaid'
import { routeName } from './routes'

// Les graphes de docs/architecture, régénérés depuis le code de src/ et
// comparés octet pour octet aux fichiers versionnés : un import entre couches
// ou une route qui change sans que son graphe suive fait échouer ce test. Les
// autres vérifications ne se règlent pas en régénérant : une flèche interdite
// ou une route sans garde restent rouges (docs/architecture/README.md). La
// page des développeurs (docs/index.html) recopie ces graphes et les vues
// écrites à la main, et présente chaque ADR, table et type d'événement.

const root = process.cwd()
const sources = readSources(root)
const analysis = analyze(sources)

const read = (file: string): string | undefined => {
  try {
    return readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n')
  } catch {
    return undefined
  }
}

// Directive en tête de fichier (commentaires et lignes vides tolérés avant).
const isClientModule = (text: string): boolean =>
  /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use client['"]/.test(text)

const REGENERATE = 'régénérer avec npm run generate:architecture, relire le diff, puis le commiter'

describe('architecture du dépôt (docs/architecture)', () => {
  it.each(Object.entries(analysis.graphs))('%s est à jour avec le code', (file, text) => {
    expect(read(file), `${file} a dérivé du code : ${REGENERATE}`).toBe(text)
  })

  it(`${CODEMAP} est à jour avec le code`, () => {
    expect(read(CODEMAP), `${CODEMAP} a dérivé du code : ${REGENERATE}`).toBe(codemapFor(root, sources, analysis))
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

  it('aucun fichier \'use client\' n’importe la composition (ADR-002 §3.3)', () => {
    // La composition branche les adaptateurs (pg, S3…) : elle ne s'exécute que
    // côté serveur. Seul un composant serveur appelle un cas d'usage.
    const offenders = readSources(root)
      .filter((file) => isClientModule(file.text))
      .filter((file) => (fileImports(file.path, file.text) ?? []).some((spec) => spec.startsWith('@/composition')))
      .map((file) => file.path)
    expect(offenders, 'passer par une route fine ou un composant serveur').toEqual([])
  })

  it('reconnaît la directive \'use client\'', () => {
    expect(isClientModule("'use client'\nimport x from 'y'\n")).toBe(true)
    expect(isClientModule('// commentaire\n"use client"\n')).toBe(true)
    expect(isClientModule("import x from 'y'\n'use client'\n")).toBe(false)
    expect(isClientModule('export default function Page() {}\n')).toBe(false)
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

describe(`page des développeurs (${DOC_PAGE})`, () => {
  const page = read(DOC_PAGE) ?? ''
  const diagrams = pageDiagrams(analysis.graphs, readViews(root))
  const gaps = docGaps(page, diagrams, readDocInputs(root, sources))

  it('chaque schéma a ses marqueurs dans la page, chaque marqueur son schéma', () => {
    expect(gaps.unplaced, `placer <!-- début : nom.mmd --> et <!-- fin : nom.mmd --> dans la page, puis ${REGENERATE}`).toEqual([])
    expect(gaps.staleMarkers, 'retirer les marqueurs de la page, ou rétablir le schéma').toEqual([])
  })

  it('recopie les schémas à jour', () => {
    expect(page, `${DOC_PAGE} : ${REGENERATE}`).toBe(pageWith(page, diagrams))
  })

  it('charge ses scripts externes avec une empreinte SRI', () => {
    expect(gaps.scripts, 'ajouter integrity="sha384-…" et crossorigin="anonymous" (commande en commentaire dans la page)').toEqual([])
  })

  it('présente chaque ADR de docs/adr', () => {
    expect(gaps.adrs, 'ajouter sa fiche (id="adr-NNN") à la section ADR de la page').toEqual([])
  })

  it('le schéma des données a chaque table des migrations, et rien d’autre', () => {
    expect(gaps.tables, `ajouter la table à ${DIAGRAMS}/${DATA_VIEW}`).toEqual([])
    expect(gaps.staleEntities, `retirer l’entité de ${DIAGRAMS}/${DATA_VIEW}`).toEqual([])
  })

  it('cite chaque type d’événement de l’outbox', () => {
    expect(gaps.events, 'le décrire dans la section « L’outbox et le worker » de la page').toEqual([])
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

import { describe, expect, it } from 'vitest'
import {
  adrNumbers,
  docGaps,
  docProblems,
  erEntities,
  escapeHtml,
  migrationTables,
  outboxEventTypes,
  pageDiagrams,
  pageMarkers,
  pageWith,
} from './docs'

// La page des développeurs (docs.ts) : les schémas recopiés entre leurs
// marqueurs, échappés pour le HTML et à l'identique au second passage, puis
// les ADR, tables et types d'événements que la page doit présenter.

describe('recopie des schémas dans la page', () => {
  it('chaque schéma entre ses marqueurs, échappé pour le HTML, à l’identique au second passage', () => {
    const page = '<h2>Vue</h2>\n<!-- début : vues/a.mmd -->\nancien\n<!-- fin : vues/a.mmd -->\n'
    const diagrams = { 'vues/a.mmd': 'flowchart LR\n  a -->|"x & y"| b["<b>"]\n' }
    const expected = [
      '<h2>Vue</h2>',
      '<!-- début : vues/a.mmd -->',
      '<pre class="mermaid">',
      'flowchart LR',
      '  a --&gt;|"x &amp; y"| b["&lt;b&gt;"]',
      '</pre>',
      '<!-- fin : vues/a.mmd -->',
      '',
    ].join('\n')
    expect(pageWith(page, diagrams)).toBe(expected)
    expect(pageWith(expected, diagrams)).toBe(expected)
    expect(pageWith(page.replace(/\n/g, '\r\n'), diagrams)).toBe(expected)
  })

  it('laisse aux écarts un schéma sans marqueurs, refuse un marqueur de fin manquant', () => {
    expect(pageWith('<p></p>\n', { 'vues/a.mmd': 'flowchart LR\n' })).toBe('<p></p>\n')
    expect(() => pageWith('<!-- début : vues/a.mmd -->\n', { 'vues/a.mmd': 'flowchart LR\n' })).toThrow(/marqueurs/)
  })

  it('nomme les schémas par leur chemin depuis docs/architecture, comme les marqueurs', () => {
    expect(pageDiagrams({ 'docs/architecture/layers.mmd': 'a' }, { 'docs/architecture/vues/b.mmd': 'b' })).toEqual({
      'layers.mmd': 'a',
      'vues/b.mmd': 'b',
    })
    expect(pageMarkers('x <!-- début : layers.mmd --> y <!-- début : vues/b.mmd --> z')).toEqual([
      'layers.mmd',
      'vues/b.mmd',
    ])
  })

  it('échappe ce que le HTML interpréterait', () => {
    expect(escapeHtml('a <b> && c')).toBe('a &lt;b&gt; &amp;&amp; c')
  })
})

describe('ce que la page doit présenter', () => {
  it('tables : celles des parties « Up », dans l’ordre des migrations, moins les tables supprimées', () => {
    const migrations = [
      {
        path: 'migrations/2_b.sql',
        text: '-- Up Migration\nDROP TABLE old;\nCREATE TABLE IF NOT EXISTS later (\n  id uuid\n);\n-- Down Migration\nDROP TABLE later;\n',
      },
      {
        path: 'migrations/1_a.sql',
        text: '-- Up Migration\ncreate table notes (id uuid);\nCREATE TABLE old (id uuid);\n-- Down Migration\nDROP TABLE notes;\n',
      },
    ]
    expect(migrationTables(migrations)).toEqual(['later', 'notes'])
  })

  it('entités du schéma des données : chaque bloc « nom { », pas les relations', () => {
    expect(erEntities('erDiagram\n  b ||--o{ a : "x"\n  b {\n    uuid id PK\n  }\n  a{\n  }\n')).toEqual(['a', 'b'])
  })

  it('types d’événements : constantes pointées du domaine, hors tests et hors domaine', () => {
    const sources = [
      {
        path: 'src/domain/a.ts',
        text: "export const A_DONE = 'a.done'\nexport const LABEL = 'Libellé'\nexport const B = 'b.c.requested'\n",
      },
      { path: 'src/domain/a.test.ts', text: "export const T = 't.done'\n" },
      { path: 'src/application/x.ts', text: "export const X = 'x.done'\n" },
    ]
    expect(outboxEventTypes(sources)).toEqual(['a.done', 'b.c.requested'])
  })

  it('ADR : numéros des fichiers du dossier, sans le modèle', () => {
    expect(adrNumbers(['README.md', 'ADR-000-modele.md', 'ADR-002-b.md', 'ADR-001-a.md'])).toEqual(['001', '002'])
  })

  it('écarts : ce qui manque à la page, et ce qu’elle présente encore à tort', () => {
    const page = [
      '<!-- début : vues/schema.mmd -->',
      '<!-- fin : vues/schema.mmd -->',
      '<!-- début : vues/vieux.mmd -->',
      '<!-- fin : vues/vieux.mmd -->',
      '<article id="adr-001"><code>a.done</code></article>',
      '',
    ].join('\n')
    const diagrams = {
      'vues/schema.mmd': 'erDiagram\n  notes {\n  }\n  gone {\n  }\n',
      'vues/nouveau.mmd': 'flowchart LR\n',
    }
    const gaps = docGaps(page, diagrams, {
      adrFiles: ['ADR-001-a.md', 'ADR-002-b.md'],
      migrations: [{ path: 'migrations/1_a.sql', text: 'CREATE TABLE notes (id uuid);\nCREATE TABLE users (id uuid);\n' }],
      sources: [{ path: 'src/domain/a.ts', text: "export const A = 'a.done'\nexport const B = 'b.done'\n" }],
    })
    expect(gaps).toEqual({
      unplaced: ['vues/nouveau.mmd'],
      staleMarkers: ['vues/vieux.mmd'],
      adrs: ['ADR-002'],
      tables: ['users'],
      staleEntities: ['gone'],
      events: ['b.done'],
    })
    expect(docProblems(gaps)).toHaveLength(6)
    expect(docProblems({ unplaced: [], staleMarkers: [], adrs: [], tables: [], staleEntities: [], events: [] })).toEqual([])
  })
})

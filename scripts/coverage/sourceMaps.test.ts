import { describe, expect, it } from 'vitest'
import { decodeMappings, encodeMappings, flattenIndexedMap, isIndexedMap, toCoverageMap, type IndexedSourceMap } from './sourceMaps'

describe('toCoverageMap', () => {
  it('remplace les URL file:// d’une map classique par des chemins', () => {
    const map = toCoverageMap({ version: 3, sources: ['file:///repo/src/a.ts', 'b.ts'], mappings: 'AAAA' })
    expect(map.sources).toEqual(['/repo/src/a.ts', 'b.ts'])
    expect(map.mappings).toBe('AAAA')
  })
})

describe('decodeMappings / encodeMappings', () => {
  it('relit et réécrit des mappings à l’identique', () => {
    const mappings = 'AAAA,SAASA,GAAG;;AACA,YAAY;AAEnB,gBAAmD'
    expect(encodeMappings(decodeMappings(mappings))).toBe(mappings)
  })

  it('rend des positions absolues, colonne générée remise à zéro à chaque ligne', () => {
    expect(decodeMappings('AAAA,EAAE;EACA')).toEqual([
      [[0, 0, 0, 0], [2, 0, 0, 2]],
      [[2, 0, 1, 2]],
    ])
  })
})

describe('flattenIndexedMap', () => {
  const indexed: IndexedSourceMap = {
    version: 3,
    sections: [
      { offset: { line: 0, column: 0 }, map: { version: 3, sources: ['file:///a.ts'], sourcesContent: ['a'], names: ['x'], mappings: 'AAAAA' } },
      { offset: { line: 3, column: 0 }, map: { version: 3, sources: ['file:///b.ts', 'file:///a.ts'], names: [], mappings: 'AAAA;ACCA' } },
    ],
  }

  it('reconnaît une map indexée', () => {
    expect(isIndexedMap(indexed)).toBe(true)
    expect(isIndexedMap({ version: 3, sources: [], mappings: '' })).toBe(false)
  })

  it('décale les lignes de chaque section et fusionne les sources', () => {
    const flat = flattenIndexedMap(indexed)
    expect(flat.sources).toEqual(['/a.ts', '/b.ts'])
    // Contenu incomplet : omis, pour que les sources soient relues sur disque.
    expect(flat.sourcesContent).toBeUndefined()
    expect(flat.names).toEqual(['x'])
    expect(decodeMappings(flat.mappings)).toEqual([
      [[0, 0, 0, 0, 0]],
      [],
      [],
      [[0, 1, 0, 0]],
      [[0, 0, 1, 0]],
    ])
  })

  it('applique le décalage de colonne à la première ligne de la section seulement', () => {
    const flat = flattenIndexedMap({
      version: 3,
      sections: [{ offset: { line: 1, column: 4 }, map: { version: 3, sources: ['s'], mappings: 'AAAA;AACA' } }],
    })
    expect(decodeMappings(flat.mappings)).toEqual([[], [[4, 0, 0, 0]], [[0, 0, 1, 0]]])
  })
})

// Aplatissement des source maps indexées (champ `sections`, spec Source Map v3)
// en source maps classiques. Turbopack (`next dev`) n'écrit que des maps
// indexées, que c8 / v8-to-istanbul ignorent : sans cette étape, aucun fichier
// `src/` servi par Next.js n'apparaît dans la couverture E2E.

import { fileURLToPath } from 'node:url'

const BASE64 ='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Segment absolu : [colonne générée, source, ligne, colonne, nom?].
type Segment = number[]

export type RawSourceMap = {
  version: 3
  file?: string
  sourceRoot?: string
  sources: string[]
  sourcesContent?: (string | null)[]
  names?: string[]
  mappings: string
}

export type IndexedSourceMap = {
  version: 3
  file?: string
  sections: { offset: { line: number; column: number }; map: RawSourceMap }[]
}

export function isIndexedMap(map: unknown): map is IndexedSourceMap {
  return typeof map === 'object' && map !== null && Array.isArray((map as IndexedSourceMap).sections)
}

export function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = []
  const state = [0, 0, 0, 0, 0]
  for (const line of mappings.split(';')) {
    state[0] = 0
    const segments: Segment[] = []
    for (const raw of line.split(',')) {
      if (!raw) continue
      const values = decodeVlq(raw)
      const segment: Segment = []
      values.forEach((value, i) => {
        state[i] += value
        segment.push(state[i])
      })
      segments.push(segment)
    }
    lines.push(segments)
  }
  return lines
}

export function encodeMappings(lines: Segment[][]): string {
  const state = [0, 0, 0, 0, 0]
  return lines.map((segments) => {
    state[0] = 0
    return segments.map((segment) => segment.map((value, i) => {
      const delta = value - state[i]
      state[i] = value
      return encodeVlq(delta)
    }).join('')).join(',')
  }).join(';')
}

// Les sections de Turbopack commencent toutes en colonne 0 ; un décalage de
// colonne ne s'applique qu'à la première ligne de sa section. Les sources
// `file://` deviennent des chemins : c8 (`--exclude-after-remap`) filtre les
// plages sur le chemin brut de la source, et une URL ne correspond jamais à
// `src/**` ; ses plages non exécutées seraient ignorées, le fichier à 100 %.
export function flattenIndexedMap(indexed: IndexedSourceMap): RawSourceMap {
  const sources: string[] = []
  const sourcesContent: (string | null)[] = []
  const names: string[] = []
  const sourceIndex = new Map<string, number>()
  const nameIndex = new Map<string, number>()
  const lines: Segment[][] = []

  for (const { offset, map } of indexed.sections) {
    const localSources = map.sources.map((source, i) => {
      const resolved = toPath(map.sourceRoot ? map.sourceRoot.replace(/\/?$/, '/') + source : source)
      let index = sourceIndex.get(resolved)
      if (index === undefined) {
        index = sources.push(resolved) - 1
        sourcesContent.push(map.sourcesContent?.[i] ?? null)
        sourceIndex.set(resolved, index)
      }
      return index
    })
    const localNames = (map.names ?? []).map((name) => {
      let index = nameIndex.get(name)
      if (index === undefined) {
        index = names.push(name) - 1
        nameIndex.set(name, index)
      }
      return index
    })
    decodeMappings(map.mappings).forEach((segments, i) => {
      const line = offset.line + i
      while (lines.length <= line) lines.push([])
      for (const segment of segments) {
        const moved = [segment[0] + (i === 0 ? offset.column : 0)]
        if (segment.length >= 4) moved.push(localSources[segment[1]], segment[2], segment[3])
        if (segment.length === 5) moved.push(localNames[segment[4]])
        lines[line].push(moved)
      }
    })
  }
  for (const segments of lines) segments.sort((a, b) => a[0] - b[0])

  // Turbopack n'inclut pas le contenu des sources : sans `sourcesContent`,
  // v8-to-istanbul relit les fichiers sur disque, alors qu'un tableau de `null`
  // lui ferait remapper vers des fichiers vides.
  const complete = sourcesContent.every((content) => typeof content === 'string')
  return {
    version: 3,
    ...(indexed.file ? { file: indexed.file } : {}),
    sources,
    ...(complete ? { sourcesContent } : {}),
    names,
    mappings: encodeMappings(lines),
  }
}

// Map prête pour c8 : indexée → aplatie ; classique (tsx) → sources en chemins.
export function toCoverageMap(map: RawSourceMap | IndexedSourceMap): RawSourceMap {
  if (isIndexedMap(map)) return flattenIndexedMap(map)
  return { ...map, sources: map.sources.map(toPath) }
}

function toPath(source: string): string {
  return source.startsWith('file://') ? fileURLToPath(source) : source
}

function decodeVlq(raw: string): number[] {
  const values: number[] = []
  let value = 0
  let shift = 0
  for (const char of raw) {
    const digit = BASE64.indexOf(char)
    if (digit < 0) throw new Error(`invalid base64 VLQ character: ${char}`)
    value += (digit & 31) << shift
    if (digit & 32) {
      shift += 5
      continue
    }
    values.push(value & 1 ? -(value >>> 1) : value >>> 1)
    value = 0
    shift = 0
  }
  return values
}

function encodeVlq(number: number): string {
  let value = number < 0 ? (-number << 1) | 1 : number << 1
  let out = ''
  do {
    let digit = value & 31
    value >>>= 5
    if (value > 0) digit |= 32
    out += BASE64[digit]
  } while (value > 0)
  return out
}

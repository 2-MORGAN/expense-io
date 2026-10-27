// `tsx scripts/coverage/flatten.ts <dossier>` : réécrit en place les dumps de
// `NODE_V8_COVERAGE` pour que `c8 report` remappe le code servi par Turbopack
// vers `src/` (voir sourceMaps.ts). Lancé par `npm run test:e2e:coverage`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isIndexedMap, toCoverageMap, type RawSourceMap } from './sourceMaps'

type CoverageDump = { 'source-map-cache'?: Record<string, { data?: unknown }> }

function isRawMap(map: unknown): map is RawSourceMap {
  return typeof map === 'object' && map !== null && Array.isArray((map as RawSourceMap).sources)
}

const dir = process.argv[2]
if (!dir) {
  console.error('usage: tsx scripts/coverage/flatten.ts <dossier NODE_V8_COVERAGE>')
  process.exit(2)
}

let files = 0
let maps = 0
for (const name of readdirSync(dir).filter((file) => file.endsWith('.json'))) {
  const path = join(dir, name)
  const dump = JSON.parse(readFileSync(path, 'utf8')) as CoverageDump
  let changed = 0
  for (const entry of Object.values(dump['source-map-cache'] ?? {})) {
    if (!isIndexedMap(entry.data) && !isRawMap(entry.data)) continue
    if (isIndexedMap(entry.data)) changed++
    entry.data = toCoverageMap(entry.data)
  }
  writeFileSync(path, JSON.stringify(dump))
  files++
  maps += changed
}
console.log(`coverage: ${files} dumps normalisés, ${maps} source maps indexées aplaties`)

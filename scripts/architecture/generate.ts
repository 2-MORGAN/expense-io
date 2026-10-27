import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { analyze, problems, readSources, README } from './architecture'
import { readmeWith } from './mermaid'

// `npm run generate:architecture` : regénère les graphes de docs/architecture
// depuis le code, puis dit ce qui fera encore échouer architecture.test.ts.
// Regénérer suit une évolution voulue ; une flèche interdite ou une route
// sans garde restent en rouge, et le test échoue toujours.

const root = process.cwd()
const analysis = analyze(readSources(root))
for (const [file, text] of Object.entries(analysis.graphs)) {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}
const readme = join(root, README)
writeFileSync(readme, readmeWith(readFileSync(readme, 'utf8'), analysis.graphs))
console.log(`Écrits : ${[...Object.keys(analysis.graphs), README].join(', ')}`)

const remaining = problems(analysis)
for (const problem of remaining) console.error(`!! ${problem}`)
process.exitCode = remaining.length ? 1 : 0

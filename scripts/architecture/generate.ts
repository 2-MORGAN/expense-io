import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { analyze, codemapFor, problems, readSources, README } from './architecture'
import { CODEMAP } from './codemap'
import { DOC_PAGE, docGaps, docProblems, pageDiagrams, pageWith, readDocInputs, readViews } from './docs'
import { readmeWith } from './mermaid'

// `npm run generate:architecture` : regénère les graphes de docs/architecture
// depuis le code, les recopie avec les vues dans la page des développeurs
// (docs/index.html), écrit la carte du code (CODEMAP.md), puis dit ce qui fera encore échouer architecture.test.ts.
// Regénérer suit une évolution voulue ; une flèche interdite, une route sans
// garde ou une page incomplète restent en rouge, et le test échoue toujours.

const root = process.cwd()
const sources = readSources(root)
const analysis = analyze(sources)
for (const [file, text] of Object.entries(analysis.graphs)) {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}
const readme = join(root, README)
writeFileSync(readme, readmeWith(readFileSync(readme, 'utf8'), analysis.graphs))
const diagrams = pageDiagrams(analysis.graphs, readViews(root))
const page = pageWith(readFileSync(join(root, DOC_PAGE), 'utf8'), diagrams)
writeFileSync(join(root, DOC_PAGE), page)
writeFileSync(join(root, CODEMAP), codemapFor(root, sources, analysis))
console.log(`Écrits : ${[...Object.keys(analysis.graphs), README, DOC_PAGE, CODEMAP].join(', ')}`)

const remaining = [...problems(analysis), ...docProblems(docGaps(page, diagrams, readDocInputs(root, sources)))]
for (const problem of remaining) console.error(`!! ${problem}`)
process.exitCode = remaining.length ? 1 : 0

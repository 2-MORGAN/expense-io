import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AGENT_DIRS, AGENTS, agentGaps, agentProblems, agentsWith, readAgentInputs } from './agents'
import { analyze, problems, readSources, README } from './architecture'
import { DOC_PAGE, docGaps, docProblems, pageDiagrams, pageWith, readDocInputs, readViews } from './docs'
import { readmeWith } from './mermaid'

// `npm run generate:architecture` : regénère les graphes de docs/architecture
// depuis le code, les recopie avec les vues dans la page des développeurs
// (docs/index.html), recopie les droits de layers.ts dans le bloc « Peut
// importer » des AGENTS.md de dossier, puis dit ce qui fera encore échouer
// architecture.test.ts.
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
const agentFiles = AGENT_DIRS.filter((d) => d.layers.length && existsSync(join(root, d.dir, AGENTS))).map((d) => {
  const file = `${d.dir}/${AGENTS}`
  writeFileSync(join(root, file), agentsWith(readFileSync(join(root, file), 'utf8'), d.layers))
  return file
})
console.log(`Écrits : ${[...Object.keys(analysis.graphs), README, DOC_PAGE, ...agentFiles].join(', ')}`)

const remaining = [
  ...problems(analysis),
  ...docProblems(docGaps(page, diagrams, readDocInputs(root, sources))),
  ...agentProblems(agentGaps(readAgentInputs(root))),
]
for (const problem of remaining) console.error(`!! ${problem}`)
process.exitCode = remaining.length ? 1 : 0

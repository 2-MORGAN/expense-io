import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { byText } from './graph'
import { LAYERS, type Layer } from './layers'
import { withBlock } from './mermaid'

// Consignes par dossier, pour les agents IA comme pour les développeurs
// (CLAUDE.md, « Consignes par dossier ») : un AGENTS.md, lu par Codex, Cursor,
// Copilot…, et à côté un CLAUDE.md qui ne fait que l'importer (`@AGENTS.md`)
// pour Claude Code. Le bloc « Peut importer » d'un AGENTS.md recopie les
// droits de layers.ts (`npm run generate:architecture`) ; architecture.test.ts
// vérifie qu'aucune consigne ne manque et qu'aucun chemin, script npm ou cible
// make qu'elles citent n'a disparu : une consigne fausse est pire qu'une
// consigne absente.

export const AGENTS = 'AGENTS.md'
export const CLAUDE = 'CLAUDE.md'
/** Nom des marqueurs du bloc recopié depuis layers.ts. */
export const IMPORTS_BLOCK = 'imports permis'
/** Seule ligne d'un CLAUDE.md de dossier, commentaires HTML mis à part. */
export const CLAUDE_IMPORT = '@AGENTS.md'

export interface AgentDir {
  /** Dossier, depuis la racine du dépôt. */
  dir: string
  /** Couches de layers.ts dont le bloc « Peut importer » recopie les droits. */
  layers: readonly string[]
}

const LIB_LAYERS = LAYERS.filter((layer) => layer.path.startsWith('src/lib/')).map((layer) => layer.path)

export const AGENT_DIRS: readonly AgentDir[] = [
  { dir: 'src/domain', layers: ['src/domain'] },
  { dir: 'src/application', layers: ['src/application'] },
  { dir: 'src/ports', layers: ['src/ports'] },
  { dir: 'src/adapters', layers: ['src/adapters'] },
  { dir: 'src/composition', layers: ['src/composition'] },
  { dir: 'src/http', layers: ['src/http'] },
  { dir: 'src/app/api', layers: ['src/app/api'] },
  { dir: 'src/app', layers: ['src/app', 'src/app/actions', 'src/app/verify-email'] },
  { dir: 'src/components', layers: ['src/components'] },
  { dir: 'src/lib', layers: LIB_LAYERS },
  { dir: 'src/worker', layers: ['src/worker'] },
  { dir: 'migrations', layers: [] },
  { dir: 'e2e', layers: [] },
  { dir: 'scripts', layers: [] },
  { dir: 'docs', layers: [] },
]

// Couches de layers.ts sans consignes à elles ; en ajouter une se justifie
// dans la PR. Une nouvelle couche reçoit ses consignes ou entre ici.
export const LAYERS_WITHOUT_AGENTS: readonly string[] = [
  // Générés depuis openapi.yaml (`npm run generate:api`), sauf next-auth.d.ts.
  'src/generated',
  'src/types',
  // Code mort (CLAUDE.md, « Dette connue ») : rien ne s'y ajoute.
  'src/utils',
  // Un fichier chacun, décrit dans CLAUDE.md.
  'src/proxy',
  'src/instrumentation',
]

// Dossiers jamais parcourus : dépendances, builds, rapports (.gitignore).
const SKIPPED_DIRS = new Set([
  '.git',
  '.next',
  'blob-report',
  'build',
  'coverage',
  'coverage-e2e',
  'coverage-e2e-report',
  'node_modules',
  'out',
  'playwright-report',
  'test-results',
])

const lf = (text: string): string => text.replace(/\r\n/g, '\n')

/** Le bloc « Peut importer » : une ligne par couche, avec ses droits tels que layers.ts les déclare. */
export function importsBlock(paths: readonly string[], layers: readonly Layer[] = LAYERS): string {
  const rows = paths.map((path) => {
    const layer = layers.find((candidate) => candidate.path === path)
    if (!layer) throw new Error(`couche absente de scripts/architecture/layers.ts : ${path}`)
    const may = layer.may.length ? layer.may.map((name) => `\`${name}\``).join(', ') : 'rien'
    return `| \`${path}\` | ${may} |`
  })
  return `\n| Module | Peut importer |\n|---|---|\n${rows.join('\n')}\n\n`
}

const START = `<!-- début : ${IMPORTS_BLOCK} -->`
const END = `<!-- fin : ${IMPORTS_BLOCK} -->`

export function hasImportsBlock(text: string): boolean {
  const from = text.indexOf(START)
  return from >= 0 && text.indexOf(END) > from
}

/** AGENTS.md avec son bloc « Peut importer » recopié ; inchangé sans marqueurs, que `agentGaps` signale. */
export function agentsWith(text: string, paths: readonly string[], layers: readonly Layer[] = LAYERS): string {
  const doc = lf(text)
  return hasImportsBlock(doc) ? withBlock(doc, IMPORTS_BLOCK, importsBlock(paths, layers), 'du AGENTS.md') : doc
}

/** Un CLAUDE.md de dossier n'est que l'import de son AGENTS.md. */
export function isClaudeImport(text: string): boolean {
  const lines = lf(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !(line.startsWith('<!--') && line.endsWith('-->')))
  return lines.length === 1 && lines[0] === CLAUDE_IMPORT
}

/** Le texte hors des blocs de code délimités par ``` , et les lignes de ces blocs. */
export function splitFences(text: string): { prose: string; code: string } {
  const prose: string[] = []
  const code: string[] = []
  let inFence = false
  for (const line of lf(text).split('\n')) {
    if (line.trimStart().startsWith('```')) inFence = !inFence
    else (inFence ? code : prose).push(line)
  }
  return { prose: prose.join('\n'), code: code.join('\n') }
}

const INLINE_CODE = /`([^`\n]+)`/g
const LINK_TARGET = /\]\(([^)\s]+)\)/g
const REPO_ROOTS = ['src/', 'scripts/', 'migrations/', 'e2e/', 'docs/', 'ops/', '.claude/', '.github/', '@/']
// Motif, glob ou exemple à compléter (`src/app/api/**/route.ts`, `<nom>.sql`) : pas un chemin à vérifier.
const NOT_A_PATH = /[\s*<>{}$|?…]/

const inlineCode = (text: string): string[] => [...text.matchAll(INLINE_CODE)].map((match) => match[1])

const isRepoPath = (token: string): boolean =>
  !NOT_A_PATH.test(token) && REPO_ROOTS.some((prefix) => token.startsWith(prefix))

/**
 * Chemins cités par un fichier de consignes, depuis la racine du dépôt : code
 * en ligne qui commence par un dossier du dépôt (ou l'alias `@/`), et cibles
 * relatives des liens. Les blocs de code (arborescences, exemples) ne sont pas lus.
 */
export function citedPaths(file: string, text: string): string[] {
  const { prose } = splitFences(text)
  const inline = inlineCode(prose)
    .filter(isRepoPath)
    .map((token) => (token.startsWith('@/') ? `src/${token.slice(2)}` : token))
  const links = [...prose.matchAll(LINK_TARGET)]
    .map((match) => match[1].split('#')[0])
    .filter((target) => target && !/^[a-z][\w+.-]*:/i.test(target))
    .map((target) => posix.normalize(posix.join(posix.dirname(file), target)))
  const paths = [...inline, ...links].map((path) => path.replace(/:\d+$/, '').replace(/\/$/, ''))
  return [...new Set(paths)].sort(byText)
}

const NPM_RUN = /(?:^|[\s;&(])npm run ([\w:.-]+)/g
const MAKE = /(?:^|[\s;&(])make ([\w.-]+)/g

/** Sans la ponctuation qui finit une phrase (`npm run check.`). */
function withoutTrailingPunctuation(name: string): string {
  let end = name.length
  while (end > 0 && '.:'.includes(name[end - 1])) end--
  return name.slice(0, end)
}

function commands(text: string, pattern: RegExp): string[] {
  const { prose, code } = splitFences(text)
  const found = [...inlineCode(prose), code].flatMap((snippet) =>
    [...snippet.matchAll(pattern)].map((match) => withoutTrailingPunctuation(match[1]))
  )
  return [...new Set(found)].sort(byText)
}

/** Scripts lancés par `npm run <script>` dans le code en ligne et les blocs de code. */
export const citedScripts = (text: string): string[] => commands(text, NPM_RUN)

/** Cibles lancées par `make <cible>` dans le code en ligne et les blocs de code. */
export const citedTargets = (text: string): string[] => commands(text, MAKE)

/** Cibles d'un Makefile : `nom:` en début de ligne, sans les affectations `:=`. */
export function makeTargets(makefile: string): string[] {
  return lf(makefile)
    .split('\n')
    .flatMap((line) => {
      const colon = line.indexOf(':')
      const name = line.slice(0, colon)
      return colon > 0 && line[colon + 1] !== '=' && /^[\w-]+$/.test(name) ? [name] : []
    })
    .sort(byText)
}

export interface AgentInputs {
  /** Fichiers de consignes par chemin depuis la racine ; un fichier absent n'y est pas. */
  files: Readonly<Record<string, string>>
  /** Les AGENTS.md et CLAUDE.md trouvés dans le dépôt. */
  found: readonly string[]
  /** Scripts de package.json. */
  scripts: readonly string[]
  /** Cibles du Makefile. */
  targets: readonly string[]
  /** Le chemin existe-t-il, depuis la racine du dépôt ? */
  exists: (path: string) => boolean
}

const SKILLS = '.claude/skills'

/** Les fichiers de consignes : racine, dossiers déclarés, skills de Claude Code. */
export function agentFiles(root: string): string[] {
  const skills = existsSync(join(root, SKILLS))
    ? readdirSync(join(root, SKILLS), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${SKILLS}/${entry.name}/SKILL.md`)
    : []
  return [
    AGENTS,
    CLAUDE,
    ...AGENT_DIRS.flatMap(({ dir }) => [`${dir}/${AGENTS}`, `${dir}/${CLAUDE}`]),
    ...skills,
  ]
}

/** Les AGENTS.md et CLAUDE.md sous `dir`, sans les dossiers ignorés ni les autres copies du dépôt (worktrees). */
function findAgentFiles(root: string, dir = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name) || existsSync(join(root, path, '.git'))) continue
      out.push(...findAgentFiles(root, path))
    } else if (entry.isFile() && (entry.name === AGENTS || entry.name === CLAUDE)) {
      out.push(path)
    }
  }
  return out
}

const EXTENSIONS = ['', '.ts', '.tsx', '.mjs']

export function readAgentInputs(root: string): AgentInputs {
  const files: Record<string, string> = {}
  for (const file of agentFiles(root)) {
    if (existsSync(join(root, file))) files[file] = lf(readFileSync(join(root, file), 'utf8'))
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
  return {
    files,
    found: findAgentFiles(root).sort(byText),
    scripts: Object.keys(pkg.scripts ?? {}),
    targets: makeTargets(readFileSync(join(root, 'Makefile'), 'utf8')),
    exists: (path) => EXTENSIONS.some((ext) => existsSync(join(root, `${path}${ext}`))),
  }
}

export interface AgentGaps {
  /** Fichiers de consignes attendus et absents. */
  missing: string[]
  /** CLAUDE.md de dossier qui n'est pas le seul import de son AGENTS.md. */
  notImporting: string[]
  /** AGENTS.md ou CLAUDE.md hors de AGENT_DIRS : jamais vérifiés. */
  undeclared: string[]
  /** Couches sans consignes ni exclusion, et exclusions sans couche. */
  layers: string[]
  /** AGENTS.md dont le bloc « Peut importer » manque ou a dérivé de layers.ts. */
  staleImports: string[]
  /** `fichier : chemin` cité qui n'existe pas. */
  deadPaths: string[]
  /** `fichier : script` lancé par `npm run` et absent de package.json. */
  unknownScripts: string[]
  /** `fichier : cible` lancée par `make` et absente du Makefile. */
  unknownTargets: string[]
}

const cites = (inputs: AgentInputs, find: (file: string, text: string) => string[], ok: (item: string) => boolean) =>
  Object.entries(inputs.files).flatMap(([file, text]) =>
    find(file, text)
      .filter((item) => !ok(item))
      .map((item) => `${file} : ${item}`)
  )

/** Ce qui manque aux consignes, ou ce qu'elles affirment à tort. */
export function agentGaps(
  inputs: AgentInputs,
  dirs: readonly AgentDir[] = AGENT_DIRS,
  layers: readonly Layer[] = LAYERS,
  without: readonly string[] = LAYERS_WITHOUT_AGENTS
): AgentGaps {
  const declared = [AGENTS, CLAUDE, ...dirs.flatMap(({ dir }) => [`${dir}/${AGENTS}`, `${dir}/${CLAUDE}`])]
  const covered = new Set([...dirs.flatMap((d) => d.layers), ...without])
  const known = new Set(layers.map((layer) => layer.path))
  return {
    missing: declared.filter((file) => !(file in inputs.files)),
    notImporting: dirs
      .map(({ dir }) => `${dir}/${CLAUDE}`)
      .filter((file) => file in inputs.files && !isClaudeImport(inputs.files[file])),
    undeclared: inputs.found.filter((file) => !declared.includes(file)),
    layers: [
      ...layers.filter((layer) => !covered.has(layer.path)).map((layer) => `${layer.path} : couche sans consignes`),
      ...[...covered].filter((path) => !known.has(path)).map((path) => `${path} : absente de layers.ts`),
    ],
    staleImports: dirs
      .filter((d) => d.layers.length && `${d.dir}/${AGENTS}` in inputs.files)
      .flatMap(({ dir, layers: paths }) => {
        const file = `${dir}/${AGENTS}`
        const text = inputs.files[file]
        if (!hasImportsBlock(text)) return [`${file} : marqueurs absents`]
        if (paths.some((path) => !known.has(path))) return []
        return agentsWith(text, paths, layers) === text ? [] : [file]
      }),
    deadPaths: cites(inputs, citedPaths, inputs.exists),
    unknownScripts: cites(inputs, (_file, text) => citedScripts(text), (s) => inputs.scripts.includes(s)),
    unknownTargets: cites(inputs, (_file, text) => citedTargets(text), (t) => inputs.targets.includes(t)),
  }
}

/** Les écarts en messages : ce qui fera échouer architecture.test.ts. */
export function agentProblems(gaps: AgentGaps): string[] {
  const list = (title: string, items: readonly string[]) => (items.length ? [`${title} : ${items.join(' ; ')}`] : [])
  return [
    ...list('consigne manquante (scripts/architecture/agents.ts)', gaps.missing),
    ...list(`${CLAUDE} de dossier qui n'est pas « ${CLAUDE_IMPORT} »`, gaps.notImporting),
    ...list('consigne hors de AGENT_DIRS', gaps.undeclared),
    ...list('couche et consignes', gaps.layers),
    ...list('bloc « Peut importer » à regénérer', gaps.staleImports),
    ...list('chemin cité introuvable', gaps.deadPaths),
    ...list('script npm cité absent de package.json', gaps.unknownScripts),
    ...list('cible make citée absente du Makefile', gaps.unknownTargets),
  ]
}

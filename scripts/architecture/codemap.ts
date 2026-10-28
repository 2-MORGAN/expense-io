import { posix } from 'node:path'
import ts from 'typescript'
import { byText, type SourceFile } from './graph'
import { routeName, type Guard, type RouteMethod } from './routes'

// La carte du code (CODEMAP.md) : pour chaque point d'entrée (route d'API,
// page, worker), les fichiers qu'il atteint par ses imports, rangés par
// couche, les tables et fonctions SQL qu'ils touchent, et les specs E2E qui
// appellent la route. Faite pour qu'un agent IA (ou un humain) qui ajoute une
// fonctionnalité sache quels fichiers ouvrir sans parcourir le dépôt.
//
// Pure et déterministe : mêmes fichiers, même carte. Les imports se suivent
// fichier par fichier, sauf vers src/composition/, qui branche plusieurs cas
// d'usage dans un même fichier : là, seuls les symboles importés et ce dont
// ils dépendent se suivent, pour qu'une route ne paraisse pas atteindre les
// cas d'usage de ses voisines.

export const CODEMAP = 'CODEMAP.md'

export interface CodemapInputs {
  /** Code de src/ (tests compris : ils sont écartés ici). */
  sources: readonly SourceFile[]
  /** Méthodes de route et leur garde, comme les calcule routes.ts. */
  methods: readonly RouteMethod[]
  /** Tables que laissent les migrations. */
  tables: readonly string[]
  /** Fonctions SQL déclarées par les migrations. */
  sqlFunctions: readonly string[]
  /** Specs Playwright (e2e/*.spec.ts). */
  specs: readonly SourceFile[]
}

const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/
const ROUTE_FILE = /^src\/app\/(?:(.+)\/)?route\.[cm]?[jt]sx?$/
const PAGE_FILE = /^src\/app\/(?:(.+)\/)?page\.[cm]?[jt]sx?$/
const COMPOSITION = 'src/composition/'
const WORKER_ENTRY = 'src/worker/handlers.ts'

/** Rubriques d'une entrée, dans l'ordre où l'on lit une fonctionnalité. */
const SECTIONS: readonly { title: string; prefix: string }[] = [
  { title: 'Composition', prefix: 'src/composition/' },
  { title: 'Cas d’usage', prefix: 'src/application/' },
  { title: 'Domaine', prefix: 'src/domain/' },
  { title: 'Ports', prefix: 'src/ports/' },
  { title: 'Adaptateurs', prefix: 'src/adapters/' },
  { title: 'HTTP', prefix: 'src/http/' },
  { title: 'Composants', prefix: 'src/components/' },
  { title: 'Actions serveur', prefix: 'src/app/actions/' },
  { title: 'Worker', prefix: 'src/worker/' },
  { title: 'Infrastructure', prefix: 'src/lib/' },
]

/** Fichiers où chercher les appels d'API d'une page (src/types/api.d.ts les cite toutes). */
const CALLERS = ['src/app/', 'src/components/']

/** Fichiers où chercher du SQL : seuls ceux-là parlent à la base. */
const SQL_PREFIXES = ['src/adapters/', 'src/lib/', 'src/worker/']

// Socle : fichier HTTP ou d'infrastructure atteint par au moins la moitié des
// routes. Listé une fois en tête, et pas sous chaque route.
const SHARED_PREFIXES = ['src/http/', 'src/lib/']
const SHARED_SHARE = 0.5

// ─── Chemins ────────────────────────────────────────────────────────────────

function specifierPath(from: string, specifier: string): string | undefined {
  if (specifier.startsWith('@/')) return posix.normalize(`src/${specifier.slice(2)}`)
  if (/^\.\.?\//.test(specifier)) return posix.normalize(posix.join(posix.dirname(from), specifier))
  return undefined
}

function resolve(from: string, specifier: string, files: ReadonlySet<string>): string | undefined {
  const base = specifierPath(from, specifier)
  if (base === undefined) return undefined
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.d.ts`, `${base}/index.ts`, `${base}/index.tsx`]
  return candidates.find((candidate) => files.has(candidate))
}

/** Chemin d'URL d'un fichier de route ou de page : sans groupes `(nom)` ni emplacements `@nom`. */
export function urlPath(file: string): string | undefined {
  const match = ROUTE_FILE.exec(file) ?? PAGE_FILE.exec(file)
  if (!match) return undefined
  const segments = (match[1] ?? '').split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'))
  return `/${segments.join('/')}`
}

// ─── Imports, avec les noms importés ────────────────────────────────────────

/** Un import : le fichier visé, et les noms pris (`*` : tout le fichier). */
interface ImportRef {
  target: string
  names: readonly string[] | '*'
}

const parse = (file: SourceFile): ts.SourceFile =>
  ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, file.path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

function clauseNames(clause: ts.ImportClause | undefined): readonly string[] | '*' {
  const bindings = clause?.namedBindings
  if (!clause || clause.name || !bindings || !ts.isNamedImports(bindings)) return '*'
  return bindings.elements.map((e) => (e.propertyName ?? e.name).text)
}

/** Les imports d'un fichier vers d'autres fichiers de src/ : statiques, réexports et `import()`. */
function importRefs(source: ts.SourceFile, files: ReadonlySet<string>): ImportRef[] {
  const refs: ImportRef[] = []
  const add = (specifier: ts.Node | undefined, names: readonly string[] | '*') => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return
    const target = resolve(source.fileName, specifier.text, files)
    if (target) refs.push({ target, names })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) add(node.moduleSpecifier, clauseNames(node.importClause))
    else if (ts.isExportDeclaration(node)) add(node.moduleSpecifier, '*')
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0], '*')
    ts.forEachChild(node, visit)
  }
  visit(source)
  return refs
}

/** Les déclarations de premier niveau, par nom (const, function, class). */
function topLevelDeclarations(source: ts.SourceFile): Map<string, ts.Node> {
  const declarations = new Map<string, ts.Node>()
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) if (ts.isIdentifier(d.name)) declarations.set(d.name.text, d)
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      declarations.set(statement.name.text, statement)
    }
  }
  return declarations
}

/** Les noms locaux qu'introduit une clause d'import, avec le symbole visé. */
function clauseBindings(clause: ts.ImportClause, target: string): [string, ImportRef][] {
  const out: [string, ImportRef][] = []
  if (clause.name) out.push([clause.name.text, { target, names: '*' }])
  const named = clause.namedBindings
  if (named && ts.isNamespaceImport(named)) out.push([named.name.text, { target, names: '*' }])
  if (named && ts.isNamedImports(named))
    for (const e of named.elements) out.push([e.name.text, { target, names: [(e.propertyName ?? e.name).text] }])
  return out
}

/** Nom local → [fichier, nom importé], pour les imports d'un fichier. */
function importedBindings(source: ts.SourceFile, files: ReadonlySet<string>): Map<string, ImportRef> {
  const bindings = new Map<string, ImportRef>()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue
    const target = resolve(source.fileName, statement.moduleSpecifier.text, files)
    const clause = statement.importClause
    if (target && clause) for (const [name, ref] of clauseBindings(clause, target)) bindings.set(name, ref)
  }
  return bindings
}

/** Les imports dont dépendent ces symboles d'un fichier de composition, de proche en proche. */
function symbolRefs(source: ts.SourceFile, names: readonly string[], files: ReadonlySet<string>): ImportRef[] {
  const declarations = topLevelDeclarations(source)
  const bindings = importedBindings(source, files)
  const refs: ImportRef[] = []
  const seen = new Set<string>()
  const queue = [...names]
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) queue.push(node.text)
    ts.forEachChild(node, visit)
  }
  while (queue.length) {
    const name = queue.pop() as string
    if (seen.has(name)) continue
    seen.add(name)
    const imported = bindings.get(name)
    if (imported) refs.push(imported)
    const declaration = declarations.get(name)
    if (declaration) visit(declaration)
  }
  return refs
}

// ─── Fermeture d'un point d'entrée ──────────────────────────────────────────

class ImportGraph {
  private readonly parsed = new Map<string, ts.SourceFile>()
  private readonly files: ReadonlySet<string>

  constructor(sources: readonly SourceFile[]) {
    const production = sources.filter((file) => !TEST.test(file.path))
    this.files = new Set(production.map((file) => file.path))
    for (const file of production) this.parsed.set(file.path, parse(file))
  }

  text(path: string): string {
    return this.parsed.get(path)?.text ?? ''
  }

  /** Les fichiers de src/ que vise directement `path` (tout le fichier, symboles compris). */
  targets(path: string): string[] {
    const source = this.parsed.get(path)
    return source ? importRefs(source, this.files).map((ref) => ref.target) : []
  }

  /** Les fichiers de src/ qu'atteint `entry`, lui compris ; ceux de `stop` sont atteints sans être suivis. */
  reach(entry: string, stop: ReadonlySet<string> = new Set()): string[] {
    // Fichiers suivis en entier, et symboles déjà suivis dans la composition.
    const whole = new Set<string>()
    const symbols = new Map<string, Set<string>>()
    const queue: ImportRef[] = [{ target: entry, names: '*' }]
    while (queue.length) {
      const { target, names } = queue.pop() as ImportRef
      const source = this.parsed.get(target)
      if (!source || whole.has(target)) continue
      if (names === '*' || !target.startsWith(COMPOSITION)) {
        whole.add(target)
        if (!stop.has(target) || target === entry) queue.push(...importRefs(source, this.files))
        continue
      }
      const seen = symbols.get(target) ?? new Set<string>()
      const fresh = names.filter((name) => !seen.has(name))
      for (const name of fresh) seen.add(name)
      symbols.set(target, seen)
      queue.push(...symbolRefs(source, fresh, this.files))
    }
    return [...new Set([...whole, ...symbols.keys()])].sort(byText)
  }
}

// ─── SQL et E2E ─────────────────────────────────────────────────────────────

const SQL_TABLE = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:ONLY\s+)?"?(?:public"?\.)?"?(\w+)/gi

/** Tables et fonctions SQL citées par les fichiers qui parlent à la base. */
function sqlUse(
  paths: readonly string[],
  shared: ReadonlySet<string>,
  graph: ImportGraph,
  inputs: CodemapInputs
): { tables: string[]; functions: string[] } {
  const tables = new Set<string>()
  const functions = new Set<string>()
  const known = new Set(inputs.tables)
  for (const path of paths) {
    if (!SQL_PREFIXES.some((prefix) => path.startsWith(prefix)) || shared.has(path)) continue
    const text = graph.text(path)
    for (const match of text.matchAll(SQL_TABLE)) {
      const table = match[1].toLowerCase()
      if (known.has(table)) tables.add(table)
    }
    for (const fn of inputs.sqlFunctions) if (new RegExp(String.raw`\b${fn}\s*\(`).test(text)) functions.add(fn)
  }
  return { tables: [...tables].sort(byText), functions: [...functions].sort(byText) }
}

/** Les chemins d'API cités dans un texte (`'/api/…'`, `` `/api/${id}/…` ``), `${…}` remplacé par `*`. */
export function apiCalls(text: string): string[] {
  const found: string[] = []
  // Une alternative par guillemet, sans quantificateur paresseux (ReDoS).
  for (const match of text.matchAll(/'(\/api\/[^']*)'|"(\/api\/[^"]*)"|`(\/api\/[^`]*)`/g)) {
    const call = match[1] ?? match[2] ?? match[3]
    const end = call.search(/[?#]/)
    found.push((end < 0 ? call : call.slice(0, end)).replace(/\$\{[^}]*\}/g, '*'))
  }
  return found
}

/** Vrai si un chemin cité (`*` : quelconque) peut viser cette route (`[id]`, `[...x]`). */
export function callMatches(route: string, call: string): boolean {
  const want = route.split('/')
  const got = call.replace(/\/$/, '').split('/')
  for (let i = 0; i < want.length; i++) {
    if (/^\[\.\.\..+\]$/.test(want[i])) return got.length > i
    if (got[i] === undefined) return false
    if (got[i] === '*' || /^\[.+\]$/.test(want[i])) continue
    if (got[i] !== want[i]) return false
  }
  return got.length === want.length
}

/** Les specs qui citent la route en toutes lettres (les appels passés par e2e/support/ ne se voient pas). */
function specsFor(route: string, specs: readonly SourceFile[]): string[] {
  return specs.filter((spec) => apiCalls(spec.text).some((call) => callMatches(route, call))).map((spec) => spec.path)
}

// ─── Rendu ──────────────────────────────────────────────────────────────────

function guardLabel(guard: Guard): string {
  if (guard.kind === 'role') return `rôle \`${guard.role}\``
  if (guard.kind === 'session') return 'session'
  if (guard.kind === 'public') return 'publique'
  return `**sans garde** (${guard.reason})`
}

const code = (items: readonly string[]): string => items.map((item) => `\`${item}\``).join(', ')

// Cœur : listé seulement s'il est importé directement par un fichier hors du
// cœur (route, cas d'usage, adaptateur…), pas par chaînage d'un type à l'autre.
const CORE_PREFIXES = ['src/domain/', 'src/ports/', 'src/utils/', 'src/generated/']
const isCore = (path: string): boolean => CORE_PREFIXES.some((prefix) => path.startsWith(prefix))

/** Les fichiers à montrer : le cœur importé directement, et tout le reste. */
function shown(paths: readonly string[], graph: ImportGraph): string[] {
  const direct = new Set(paths.filter((p) => !isCore(p)).flatMap((p) => graph.targets(p)))
  return paths.filter((p) => !isCore(p) || direct.has(p))
}

function sectionLines(paths: readonly string[], shared: ReadonlySet<string>, entry: string): string[] {
  const lines: string[] = []
  for (const { title, prefix } of SECTIONS) {
    const inSection = paths.filter((p) => p.startsWith(prefix) && p !== entry && !shared.has(p))
    if (inSection.length) lines.push(`- ${title} : ${code(inSection)}`)
  }
  return lines
}

function sqlLines(paths: readonly string[], shared: ReadonlySet<string>, graph: ImportGraph, inputs: CodemapInputs): string[] {
  const { tables, functions } = sqlUse(paths, shared, graph, inputs)
  const lines: string[] = []
  if (tables.length) lines.push(`- Tables : ${code(tables)}`)
  if (functions.length) lines.push(`- Fonctions SQL : ${code(functions)}`)
  return lines
}

interface Entry {
  file: string
  url: string
  reached: string[]
}

function routeBlock(entry: Entry, methods: readonly RouteMethod[], shared: ReadonlySet<string>, graph: ImportGraph, inputs: CodemapInputs): string[] {
  const own = methods.filter((m) => m.route === entry.url)
  const specs = specsFor(entry.url, inputs.specs)
  return [
    `### \`${entry.url}\``,
    '',
    `- Fichier : \`${entry.file}\``,
    ...own.map((m) => `- ${routeName(m).split(' ')[0]} : ${guardLabel(m.guard)}`),
    ...sectionLines(entry.reached, shared, entry.file),
    ...sqlLines(entry.reached, shared, graph, inputs),
    specs.length ? `- E2E : ${code(specs)}` : '- E2E : aucune spec ne cite cette route',
    '',
  ]
}

function pageBlock(entry: Entry, routes: readonly Entry[], shared: ReadonlySet<string>, graph: ImportGraph): string[] {
  const calls = entry.reached.filter((path) => CALLERS.some((p) => path.startsWith(p))).flatMap((path) => apiCalls(graph.text(path)))
  const called = routes.filter((route) => calls.some((call) => callMatches(route.url, call))).map((route) => route.url)
  return [
    `### \`${entry.url}\``,
    '',
    `- Fichier : \`${entry.file}\``,
    ...sectionLines(entry.reached, shared, entry.file).filter((line) => !line.startsWith('- Infrastructure')),
    called.length ? `- Routes appelées : ${code(called)}` : '- Routes appelées : aucune',
    '',
  ]
}

const HEADER = `# Carte du code

<!-- Généré par npm run generate:architecture (scripts/architecture/codemap.ts) : ne pas modifier à la main. -->

Pour chaque point d'entrée : les fichiers qu'il atteint par ses imports, rangés par couche, les tables et fonctions SQL touchées et les specs E2E qui appellent la route. **Lire cette carte avant d'explorer le dépôt** : elle dit quels fichiers ouvrir pour une fonctionnalité voisine. Elle est vérifiée par \`npm run check\` (\`scripts/architecture/architecture.test.ts\`) : à jour avec le code, sinon le test échoue.

Lecture : une nouvelle opération imite la route la plus proche (même rôle, même ressource). Recette complète : skill \`/nouvelle-fonctionnalite\` (\`.claude/skills/nouvelle-fonctionnalite/SKILL.md\`).
`

/** Le socle : fichiers HTTP ou d'infrastructure qu'atteignent au moins la moitié des routes. */
function sharedFiles(reaches: readonly string[][]): Set<string> {
  const counts = new Map<string, number>()
  for (const reached of reaches) for (const path of reached) counts.set(path, (counts.get(path) ?? 0) + 1)
  const isShared = ([path, n]: [string, number]) =>
    SHARED_PREFIXES.some((p) => path.startsWith(p)) && n >= reaches.length * SHARED_SHARE
  return new Set([...counts].filter(isShared).map(([path]) => path).sort(byText))
}

export function codemap(inputs: CodemapInputs): string {
  const graph = new ImportGraph(inputs.sources)
  const paths = inputs.sources.map((file) => file.path).filter((path) => !TEST.test(path))
  const routeFiles = paths.filter((path) => ROUTE_FILE.test(path))
  const shared = sharedFiles(routeFiles.map((file) => graph.reach(file)))
  const entryOf = (file: string): Entry => {
    const reached = shown(graph.reach(file, shared), graph)
    return { file, url: urlPath(file) ?? file, reached }
  }
  const routes = routeFiles.map(entryOf).sort((a, b) => byText(a.url, b.url))
  const pages = paths.filter((path) => PAGE_FILE.test(path)).map(entryOf).sort((a, b) => byText(a.url, b.url))

  const lines = [HEADER, '## Socle commun des routes', '']
  lines.push(`Atteint par au moins la moitié des routes, donc omis sous chacune : ${code([...shared])}.`, '')
  lines.push('## Routes d’API', '')
  for (const route of routes) lines.push(...routeBlock(route, inputs.methods, shared, graph, inputs))
  lines.push('## Pages', '')
  for (const page of pages) lines.push(...pageBlock(page, routes, shared, graph))
  if (paths.includes(WORKER_ENTRY)) {
    const worker = { reached: shown(graph.reach(WORKER_ENTRY), graph) }
    lines.push('## Worker de l’outbox', '', `- Registre des handlers : \`${WORKER_ENTRY}\``)
    lines.push(...sectionLines(worker.reached, new Set(), WORKER_ENTRY), ...sqlLines(worker.reached, new Set(), graph, inputs), '')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

const CREATE_FUNCTION = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi

/** Fonctions SQL que déclarent les migrations (partie « Up »). */
export function migrationFunctions(migrations: readonly SourceFile[]): string[] {
  const names = new Set<string>()
  for (const { text } of migrations) {
    const up = text.split('-- Down Migration')[0]
    for (const match of up.matchAll(CREATE_FUNCTION)) names.add(match[1].toLowerCase())
  }
  return [...names].sort(byText)
}

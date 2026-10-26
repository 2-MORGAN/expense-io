import { posix } from 'node:path'
import ts from 'typescript'
import { byText, type SourceFile } from './graph'

// Qui peut appeler chaque route de src/app/api (CLAUDE.md, règle 2 :
// autorisation côté serveur, à chaque route). La garde se lit dans le
// handler lui-même, sans l'exécuter :
// - `const x = requireRole(session, 'rôle')` puis `if (x instanceof Response) return x` ;
// - sans rôle, `requireRole(session)` exige seulement une session ;
// - `const session = await auth()` puis `if (!session…) throw|return` (handlers OCR).
// Un wrapper (`withApiErrors(…, async function GET() {…})`) se traverse : la
// garde se lit dans la fonction enveloppée. Une garde placée ailleurs (helper,
// callback) ne se voit pas : la route compte comme sans garde. Les routes
// publiques sont déclarées dans PUBLIC_ROUTES.

export type Guard =
  | { kind: 'public' }
  | { kind: 'session' }
  | { kind: 'role'; role: string }
  | { kind: 'none'; reason: string }

export interface RouteMethod {
  method: string
  route: string
  guard: Guard
}

export interface RouteGuards {
  methods: RouteMethod[]
  /** Entrées de PUBLIC_ROUTES sans route. */
  stalePublic: string[]
}

export const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

const ROUTE_FILE = /^src\/app\/api(?:\/(.+))?\/route\.[cm]?[jt]sx?$/

export const routeName = (m: { method: string; route: string }): string => `${m.method} ${m.route}`

/** Chemin d'URL d'un fichier de route ; un groupe `(nom)` ne fait pas partie de l'URL. */
function routePath(file: string): string | undefined {
  const match = ROUTE_FILE.exec(file)
  if (!match) return undefined
  const segments = (match[1] ?? '').split('/').filter((s) => s && !/^\(.*\)$/.test(s))
  return ['/api', ...segments].join('/')
}

type FunctionNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression

type Handler =
  | { kind: 'function'; node: FunctionNode }
  | { kind: 'reexport'; from: string; name: string }
  | { kind: 'opaque'; what: string }

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

/**
 * La fonction d'un handler : écrite telle quelle, ou passée en dernier argument
 * à un wrapper (`withApiErrors('/api/…', async function GET() {…})`), qui ne
 * remplace pas la garde : elle se lit dans la fonction enveloppée.
 */
function asFunction(node: ts.Node | undefined, depth = 0): FunctionNode | undefined {
  if (!node || depth > 3) return undefined
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
    return asFunction(node.expression, depth + 1)
  if (ts.isCallExpression(node)) return asFunction(node.arguments[node.arguments.length - 1], depth + 1)
  return undefined
}

/** Fonction déclarée sous ce nom au premier niveau du fichier (exportée seulement si `exported`). */
function declaredFunction(source: ts.SourceFile, name: string, exported: boolean): FunctionNode | undefined {
  for (const statement of source.statements) {
    if (exported && !isExported(statement)) continue
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement
    if (ts.isVariableStatement(statement))
      for (const d of statement.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.name.text === name) return asFunction(d.initializer)
  }
  return undefined
}

/** Les méthodes HTTP qu'exporte un fichier de route, et ce qui les sert. */
function exportedHandlers(source: ts.SourceFile): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && isExported(statement) && statement.name && METHODS.includes(statement.name.text)) {
      handlers.set(statement.name.text, { kind: 'function', node: statement })
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && METHODS.includes(d.name.text)) {
          const node = asFunction(d.initializer)
          handlers.set(d.name.text, node ? { kind: 'function', node } : { kind: 'opaque', what: d.initializer?.getText(source) ?? '' })
        } else if (ts.isObjectBindingPattern(d.name)) {
          for (const element of d.name.elements)
            if (ts.isIdentifier(element.name) && METHODS.includes(element.name.text))
              handlers.set(element.name.text, { kind: 'opaque', what: d.initializer?.getText(source) ?? '' })
        }
      }
    } else if (ts.isExportDeclaration(statement) && !statement.exportClause) {
      // `export * from '…'` : les méthodes exportées ne se voient pas une à une.
      handlers.set('*', { kind: 'opaque', what: statement.getText(source) })
    } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const method = element.name.text
        if (!METHODS.includes(method)) continue
        const local = (element.propertyName ?? element.name).text
        if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
          handlers.set(method, { kind: 'reexport', from: statement.moduleSpecifier.text, name: local })
        } else {
          const node = declaredFunction(source, local, false)
          handlers.set(method, node ? { kind: 'function', node } : { kind: 'opaque', what: local })
        }
      }
    }
  }
  return handlers
}

/** Parcourt le corps d'un handler sans entrer dans les fonctions imbriquées : une garde dans un callback ne protège pas la route. */
function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  ts.forEachChild(node, (child) => {
    if (ts.isFunctionLike(child)) return
    visit(child)
    walk(child, visit)
  })
}

function unwrap(node: ts.Expression): ts.Expression {
  let e = node
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression
  return e
}

const isIdentifier = (node: ts.Expression | undefined, name: string): boolean =>
  node !== undefined && ts.isIdentifier(unwrap(node)) && (unwrap(node) as ts.Identifier).text === name

/** `await auth()` */
const isAuthCall = (node: ts.Expression): boolean => {
  const e = unwrap(node)
  if (!ts.isAwaitExpression(e)) return false
  const call = unwrap(e.expression)
  return ts.isCallExpression(call) && isIdentifier(call.expression, 'auth') && call.arguments.length === 0
}

/** L'identifiant au départ d'un accès chaîné : `session` pour `session?.user?.id`. */
function root(node: ts.Expression): ts.Expression {
  let e = unwrap(node)
  while (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) e = unwrap(e.expression)
  return e
}

/** `return x`, `throw …`, ou un bloc qui en contient un à son premier niveau. */
function exits(statement: ts.Statement, returned?: string): boolean {
  if (ts.isBlock(statement)) return statement.statements.some((s) => exits(s, returned))
  if (ts.isReturnStatement(statement)) return returned === undefined || isIdentifier(statement.expression, returned)
  return returned === undefined && ts.isThrowStatement(statement)
}

function guardOf(fn: FunctionNode): Guard {
  if (!fn.body) return { kind: 'none', reason: 'handler sans corps' }
  const roleCalls: ts.CallExpression[] = []
  const sessions = new Set<string>()
  const ifs: ts.IfStatement[] = []
  walk(fn.body, (n) => {
    if (ts.isCallExpression(n) && isIdentifier(n.expression, 'requireRole')) roleCalls.push(n)
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isAuthCall(n.initializer))
      sessions.add(n.name.text)
    else if (ts.isIfStatement(n)) ifs.push(n)
  })

  if (roleCalls.length) {
    const roles = new Set<string>()
    for (const call of roleCalls) {
      const declaration = call.parent
      if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name))
        return { kind: 'none', reason: 'le résultat de requireRole n’est pas gardé dans une variable' }
      const name = declaration.name.text
      const checked = ifs.some((s) => {
        const test = unwrap(s.expression)
        return (
          ts.isBinaryExpression(test) &&
          test.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
          isIdentifier(test.left, name) &&
          isIdentifier(test.right, 'Response') &&
          exits(s.thenStatement, name)
        )
      })
      if (!checked) return { kind: 'none', reason: `${name} n’est pas vérifié : if (${name} instanceof Response) return ${name}` }
      const role = call.arguments[1]
      if (role === undefined) roles.add('')
      else if (ts.isStringLiteralLike(role)) roles.add(role.text)
      else return { kind: 'none', reason: 'rôle passé à requireRole non littéral' }
    }
    const named = [...roles].filter(Boolean).sort(byText)
    return named.length ? { kind: 'role', role: named.join(' | ') } : { kind: 'session' }
  }

  const sessionChecked = ifs.some((s) => {
    const test = unwrap(s.expression)
    if (!ts.isPrefixUnaryExpression(test) || test.operator !== ts.SyntaxKind.ExclamationToken) return false
    const start = root(test.operand)
    return ts.isIdentifier(start) && sessions.has(start.text) && exits(s.thenStatement)
  })
  if (sessionChecked) return { kind: 'session' }
  return { kind: 'none', reason: 'aucune garde : const x = requireRole(session, rôle) puis if (x instanceof Response) return x' }
}

/** Le fichier qu'un import vise : `@/http/x` ou `./x` donne x.ts (ou .tsx, ou son index). */
function resolveFile(
  from: string,
  specifier: string,
  sources: ReadonlyMap<string, ts.SourceFile>
): ts.SourceFile | undefined {
  let base: string
  if (specifier.startsWith('@/')) base = `src/${specifier.slice(2)}`
  else if (/^\.\.?\//.test(specifier)) base = posix.normalize(posix.join(posix.dirname(from), specifier))
  else return undefined
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    const source = sources.get(candidate)
    if (source) return source
  }
  return undefined
}

const methodOrder = (method: string): number => METHODS.indexOf(method)

export function routeGuards(files: readonly SourceFile[], publicRoutes: readonly string[]): RouteGuards {
  const sources = new Map<string, ts.SourceFile>()
  const parse = (file: SourceFile): ts.SourceFile => {
    let source = sources.get(file.path)
    if (!source) {
      source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true)
      sources.set(file.path, source)
    }
    return source
  }
  // Tous les fichiers TypeScript de src/, pour suivre un `export { x as POST } from '@/http/…'`.
  for (const file of files) if (/^src\/.*\.tsx?$/.test(file.path)) parse(file)

  const methods: RouteMethod[] = []
  for (const file of files) {
    const route = routePath(file.path)
    if (route === undefined) continue
    for (const [method, handler] of exportedHandlers(parse(file))) {
      let guard: Guard
      if (publicRoutes.includes(routeName({ method, route }))) guard = { kind: 'public' }
      else if (handler.kind === 'function') guard = guardOf(handler.node)
      else if (handler.kind === 'reexport') {
        const target = resolveFile(file.path, handler.from, sources)
        const fn = target && declaredFunction(target, handler.name, true)
        guard = fn ? guardOf(fn) : { kind: 'none', reason: `handler introuvable : ${handler.name} de ${handler.from}` }
      } else guard = { kind: 'none', reason: `handler non analysable : ${handler.what}` }
      methods.push({ method, route, guard })
    }
  }
  methods.sort((a, b) => byText(a.route, b.route) || methodOrder(a.method) - methodOrder(b.method))
  const served = new Set(methods.map(routeName))
  return { methods, stalePublic: publicRoutes.filter((r) => !served.has(r)).sort(byText) }
}

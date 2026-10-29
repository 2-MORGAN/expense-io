import { posix } from 'node:path'
import ts from 'typescript'
import { byText, type SourceFile } from './graph'

// Qui peut appeler chaque route de src/app (AGENTS.md, règle 2 : autorisation
// côté serveur, à chaque route). La garde se lit dans le handler, sans
// l'exécuter, et doit l'ouvrir : avant elle, seulement des déclarations sans
// valeur et `const session = await auth()` ; au besoin en tête d'un `try` dont
// le `catch` sort (return ou throw). Deux formes :
// - `const x = requireRole(session, 'rôle')` puis aussitôt
//   `if (x instanceof Response) return x` ; sans rôle, une session suffit ;
// - `if (!session?.user?.id) throw …` (handlers OCR).
// `session` est le résultat de `await auth()`, et `auth` et `requireRole` sont
// importés de src/lib/auth et src/http/requireRole. Un wrapper déclaré dans
// WRAPPERS se traverse. Tout le reste compte comme sans garde ; les routes
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

// Wrappers qui ne font que traduire les erreurs (ADR-004, 2-485) : la garde se
// lit dans la fonction qu'ils enveloppent, passée en dernier argument. En
// ajouter un se justifie dans la PR : il ne doit rien autoriser à la place du
// handler.
const WRAPPERS = ['withApiErrors']

const ROUTE_FILE = /^src\/app\/(?:(.+)\/)?route\.[cm]?[jt]sx?$/

const AUTH_MODULE = 'src/lib/auth'
const REQUIRE_ROLE_MODULE = 'src/http/requireRole'

const NO_GUARD =
  'la garde doit ouvrir le handler : const x = requireRole(session, rôle) puis if (x instanceof Response) return x'

export const routeName = (m: { method: string; route: string }): string => `${m.method} ${m.route}`

const isMethod = (name: string): boolean => METHODS.includes(name)

/** Chemin d'URL d'un fichier de route : sans les groupes `(nom)` ni les emplacements `@nom`. */
function routePath(file: string): string | undefined {
  const match = ROUTE_FILE.exec(file)
  if (!match) return undefined
  const segments = (match[1] ?? '').split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'))
  return `/${segments.join('/')}`
}

/** Chemin, sans extension, qu'un import vise depuis `from` ; undefined pour un paquet. */
function importedPath(from: string, specifier: string): string | undefined {
  if (specifier.startsWith('@/')) return posix.normalize(`src/${specifier.slice(2)}`)
  if (/^\.\.?\//.test(specifier)) return posix.normalize(posix.join(posix.dirname(from), specifier))
  return undefined
}

type FunctionNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression

type Handler =
  | { kind: 'function'; node: FunctionNode }
  | { kind: 'reexport'; from: string; name: string }
  | { kind: 'opaque'; what: string }

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

/** `const` : un `let` ou un `var` pourrait être remplacé après coup par un handler sans garde. */
const isConst = (statement: ts.VariableStatement): boolean =>
  (statement.declarationList.flags & ts.NodeFlags.Const) !== 0

/** La fonction d'un handler : écrite telle quelle, ou enveloppée par un wrapper déclaré dans WRAPPERS. */
function asFunction(node: ts.Node | undefined): FunctionNode | undefined {
  if (!node) return undefined
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
    return asFunction(node.expression)
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && WRAPPERS.includes(node.expression.text))
    return asFunction(node.arguments[node.arguments.length - 1])
  return undefined
}

/** La fonction que déclare une instruction sous ce nom, s'il y en a une. */
function functionNamed(statement: ts.Statement, name: string): FunctionNode | undefined {
  if (ts.isFunctionDeclaration(statement)) return statement.name?.text === name ? statement : undefined
  if (!ts.isVariableStatement(statement) || !isConst(statement)) return undefined
  const declaration = statement.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === name)
  return asFunction(declaration?.initializer)
}

/** Fonction déclarée sous ce nom au premier niveau du fichier (exportée seulement si `exported`). */
function declaredFunction(source: ts.SourceFile, name: string, exported: boolean): FunctionNode | undefined {
  for (const statement of source.statements) {
    const found = exported && !isExported(statement) ? undefined : functionNamed(statement, name)
    if (found) return found
  }
  return undefined
}

/** Les noms qu'introduit une déclaration, même déstructurée (`{ a: { GET } }`, `[GET]`). */
function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  const elements: readonly ts.ArrayBindingElement[] = name.elements
  return elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : boundNames(element.name)))
}

/** `export const GET = …` ; une autre forme (let, déstructuration) ne se lit pas. */
function declarationHandlers(source: ts.SourceFile, statement: ts.VariableStatement): [string, Handler][] {
  return statement.declarationList.declarations.flatMap((d): [string, Handler][] => {
    const opaque: Handler = { kind: 'opaque', what: d.getText(source) }
    const methods = boundNames(d.name).filter(isMethod)
    const node = isConst(statement) && ts.isIdentifier(d.name) ? asFunction(d.initializer) : undefined
    return methods.map((method): [string, Handler] => [method, node ? { kind: 'function', node } : opaque])
  })
}

/** `export { x as GET }`, `export { x as POST } from '…'`, ou `export * from '…'`. */
function exportDeclarationHandlers(source: ts.SourceFile, statement: ts.ExportDeclaration): [string, Handler][] {
  // `export * from '…'` : les méthodes exportées ne se voient pas une à une.
  if (!statement.exportClause) return [['*', { kind: 'opaque', what: statement.getText(source) }]]
  if (!ts.isNamedExports(statement.exportClause)) return []
  const specifier = statement.moduleSpecifier
  const from = specifier && ts.isStringLiteral(specifier) ? specifier.text : undefined
  return statement.exportClause.elements.flatMap((element): [string, Handler][] => {
    const method = element.name.text
    if (!isMethod(method)) return []
    const local = (element.propertyName ?? element.name).text
    if (from !== undefined) return [[method, { kind: 'reexport', from, name: local }]]
    const node = declaredFunction(source, local, false)
    return [[method, node ? { kind: 'function', node } : { kind: 'opaque', what: local }]]
  })
}

function statementHandlers(source: ts.SourceFile, statement: ts.Statement): [string, Handler][] {
  if (ts.isExportDeclaration(statement)) return exportDeclarationHandlers(source, statement)
  if (!isExported(statement)) return []
  if (ts.isFunctionDeclaration(statement)) {
    const name = statement.name?.text
    return name && isMethod(name) ? [[name, { kind: 'function', node: statement }]] : []
  }
  return ts.isVariableStatement(statement) ? declarationHandlers(source, statement) : []
}

/** Les méthodes HTTP qu'exporte un fichier de route, et ce qui les sert. */
const exportedHandlers = (source: ts.SourceFile): Map<string, Handler> =>
  new Map(source.statements.flatMap((statement) => statementHandlers(source, statement)))

function unwrap(node: ts.Expression): ts.Expression {
  let e = node
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression
  return e
}

const isIdentifier = (node: ts.Expression | undefined, name: string): boolean => {
  const e = node && unwrap(node)
  return e !== undefined && ts.isIdentifier(e) && e.text === name
}

/** Vrai si le fichier importe `name` de `module`, sous ce nom. */
function imports(source: ts.SourceFile, name: string, module: string): boolean {
  return source.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return false
    const bindings = statement.importClause?.namedBindings
    if (importedPath(source.fileName, statement.moduleSpecifier.text) !== module || !bindings) return false
    if (!ts.isNamedImports(bindings)) return false
    return bindings.elements.some((e) => e.name.text === name && (e.propertyName ?? e.name).text === name)
  })
}

/** `await auth()`, avec `auth` importé de src/lib/auth. */
function isAuthCall(node: ts.Expression, source: ts.SourceFile): boolean {
  const e = unwrap(node)
  if (!ts.isAwaitExpression(e)) return false
  const call = unwrap(e.expression)
  return (
    ts.isCallExpression(call) &&
    isIdentifier(call.expression, 'auth') &&
    call.arguments.length === 0 &&
    imports(source, 'auth', AUTH_MODULE)
  )
}

/** Les sessions déclarées par une instruction du préambule, ou undefined si ce n'en est pas une. */
function preambleSessions(statement: ts.Statement, source: ts.SourceFile): string[] | undefined {
  if (!ts.isVariableStatement(statement)) return undefined
  const sessions: string[] = []
  for (const d of statement.declarationList.declarations) {
    if (!d.initializer) continue
    if (!isConst(statement) || !ts.isIdentifier(d.name) || !isAuthCall(d.initializer, source)) return undefined
    sessions.push(d.name.text)
  }
  return sessions
}

/** Un `catch` qui sort : une erreur levée par la garde n'est pas avalée. */
const catchExits = (statement: ts.TryStatement): boolean =>
  !statement.catchClause ||
  statement.catchClause.block.statements.some((s) => ts.isReturnStatement(s) || ts.isThrowStatement(s))

/** `return x`, seul ou dans un bloc. */
function returnsIdentifier(statement: ts.Statement, name: string): boolean {
  if (ts.isBlock(statement)) return statement.statements.length === 1 && returnsIdentifier(statement.statements[0], name)
  return ts.isReturnStatement(statement) && isIdentifier(statement.expression, name)
}

/** `throw …`, seul ou en tête d'un bloc. */
function throwsFirst(statement: ts.Statement): boolean {
  if (ts.isBlock(statement)) return statement.statements.length > 0 && throwsFirst(statement.statements[0])
  return ts.isThrowStatement(statement)
}

/** La session passée à requireRole : `await auth()`, ou une variable du préambule qui le contient. */
function isSession(node: ts.Expression | undefined, sessions: ReadonlySet<string>, source: ts.SourceFile): boolean {
  if (!node) return false
  const e = unwrap(node)
  return isAuthCall(e, source) || (ts.isIdentifier(e) && sessions.has(e.text))
}

/** `if (x instanceof Response) return x` */
function returnsWhenResponse(statement: ts.Statement | undefined, name: string): boolean {
  if (!statement || !ts.isIfStatement(statement)) return false
  const test = unwrap(statement.expression)
  return (
    ts.isBinaryExpression(test) &&
    test.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
    isIdentifier(test.left, name) &&
    isIdentifier(test.right, 'Response') &&
    returnsIdentifier(statement.thenStatement, name)
  )
}

/** `const x = requireRole(session, 'rôle')` suivi de `if (x instanceof Response) return x`. */
function requireRoleGuard(
  statement: ts.Statement,
  next: ts.Statement | undefined,
  sessions: ReadonlySet<string>
): Guard | undefined {
  if (!ts.isVariableStatement(statement) || !isConst(statement)) return undefined
  const [declaration] = statement.declarationList.declarations
  const call = declaration?.initializer && unwrap(declaration.initializer)
  if (!call || !ts.isCallExpression(call) || !isIdentifier(call.expression, 'requireRole')) return undefined
  const source = statement.getSourceFile()
  if (!ts.isIdentifier(declaration.name) || !imports(source, 'requireRole', REQUIRE_ROLE_MODULE)) return undefined
  if (!isSession(call.arguments[0], sessions, source) || !returnsWhenResponse(next, declaration.name.text))
    return undefined
  const role = call.arguments[1]
  if (role === undefined) return { kind: 'session' }
  return ts.isStringLiteralLike(role) ? { kind: 'role', role: role.text } : undefined
}

/** `if (!session)`, `if (!session?.user)` ou `if (!session?.user?.id)`, puis `throw`. */
function sessionGuard(statement: ts.Statement, sessions: ReadonlySet<string>): Guard | undefined {
  if (!ts.isIfStatement(statement) || !throwsFirst(statement.thenStatement)) return undefined
  const test = unwrap(statement.expression)
  if (!ts.isPrefixUnaryExpression(test) || test.operator !== ts.SyntaxKind.ExclamationToken) return undefined
  const chain = unwrap(test.operand).getText().replace(/[?!]/g, '')
  const [start, ...path] = chain.split('.')
  const known = ['', 'user', 'user.id'].includes(path.join('.'))
  return start !== undefined && sessions.has(start) && known ? { kind: 'session' } : undefined
}

/** La garde qui ouvre une suite d'instructions, après le préambule ; un `try` en tête se traverse. */
function openingGuard(statements: readonly ts.Statement[], sessions: Set<string>): Guard {
  let i = 0
  for (; i < statements.length; i++) {
    const declared = preambleSessions(statements[i], statements[i].getSourceFile())
    if (!declared) break
    for (const name of declared) sessions.add(name)
  }
  const first = statements[i]
  if (first && ts.isTryStatement(first)) {
    if (!catchExits(first)) return { kind: 'none', reason: 'le catch qui entoure la garde doit sortir (return ou throw)' }
    return openingGuard(first.tryBlock.statements, sessions)
  }
  if (!first) return { kind: 'none', reason: NO_GUARD }
  return requireRoleGuard(first, statements[i + 1], sessions) ?? sessionGuard(first, sessions) ?? { kind: 'none', reason: NO_GUARD }
}

function guardOf(fn: FunctionNode): Guard {
  if (!fn.body || !ts.isBlock(fn.body)) return { kind: 'none', reason: NO_GUARD }
  return openingGuard(fn.body.statements, new Set())
}

/** Le fichier qu'un import vise : `@/http/x` ou `./x` donne x.ts (ou .tsx, ou son index). */
function resolveFile(
  from: string,
  specifier: string,
  sources: ReadonlyMap<string, ts.SourceFile>
): ts.SourceFile | undefined {
  const base = importedPath(from, specifier)
  if (base === undefined) return undefined
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    const source = sources.get(candidate)
    if (source) return source
  }
  return undefined
}

function guardFor(handler: Handler, file: string, sources: ReadonlyMap<string, ts.SourceFile>): Guard {
  if (handler.kind === 'function') return guardOf(handler.node)
  if (handler.kind === 'opaque') return { kind: 'none', reason: `handler non analysable : ${handler.what}` }
  const target = resolveFile(file, handler.from, sources)
  const fn = target ? declaredFunction(target, handler.name, true) : undefined
  return fn ? guardOf(fn) : { kind: 'none', reason: `handler introuvable : ${handler.name} de ${handler.from}` }
}

const methodOrder = (method: string): number => METHODS.indexOf(method)

export function routeGuards(files: readonly SourceFile[], publicRoutes: readonly string[]): RouteGuards {
  // Les routes, et tous les fichiers TypeScript de src/ pour suivre un `export { x as POST } from '@/http/…'`.
  const sources = new Map(
    files
      .filter((file) => /^src\/.*\.tsx?$/.test(file.path) || ROUTE_FILE.test(file.path))
      .map((file) => [file.path, ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true)] as const)
  )
  const methods: RouteMethod[] = []
  for (const file of files) {
    const route = routePath(file.path)
    const source = sources.get(file.path)
    if (route === undefined || !source) continue
    for (const [method, handler] of exportedHandlers(source)) {
      const isPublic = publicRoutes.includes(routeName({ method, route }))
      methods.push({ method, route, guard: isPublic ? { kind: 'public' } : guardFor(handler, file.path, sources) })
    }
  }
  methods.sort((a, b) => byText(a.route, b.route) || methodOrder(a.method) - methodOrder(b.method))
  const served = new Set(methods.map(routeName))
  return { methods, stalePublic: publicRoutes.filter((r) => !served.has(r)).sort(byText) }
}

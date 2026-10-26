import ts from 'typescript'

// Les chemins qu'un fichier importe, lus par l'analyseur de TypeScript et non
// par des expressions régulières : un import cité dans une chaîne, un gabarit
// ou un commentaire ne compte pas (repris de builder, src/import-parse.ts).
// `import … from`, `export … from`, `import x = require(…)`, `import(…)`,
// `require(…)` et `import('…')` dans un type. Undefined si un import a un
// chemin calculé : le graphe ne saurait pas le juger.

function scriptKind(path: string): ts.ScriptKind {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX
  if (/\.[cm]?ts$/i.test(path)) return ts.ScriptKind.TS
  return ts.ScriptKind.JSX
}

export function fileImports(path: string, text: string): string[] | undefined {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path))
  const found: string[] = []
  let computed = false
  const push = (argument: ts.Node | undefined) => {
    if (argument && ts.isStringLiteralLike(argument)) found.push(argument.text)
    else computed = true
  }
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      push(node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      push(node.moduleReference.expression)
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      push(node.arguments[0])
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      push(node.argument.literal)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return computed ? undefined : found
}

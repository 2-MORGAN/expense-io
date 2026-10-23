import fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import { parse } from 'yaml'

const api = parse(await fs.readFile('openapi.yaml', 'utf8'))
const methods = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])
const actual = new Set()
async function walk(folder) {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name)
    if (entry.isDirectory()) await walk(file)
    else if (entry.name === 'route.ts' && !file.startsWith(path.join('src','app','api','auth')+path.sep)) {
      const route = '/' + path.relative('src/app', path.dirname(file)).split(path.sep).join('/').replace(/\[([^\]]+)\]/g, '{$1}')
      const source = ts.createSourceFile(file, await fs.readFile(file,'utf8'), ts.ScriptTarget.Latest, true)
      for (const node of source.statements) {
        if (ts.isFunctionDeclaration(node) && node.name && ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export && methods.has(node.name.text)) actual.add(`${node.name.text} ${route}`)
        if (ts.isVariableStatement(node) && ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) {
          for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name) && methods.has(declaration.name.text)) actual.add(`${declaration.name.text} ${route}`)
        }
        if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) if (methods.has(element.name.text)) actual.add(`${element.name.text} ${route}`)
        }
      }
    }
  }
}
await walk('src/app/api')
const documented = new Set(Object.entries(api.paths).flatMap(([route,item]) => Object.keys(item).filter(m => methods.has(m.toUpperCase())).map(m => `${m.toUpperCase()} ${route}`)))
const missing = [...actual].filter(x => !documented.has(x))
const absent = [...documented].filter(x => !actual.has(x))
if (missing.length || absent.length) {
  console.error({ undocumentedHandlers: missing, unimplementedOperations: absent })
  process.exitCode = 1
} else console.log(`OpenAPI covers all ${actual.size} business operations (Auth.js excluded, re-exports included).`)

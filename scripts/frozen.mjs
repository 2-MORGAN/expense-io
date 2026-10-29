// Migrations et tests E2E déjà dans main : figés (ADR-005 §2, AGENTS.md,
// « Harnais de validation », règle 3). Une migration fusionnée a tourné sur
// d'autres bases : la corriger, c'est en écrire une nouvelle. Un test E2E
// existant ne se modifie, ne se désactive ni ne se supprime pour faire passer
// la CI ; un changement voulu passe par une ADR acceptée. Ajouter un test,
// même dans un fichier existant, reste libre.
//
// Règle commune du hook PreToolUse de Claude Code (.claude/hooks/guard-frozen.mjs)
// et de la CI (scripts/check-frozen.mjs, `make frozen`).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let typescript
// Chargé seulement pour lire un fichier de tests : le hook s'exécute à chaque écriture.
const ts = () => (typescript ??= require('typescript'))

const lf = (text) => text.replace(/\r\n/g, '\n')

/** Migration horodatée, chemin depuis la racine du dépôt en `/` : `migrations/1793…_nom.sql`. */
export function isMigration(path) {
  const name = path.slice('migrations/'.length)
  return path.startsWith('migrations/') && !name.includes('/') && /^\d/.test(name) && name.endsWith('.sql')
}

/** Fichier de scénarios Playwright : `e2e/….spec.ts`. */
export const isSpec = (path) => path.startsWith('e2e/') && path.endsWith('.spec.ts')

/**
 * Les appels `test('titre', …)` d'un fichier, par titre tel qu'il est écrit
 * (un titre répété reçoit un numéro), sous une forme normalisée : sans
 * commentaires ni mise en forme. `test.skip(…)` n'est pas un appel `test(…)` :
 * désactiver un test le fait disparaître.
 */
export function specTests(text) {
  const { createSourceFile, forEachChild, isCallExpression, isIdentifier, ScriptKind, ScriptTarget, SyntaxKind } = ts()
  const source = createSourceFile('spec.ts', lf(text), ScriptTarget.Latest, true, ScriptKind.TS)
  // Les jetons du test, lus dans l'arbre : ni commentaires ni espaces, gabarits compris.
  const tokens = (node, out = []) => {
    const children = node.getChildren(source)
    if (!children.length) out.push(node.getText(source))
    for (const child of children) {
      if (child.kind < SyntaxKind.FirstJSDocNode || child.kind > SyntaxKind.LastJSDocNode) tokens(child, out)
    }
    return out
  }
  const tests = new Map()
  const titles = new Map()
  const visit = (node) => {
    if (isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === 'test' && node.arguments.length) {
      const title = node.arguments[0].getText(source)
      const seen = (titles.get(title) ?? 0) + 1
      titles.set(title, seen)
      tests.set(seen === 1 ? title : `${title} (${seen})`, tokens(node).join(' '))
    }
    forEachChild(node, visit)
  }
  visit(source)
  return tests
}

/**
 * Titres des tests de `before` modifiés, désactivés ou retirés dans `after`.
 * Un test déjà modifié dans `current` (l'état avant l'écriture) ne compte plus :
 * seul ce que l'écriture casse est signalé.
 */
export function brokenTests(before, after, current = before) {
  const now = specTests(current)
  const next = specTests(after)
  return [...specTests(before)]
    .filter(([title, text]) => now.get(title) === text && next.get(title) !== text)
    .map(([title]) => title)
}

export const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })

/** Contenu de `path` au commit `ref`, ou undefined s'il n'y existe pas. */
export function fileAt(ref, path, cwd) {
  try {
    return git(['show', `${ref}:${path}`], cwd)
  } catch {
    return undefined
  }
}

export const MIGRATION_RULE =
  'elle a déjà tourné sur d’autres bases, la corriger c’est écrire une migration nouvelle (migrations/AGENTS.md)'
export const E2E_RULE =
  'Un test E2E existant ne se modifie, ne se désactive ni ne se supprime ; ajouter un test reste permis. Si le comportement doit changer : s’arrêter et demander, il faut une ADR acceptée (ADR-005 §2, e2e/AGENTS.md)'

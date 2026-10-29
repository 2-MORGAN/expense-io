// Hook PreToolUse de Claude Code (ADR-005 §2 et §4) : refuse d'écrire dans une
// migration déjà dans main, ou de modifier, désactiver ou supprimer un test
// E2E qui y est déjà (règle commune : scripts/frozen.mjs). Ajouter une
// migration ou un test reste libre. Garde-fou contre l'erreur : la CI
// (scripts/check-frozen.mjs) reste la garantie, et dans le doute (pas de git,
// pas d'origin/main) le hook laisse passer. OpenCode et Codex appliquent la
// même règle par agent-adapter.mjs.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { brokenTests, E2E_RULE, fileAt, git, isMigration, isSpec, MIGRATION_RULE } from '../../scripts/frozen.mjs'

const lf = (text) => text.replace(/\r\n/g, '\n')

/** Le fichier tel que l'outil le laisserait, ou undefined si l'outil n'écrit pas de fichier. */
export function contentAfter(toolName, input, current = '') {
  if (toolName === 'Write') return typeof input.content === 'string' ? lf(input.content) : undefined
  let edits
  if (toolName === 'Edit') edits = [input]
  else if (toolName === 'MultiEdit') edits = input.edits
  if (!Array.isArray(edits)) return undefined
  return edits.reduce((text, edit) => {
    const from = lf(String(edit.old_string ?? ''))
    const to = lf(String(edit.new_string ?? ''))
    if (!from) return text
    return edit.replace_all ? text.split(from).join(to) : text.replace(from, () => to)
  }, lf(current))
}

/**
 * Raison du refus, ou null. `path` : depuis la racine du dépôt, en `/` ;
 * `atBase(path)` : son contenu au commit de main dont part la branche ;
 * `current` : son contenu sur le disque, undefined s'il n'existe pas.
 */
export function refusal({ path, toolName, input, current, atBase }) {
  if (!isMigration(path) && !isSpec(path)) return null
  const before = atBase(path)
  if (before === undefined) return null
  if (isMigration(path)) return `${path} est déjà dans main : ${MIGRATION_RULE}.`
  const after = contentAfter(toolName, input, current)
  if (after === undefined) return null
  const broken = brokenTests(before, after, current ?? '')
  return broken.length ? `${path} : modifie, désactive ou retire ${broken.join(', ')}. ${E2E_RULE}.` : null
}

/** Racine de la copie de ce dépôt qui contient `file`, ou undefined (autre dépôt, pas de git). */
function repositoryRoot(file) {
  let dir = dirname(file)
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir)
  try {
    const root = git(['rev-parse', '--show-toplevel'], dir).trim()
    const projectDir = process.env.CLAUDE_PROJECT_DIR
    if (projectDir) {
      const commonDir = (cwd) => resolve(cwd, git(['rev-parse', '--git-common-dir'], cwd).trim()).toLowerCase()
      if (commonDir(root) !== commonDir(projectDir)) return undefined
    }
    return root
  } catch {
    return undefined
  }
}

/**
 * Raison du refus d'écrire `file` (chemin absolu ou relatif à `cwd`) avec
 * l'outil `toolName` de Claude Code, ou null. Dans le doute (autre dépôt, pas
 * d'origin/main, fichier illisible), laisse passer : la CI tranche.
 */
export function frozenRefusal({ file, toolName, toolInput, cwd = '.' }) {
  if (typeof file !== 'string') return null
  const root = repositoryRoot(resolve(cwd, file))
  const path = root ? relative(root, resolve(cwd, file)).replaceAll('\\', '/') : ''
  if (!root || (!isMigration(path) && !isSpec(path))) return null
  try {
    const base = git(['merge-base', 'HEAD', 'origin/main'], root).trim()
    return refusal({
      path,
      toolName,
      input: toolInput,
      current: existsSync(resolve(root, path)) ? readFileSync(resolve(root, path), 'utf8') : undefined,
      atBase: (p) => fileAt(base, p, root),
    })
  } catch {
    return null
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const reason = frozenRefusal({ file: input.tool_input?.file_path, toolName: input.tool_name, toolInput: input.tool_input, cwd: input.cwd })
  if (reason) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `${reason} (.claude/hooks/guard-frozen.mjs)`,
      },
    }))
  }
}

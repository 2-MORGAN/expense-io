// Garde-fous de Claude Code appliqués à OpenCode et Codex (AGENTS.md,
// « Harnais de validation ») : leurs outils d'écriture (`edit`, `write`,
// `apply_patch`) sont ramenés à ceux de Claude (`Edit`, `Write`), pour
// réutiliser les mêmes règles sans les copier : migrations et tests E2E de
// main figés (guard-frozen.mjs), recette d'une fonctionnalité
// (guard-recipe.mjs). Ces agents ne savent pas poser de question : la recette
// devient un refus, une seule fois par session.
//
// Lancé seul, c'est le hook de Codex (.codex/hooks.json : PreToolUse sur
// apply_patch, UserPromptSubmit) ; OpenCode l'importe
// (.opencode/plugins/garde-fous.ts). Les commandes shell passent par
// guard-git.mjs, inchangé.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { frozenRefusal } from './guard-frozen.mjs'
import { BLOCK_MESSAGE, isRecipe, markRecipe, recipeCheck } from './guard-recipe.mjs'

const FILE_MARKER = /^\*\*\* (Add|Update|Delete) File: (.+)$/
const MOVE_MARKER = /^\*\*\* Move to: (.+)$/

/** Ligne d'un morceau de modification : contexte (` `, ou ligne vide), retrait (`-`), ajout (`+`). */
function addChunkLine(chunks, line) {
  if (line.startsWith('@@') || !chunks.length) chunks.push({ old: [], new: [] })
  if (line.startsWith('@@')) return
  const chunk = chunks.at(-1)
  const sign = line[0]
  const body = ['+', '-', ' '].includes(sign) ? line.slice(1) : line
  if (sign !== '+') chunk.old.push(body)
  if (sign !== '-') chunk.new.push(body)
}

/** Nouvelle opération si `line` ouvre un fichier, sinon null. */
function fileOperation(line) {
  const file = FILE_MARKER.exec(line)
  if (!file) return null
  const type = file[1].toLowerCase()
  const op = { type, path: file[2].trim() }
  if (type === 'add') op.content = ''
  if (type === 'update') op.chunks = []
  return op
}

/**
 * Opérations d'un patch au format `apply_patch` (Codex, OpenCode) : `add`
 * (contenu), `update` (morceaux, déplacement), `delete`. Chemins tels
 * qu'écrits dans le patch.
 */
export function parsePatch(text) {
  const ops = []
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const next = fileOperation(line)
    const op = next ?? ops.at(-1)
    const move = MOVE_MARKER.exec(line)
    if (next) ops.push(next)
    else if (move && op?.type === 'update') op.moveTo = move[1].trim()
    else if (!op || line.startsWith('*** ')) continue
    else if (op.type === 'add' && line.startsWith('+')) op.content += `${line.slice(1)}\n`
    else if (op.type === 'update') addChunkLine(op.chunks, line)
  }
  for (const op of ops) {
    if (op.type === 'update') op.chunks = op.chunks.filter((chunk) => chunk.old.length || chunk.new.length)
  }
  return ops
}

/** Début de `block` dans `lines` à partir de `from`, espaces de fin ignorés ; -1 sinon. */
function indexOfBlock(lines, block, from) {
  const same = (a, b) => a.trimEnd() === b.trimEnd()
  for (let i = from; i + block.length <= lines.length; i++) {
    if (block.every((line, j) => same(lines[i + j], line))) return i
  }
  return -1
}

/** `current` après les morceaux, dans l'ordre ; undefined si l'un est introuvable. */
export function applyChunks(current, chunks) {
  const lines = current.replace(/\r\n/g, '\n').split('\n')
  // Fin du fichier, avant la ligne vide qui suit le dernier saut de ligne.
  const end = () => (lines.at(-1) === '' ? lines.length - 1 : lines.length)
  let position = 0
  for (const chunk of chunks) {
    // Un morceau sans contexte ajoute en fin de fichier.
    const at = chunk.old.length ? indexOfBlock(lines, chunk.old, position) : end()
    if (at === -1) return undefined
    lines.splice(at, chunk.old.length, ...chunk.new)
    position = at + chunk.new.length
  }
  return lines.join('\n')
}

/** Texte du patch d'un appel, quel que soit l'agent : `command` (Codex), `patchText` (OpenCode). */
const patchText = (args) =>
  [args?.patchText, args?.command].find((text) => typeof text === 'string' && text.includes('*** Begin Patch'))

/**
 * Écritures d'un appel d'outil, sous la forme des outils de Claude Code :
 * `{ toolName: 'Edit' | 'Write' | 'MultiEdit', input }`. `read(path)` : le
 * fichier sur le disque, undefined s'il n'existe pas. Un patch donne un
 * `Write` du contenu final par fichier, vide pour une suppression ; sans
 * `content` si un morceau est introuvable.
 */
export function claudeWrites(tool, args, read) {
  const patch = patchText(args)
  if (patch) {
    return parsePatch(patch).flatMap((op) => {
      if (op.type === 'add') return [{ toolName: 'Write', input: { file_path: op.path, content: op.content } }]
      if (op.type === 'delete') return [{ toolName: 'Write', input: { file_path: op.path, content: '' } }]
      const current = read(op.path)
      const content = current === undefined ? undefined : applyChunks(current, op.chunks)
      const written = { file_path: op.moveTo ?? op.path, ...(content === undefined ? {} : { content }) }
      return [
        ...(op.moveTo ? [{ toolName: 'Write', input: { file_path: op.path, content: '' } }] : []),
        { toolName: 'Write', input: written },
      ]
    })
  }
  if (['Edit', 'Write', 'MultiEdit'].includes(tool)) return [{ toolName: tool, input: args }]
  const file_path = args?.filePath ?? args?.path
  if (tool === 'edit') {
    return [{
      toolName: 'Edit',
      input: { file_path, old_string: args.oldString, new_string: args.newString, replace_all: args.replaceAll },
    }]
  }
  if (tool === 'write') return [{ toolName: 'Write', input: { file_path, content: args.content } }]
  return []
}

/** L'appel lance-t-il la recette ? Outil `skill` d'OpenCode, `Skill` de Claude Code. */
export const isRecipeCall = (tool, args) =>
  (tool === 'skill' && isRecipe(args?.name)) || (tool === 'Skill' && isRecipe(args?.skill))

/** Un prompt Codex qui invoque la recette : `$nouvelle-fonctionnalite` ou `/nouvelle-fonctionnalite`. */
export const promptStartsRecipe = (prompt) =>
  typeof prompt === 'string' && /(?:^|\s)[$/]nouvelle-fonctionnalite(?![\w-])/.test(prompt)

/**
 * Raison du refus d'un appel d'outil, ou null. `cwd` : dossier d'où les
 * chemins relatifs se lisent ; `sessionId` : la session de l'agent.
 */
export function guard({ tool, args, cwd, sessionId }) {
  if (isRecipeCall(tool, args)) {
    markRecipe(cwd, sessionId)
    return null
  }
  const read = (path) => {
    const file = resolve(cwd, path)
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined
  }
  const writes = claudeWrites(tool, args, read).filter(({ input }) => typeof input?.file_path === 'string')
  for (const { toolName, input } of writes) {
    const reason = frozenRefusal({ file: input.file_path, toolName, toolInput: input, cwd })
    if (reason) return reason
  }
  return writes.some(({ input }) => recipeCheck(cwd, sessionId, input.file_path)) ? BLOCK_MESSAGE : null
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'))
    const cwd = input.cwd ?? process.cwd()
    if (input.hook_event_name === 'UserPromptSubmit') {
      if (promptStartsRecipe(input.prompt)) markRecipe(cwd, input.session_id)
    } else {
      const reason = guard({ tool: input.tool_name, args: input.tool_input, cwd, sessionId: input.session_id })
      if (reason) {
        console.log(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `${reason} (.claude/hooks/agent-adapter.mjs)`,
          },
        }))
      }
    }
  } catch {
    // Entrée illisible : laisser passer, husky et la CI tranchent.
  }
}

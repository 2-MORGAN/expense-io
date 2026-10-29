// Hooks UserPromptExpansion et PreToolUse de Claude Code (AGENTS.md, « Façon
// de travailler ») : une fonctionnalité passe par la recette
// /nouvelle-fonctionnalite, et c'est l'humain qui décide. Le hook note quand
// la recette est lancée (tapée par l'humain ou appelée par Claude) ; sinon, à
// la première écriture de code de la session, il pose la question à l'humain
// (« ask »), une seule fois. Il ne devine pas l'intention d'un prompt : un
// correctif se confirme d'un clic. Dans le doute (pas de git), il laisse passer.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const RECIPE = 'nouvelle-fonctionnalite'
const CODE_DIRS = ['src/', 'migrations/', 'e2e/']
const CONTRACT = 'openapi.yaml'
/** Sessions retenues dans le fichier d'état : les plus récentes. */
const MAX_SESSIONS = 50

export const QUESTION =
  'Aucune recette /nouvelle-fonctionnalite dans cette session. Fonctionnalité nouvelle ou qui évolue : refuser, puis lancer la recette (plan validé par l’humain d’abord). Correctif ou refacto : accepter. Question posée une seule fois par session.'

/** La skill de la recette, nommée seule, avec sa barre, ou préfixée par son dossier (`dossier:nom`). */
export function isRecipe(name) {
  if (typeof name !== 'string') return false
  const bare = name.replace(/^\//, '')
  return bare === RECIPE || bare.endsWith(`:${RECIPE}`)
}

/** L'événement lance-t-il la recette ? Tapée par l'humain, ou appelée par Claude. */
export function recipeStarted(input) {
  if (input.hook_event_name === 'UserPromptExpansion') return isRecipe(input.command_name)
  return input.hook_event_name === 'PreToolUse' && input.tool_name === 'Skill' && isRecipe(input.tool_input?.skill)
}

/** Le fichier, depuis la racine du dépôt en `/`, relève-t-il d'une fonctionnalité ? */
export const needsRecipe = (path) => path === CONTRACT || CODE_DIRS.some((dir) => path.startsWith(dir))

/**
 * Faut-il poser la question avant d'écrire `path` ? `state` : session →
 * 'recipe' (recette lancée) ou 'asked' (question déjà posée).
 */
export function decide(state, sessionId, path) {
  if (!sessionId || !needsRecipe(path) || state[sessionId]) return { ask: false, state }
  return { ask: true, state: { ...state, [sessionId]: 'asked' } }
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

function readState(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

/** Garde les sessions les plus récentes : l'ordre d'insertion des clés fait foi. */
function writeState(file, state) {
  const recent = Object.fromEntries(Object.entries(state).slice(-MAX_SESSIONS))
  writeFileSync(file, JSON.stringify(recent))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'))
    const cwd = input.cwd ?? process.cwd()
    const root = git(['rev-parse', '--show-toplevel'], cwd)
    const stateFile = resolve(root, git(['rev-parse', '--git-path', 'claude-recipe.json'], root))
    const state = readState(stateFile)
    if (recipeStarted(input)) {
      if (input.session_id) {
        delete state[input.session_id]
        writeState(stateFile, { ...state, [input.session_id]: 'recipe' })
      }
    } else if (typeof input.tool_input?.file_path === 'string') {
      const file = resolve(cwd, input.tool_input.file_path)
      const path = relative(root, file).replaceAll('\\', '/')
      const decision = isAbsolute(path) ? { ask: false } : decide(state, input.session_id, path)
      if (decision.ask) {
        writeState(stateFile, decision.state)
        console.log(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            permissionDecisionReason: `${QUESTION} (.claude/hooks/guard-recipe.mjs)`,
          },
        }))
      }
    }
  } catch {
    // Pas de git ou entrée illisible : laisser passer.
  }
}

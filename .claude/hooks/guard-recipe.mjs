// Hooks UserPromptExpansion et PreToolUse de Claude Code (AGENTS.md, « Façon
// de travailler ») : une fonctionnalité passe par la recette
// /nouvelle-fonctionnalite, et c'est l'humain qui décide. Le hook note quand
// la recette est lancée (tapée par l'humain ou appelée par Claude) ; sinon, à
// la première écriture de code de la session, il pose la question à l'humain
// (« ask »), une seule fois. Il ne devine pas l'intention d'un prompt : un
// correctif se confirme d'un clic. Dans le doute (pas de git), il laisse passer.
// OpenCode et Codex appliquent la même règle par agent-adapter.mjs.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pathInRepository } from './paths.mjs'

const RECIPE = 'nouvelle-fonctionnalite'
const CODE_DIRS = ['src/', 'migrations/', 'e2e/']
const CONTRACT = 'openapi.yaml'
/** Sessions retenues dans le fichier d'état : les plus récentes. */
const MAX_SESSIONS = 50

export const QUESTION =
  'Aucune recette /nouvelle-fonctionnalite dans cette session. Fonctionnalité nouvelle ou qui évolue : refuser, puis lancer la recette (plan validé par l’humain d’abord). Correctif ou refacto : accepter. Question posée une seule fois par session.'

/** Pour les agents qui ne savent pas poser de question (OpenCode, Codex) : un refus, une seule fois. */
export const BLOCK_MESSAGE =
  'Aucune recette /nouvelle-fonctionnalite dans cette session : demande à l’humain s’il faut la suivre (fonctionnalité nouvelle ou qui évolue, plan validé d’abord) ou s’il s’agit d’un correctif ou d’une refacto. Relance ensuite l’écriture : elle passera. Refus fait une seule fois par session.'

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

/** Fichier d'état de la copie de travail qui contient `cwd`. */
function stateFileIn(cwd) {
  const root = git(['rev-parse', '--show-toplevel'], cwd)
  return { root, file: resolve(root, git(['rev-parse', '--git-path', 'claude-recipe.json'], root)) }
}

/** Note que la recette est lancée dans la session. Sans git : rien. */
export function markRecipe(cwd, sessionId) {
  if (!sessionId) return
  try {
    const { file } = stateFileIn(cwd)
    const state = readState(file)
    delete state[sessionId]
    writeState(file, { ...state, [sessionId]: 'recipe' })
  } catch {
    // Pas de git : laisser passer.
  }
}

/**
 * Faut-il poser la question (ou refuser une fois) avant d'écrire `file`,
 * chemin absolu ou relatif à `cwd` ? Si oui, la session est notée : la
 * question n'est posée qu'une fois. Sans git ou hors du dépôt : non.
 */
export function recipeCheck(cwd, sessionId, file) {
  try {
    const { root, file: stateFile } = stateFileIn(cwd)
    const path = pathInRepository(root, resolve(cwd, file))
    if (path === undefined) return false
    const decision = decide(readState(stateFile), sessionId, path)
    if (decision.ask) writeState(stateFile, decision.state)
    return decision.ask
  } catch {
    return false
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'))
    const cwd = input.cwd ?? process.cwd()
    if (recipeStarted(input)) {
      markRecipe(cwd, input.session_id)
    } else if (typeof input.tool_input?.file_path === 'string' && recipeCheck(cwd, input.session_id, input.tool_input.file_path)) {
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: `${QUESTION} (.claude/hooks/guard-recipe.mjs)`,
        },
      }))
    }
  } catch {
    // Entrée illisible : laisser passer.
  }
}

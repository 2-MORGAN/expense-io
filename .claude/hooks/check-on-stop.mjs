// Hook Stop de Claude Code (ADR-005 §4) : un tour ne se conclut pas avec
// `npm run check` rouge (AGENTS.md, « Harnais de validation », règle 1).
//
// Le check tourne quand la copie de travail (fichiers suivis et nouveaux, hors
// Markdown) diffère du dernier état vérifié vert. Rouge, la fin du tour est
// refusée une fois et l'agent reçoit la fin de la sortie. Un état déjà signalé
// rouge n'est ni revérifié ni bloqué de nouveau, même au tour suivant :
// l'utilisateur est seulement prévenu. Pas de boucle, pas d'insistance sur un
// code que personne n'a demandé de corriger.
//
// Un rouge qui ne vient pas du travail de l'agent ne doit pas le pousser à
// réécrire du code sain : le check tourne dans la copie de travail de la
// session (un worktree, pas le checkout principal) ; un Node différent de
// `.nvmrc` ou des dépendances en retard sur `package-lock.json` préviennent
// l'humain sans bloquer ; et le blocage nomme les fichiers que l'agent a
// changés, en lui interdisant de toucher au reste.
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as nodePath from 'node:path'
import { pathToFileURL } from 'node:url'

const { join, resolve } = nodePath
const MAX_OUTPUT_LINES = 80
/** Fichiers modifiés cités dans le message de blocage, au plus. */
const MAX_LISTED = 20

const gitToplevel = (dir) =>
  execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

/**
 * Dossier où lancer git et `npm run check` : la racine de la copie de travail
 * de la session (`input.cwd`), puis le dossier du projet, puis celui du tour,
 * puis le dossier courant. En worktree, `CLAUDE_PROJECT_DIR` désigne le
 * checkout principal : y lancer le check vérifiait un autre code que celui de
 * l'agent. Lettre de lecteur en majuscule : sous Windows, VS Code fournit
 * `c:\…`, et Vitest lancé depuis un tel dossier charge ses modules deux fois.
 * Tous les tests échouaient alors dès describe() (« reading 'config' ») sur
 * un code vert.
 */
export function projectRoot(env, input, cwd, toplevel = gitToplevel, path = nodePath) {
  let dir
  try {
    // git donne `C:/…` sous Windows : resolve() remet les séparateurs du système.
    if (input.cwd) dir = path.resolve(toplevel(input.cwd))
  } catch {
    // Pas de git dans ce dossier : les replis ci-dessous.
  }
  dir ||= env.CLAUDE_PROJECT_DIR || input.cwd || cwd
  return dir.replace(/^[a-z]:/, (drive) => drive.toUpperCase())
}

/** Message si la version majeure de Node diffère de `.nvmrc`, sinon null. */
export function nodeMismatch(nvmrc, version) {
  const wanted = /^v?(\d+)/.exec(nvmrc?.trim() ?? '')?.[1]
  const actual = /^v?(\d+)/.exec(version)?.[1]
  if (!wanted || wanted === actual) return null
  return `Node ${actual} au lieu de ${wanted} (\`.nvmrc\`) : \`nvm use\`, puis relancer`
}

/**
 * Message si les dépendances installées (`node_modules/.package-lock.json`)
 * ne correspondent pas à `package-lock.json`, sinon null. Les paquets
 * optionnels (binaires propres à une plateforme) peuvent manquer.
 */
export function staleDependencies(lock, installed) {
  if (!installed?.packages) return 'dépendances absentes ou installées par un npm trop ancien : `npm install`'
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (!key || entry.optional || entry.devOptional || entry.link) continue
    const version = installed.packages[key]?.version
    if (version !== entry.version) {
      const name = key.replace(/^.*node_modules\//, '')
      return `dépendances en retard sur package-lock.json (${name} : ${version ?? 'absent'} au lieu de ${entry.version}) : \`npm install\``
    }
  }
  return null
}

/** Consigne de blocage : ne corriger que ses propres changements, jamais le reste. */
export function blockReason(changed, output) {
  let listed = 'inconnus (état de référence disparu)'
  if (changed) {
    const more = changed.length - MAX_LISTED
    listed = changed.slice(0, MAX_LISTED).join(', ') + (more > 0 ? ` et ${more} autres` : '')
  }
  return [
    `\`npm run check\` échoue. Fichiers modifiés depuis le dernier check vert : ${listed}.`,
    'Ne corrige que ce qui vient de ces changements. Si les erreurs portent sur d’autres fichiers ou paraissent venir de l’environnement (version de Node, dépendances, dossier du check), ne modifie pas le code : arrête-toi et explique-le à l’utilisateur (AGENTS.md, « Harnais de validation »).',
    '',
    output,
  ].join('\n')
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

const readText = (file) => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

function main() {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}')
  const root = projectRoot(process.env, input, process.cwd())
  // Sortie d'erreur capturée : pas d'avertissement de fins de ligne dans la
  // console de Claude Code.
  const git = (args, env = process.env) =>
    execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

  // Arbre git de la copie de travail, calculé dans une copie de l'index : l'index
  // réel n'est pas modifié.
  const dir = mkdtempSync(join(tmpdir(), 'claude-check-'))
  let tree
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') }
    copyFileSync(resolve(root, git(['rev-parse', '--git-path', 'index'])), env.GIT_INDEX_FILE)
    git(['add', '-A'], env)
    tree = git(['write-tree'], env)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const stateFile = resolve(root, git(['rev-parse', '--git-path', 'claude-check.json']))
  let state = {}
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8'))
  } catch {
    // Premier passage : on compare au dernier commit.
  }

  let changed = null
  try {
    changed = git(['diff-tree', '-r', '--name-only', state.green ?? 'HEAD^{tree}', tree]).split('\n').filter(Boolean)
  } catch {
    // Arbre de référence disparu (git gc) : tout vérifier.
  }
  if (changed && changed.every((path) => path.endsWith('.md'))) return

  if (tree === state.red) {
    console.log(JSON.stringify({ systemMessage: '`npm run check` est rouge sur l’état actuel du code : à corriger avant de pousser.' }))
    return
  }

  // Environnement faux : le check échouerait sans que le code y soit pour
  // rien. L'humain est prévenu ; l'agent n'est pas bloqué.
  const environment =
    nodeMismatch(readText(resolve(root, '.nvmrc')), process.version) ??
    staleDependencies(readJson(resolve(root, 'package-lock.json')), readJson(resolve(root, 'node_modules/.package-lock.json')))
  if (environment) {
    console.log(JSON.stringify({ systemMessage: `\`npm run check\` non lancé, le code n’est pas en cause : ${environment}.` }))
    return
  }

  const check = spawnSync('npm run check', {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    timeout: 280_000,
  })
  if (check.status === 0) {
    writeFileSync(stateFile, JSON.stringify({ green: tree }))
    return
  }
  writeFileSync(stateFile, JSON.stringify({ green: state.green, red: tree }))
  const output = `${check.stdout ?? ''}${check.stderr ?? ''}`.trim().split('\n').slice(-MAX_OUTPUT_LINES).join('\n')
  console.log(JSON.stringify({ decision: 'block', reason: blockReason(changed, output || check.error?.message || '') }))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}

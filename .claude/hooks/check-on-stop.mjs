// Hook Stop de Claude Code (ADR-005 §4) : un tour ne se conclut pas avec
// `npm run check` rouge (AGENTS.md, « Harnais de validation », règle 1).
//
// Le check tourne quand la copie de travail (fichiers suivis et nouveaux, hors
// Markdown) diffère du dernier état vérifié vert. Rouge, la fin du tour est
// refusée une fois et l'agent reçoit la fin de la sortie. Un état déjà signalé
// rouge n'est ni revérifié ni bloqué de nouveau, même au tour suivant :
// l'utilisateur est seulement prévenu. Pas de boucle, pas d'insistance sur un
// code que personne n'a demandé de corriger.
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_OUTPUT_LINES = 80

/**
 * Dossier où lancer git et `npm run check`, lettre de lecteur en majuscule :
 * sous Windows, VS Code fournit `c:\…`, et Vitest lancé depuis un tel dossier
 * charge ses modules deux fois. Tous les tests échouaient alors dès
 * describe() (« reading 'config' ») sur un code vert.
 */
export function projectRoot(env, input, cwd) {
  const dir = env.CLAUDE_PROJECT_DIR || input.cwd || cwd
  return dir.replace(/^[a-z]:/, (drive) => drive.toUpperCase())
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
  console.log(JSON.stringify({
    decision: 'block',
    reason: `\`npm run check\` échoue : corriger le code avant de conclure, ou expliquer à l’utilisateur pourquoi ce n’est pas possible (AGENTS.md, « Harnais de validation »).\n\n${output || check.error?.message || ''}`,
  }))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}

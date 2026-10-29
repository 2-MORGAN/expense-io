// Hook PreToolUse de Claude Code (ADR-005 §4) : refuse les commandes shell qui
// contournent le harnais de validation (AGENTS.md, « Harnais de validation »,
// règles 4 et 5). C'est un garde-fou contre l'erreur, pas une barrière : les
// hooks git, la CI et le ruleset de `main` restent la garantie.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { realPath } from './paths.mjs'

const REPO = '2-MORGAN/expense-io'
// Dépôt du cours, dont ce dépôt est un fork : jamais une cible de PR.
const COURSE_REPO = 'NathanPrats/expense-io'

/**
 * Commande sans ses heredocs, ses here-strings PowerShell ni ses chaînes de
 * plusieurs mots : un message de commit peut citer `--no-verify` sans
 * l'utiliser. Une chaîne d'un seul mot garde son contenu (`"main"`, `"0"`).
 * Dans des guillemets doubles, le caractère d'échappement dépend du shell :
 * `\` pour Bash, l'accent grave pour PowerShell.
 */
export function withoutQuotedText(command, shell = 'Bash') {
  const escape = shell === 'PowerShell' ? '`' : '\\'
  const text = command
    .replace(/<<-?[ \t]*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?^[ \t]*\2[ \t]*\r?$/gm, ' ')
    .replace(/@(['"])[ \t]*\r?\n[\s\S]*?^\1@/gm, ' ')
  let out = ''
  let quote = null
  let content = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (!quote) {
      if (c === "'" || c === '"') {
        quote = c
        content = ''
      } else {
        out += c
      }
    } else if (quote === '"' && c === escape) {
      content += text[++i] ?? ''
    } else if (c === quote) {
      out += /\s/.test(content) ? '""' : content
      quote = null
    } else {
      content += c
    }
  }
  return quote ? `${out}""` : out
}

// `HUSKY=0 git commit`, `export HUSKY=0`, `$env:HUSKY = 0` : hooks git désactivés.
const HUSKY_OFF = /^(?:(?:export|set|env)\s+)?(?:\w+=\S*\s+)*(?:\$env:)?HUSKY\s*=\s*0(?:\s|$)/i
// Options globales de git qui prennent une valeur dans le mot suivant.
const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])
// Options de `git push` qui prennent une valeur dans le mot suivant.
const PUSH_WITH_VALUE = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec'])

/** Options globales, sous-commande et arguments de git, ou null si le segment n'appelle pas git. */
function gitInvocation(words) {
  const start = words.findIndex((word) => /(^|[\\/])git(\.exe)?$/i.test(word))
  if (start === -1) return null
  const globals = []
  let i = start + 1
  while (i < words.length && words[i].startsWith('-')) {
    if (GIT_GLOBAL_WITH_VALUE.has(words[i])) {
      globals.push(`${words[i]} ${words[i + 1] ?? ''}`)
      i += 2
    } else {
      globals.push(words[i])
      i += 1
    }
  }
  return { globals, subcommand: words[i], args: words.slice(i + 1) }
}

/**
 * `eslint --suppress-all` ou `--suppress-rule` : fige de nouveaux constats dans
 * eslint-suppressions.json, qui ne fait que raccourcir. `--prune-suppressions`
 * reste permis.
 */
function suppressesLint(words) {
  const eslint = words.some((word) => /(^|[\\/])eslint(\.js|\.cmd)?$/i.test(word))
    || (words.includes('run') && words.includes('lint'))
  return eslint && words.some((word) => /^--suppress-(all|rule)(=|$)/.test(word))
}

/** `git commit -n`, seul ou groupé (`-anm`), avant une option qui prend une valeur. */
function hasShortNoVerify(args) {
  return args.some((arg) => {
    if (!/^-[a-zA-Z]+$/.test(arg)) return false
    for (const flag of arg.slice(1)) {
      if (flag === 'n') return true
      if ('mFcCtSu'.includes(flag)) return false
    }
    return false
  })
}

/** Écrit `core.hooksPath` (`-c`, `git config … <valeur>`, `--unset`) ; la lecture reste permise. */
function writesHooksPath(git) {
  if (git.globals.some((option) => /^-c\s?core\.hookspath=/i.test(option))) return true
  if (git.subcommand !== 'config') return false
  const key = git.args.findIndex((arg) => arg.toLowerCase() === 'core.hookspath')
  if (key === -1) return false
  return ['set', 'unset'].includes(git.args[0])
    || git.args.some((arg) => /^--(unset|unset-all|add|replace-all)$/.test(arg))
    || git.args.slice(key + 1).some((arg) => !arg.startsWith('-'))
}

function pushRefusal(args, currentBranch) {
  const forced = args.some(
    (arg) => /^--(force|force-with-lease|force-if-includes|mirror)(=|$)/.test(arg) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(arg)
  )
  const refspecs = []
  for (let i = 0; i < args.length; i++) {
    if (PUSH_WITH_VALUE.has(args[i])) i++
    else if (!args[i].startsWith('-')) refspecs.push(args[i])
  }
  refspecs.shift() // le dépôt distant
  if (forced || refspecs.some((refspec) => refspec.startsWith('+'))) {
    return 'Pas de force-push pour l’IA : s’il est nécessaire (après un rebase, par exemple), demander à l’utilisateur de le faire.'
  }
  const destinations = refspecs.map((refspec) => {
    const destination = refspec.includes(':') ? refspec.slice(refspec.indexOf(':') + 1) : refspec
    return destination === 'HEAD' ? currentBranch() : destination.replace(/^refs\/heads\//, '')
  })
  // Sans destination, `git push` pousse la branche courante ; `--tags` seul ne pousse que les étiquettes.
  const toMain = args.includes('--all')
    || (refspecs.length === 0 ? !args.includes('--tags') && currentBranch() === 'main' : destinations.includes('main'))
  return toMain
    ? 'Pas de push sur `main` : pousser une branche et ouvrir une PR (`gh pr create --repo 2-MORGAN/expense-io --base main`).'
    : null
}

/**
 * Raison du refus de `command`, ou null si elle est admise. `currentBranch`
 * n'est appelée que pour un push sans destination explicite ; `shell` est le
 * nom de l'outil de Claude Code (`Bash` ou `PowerShell`).
 */
export function refusal(command, currentBranch, shell = 'Bash') {
  for (const segment of withoutQuotedText(command, shell).split(/[;&|\n()`]+|\$\(/)) {
    if (HUSKY_OFF.test(segment.trim())) {
      return '`HUSKY=0` désactive les hooks git (AGENTS.md, règle 4) : corriger la cause de l’échec du hook.'
    }
    const words = segment.trim().split(/\s+/).filter(Boolean)
    if (suppressesLint(words)) {
      return '`--suppress-all` et `--suppress-rule` figent de nouveaux constats dans eslint-suppressions.json (AGENTS.md, règle 4) : corriger le code. Après une correction, `npx eslint --prune-suppressions` raccourcit la liste.'
    }
    if (words[0] === 'gh' && words[1] === 'pr' && words[2] === 'create') {
      const flag = words.findIndex((word) => word === '--repo' || word === '-R')
      const target = flag === -1 ? words.find((word) => word.startsWith('--repo='))?.slice('--repo='.length) : words[flag + 1]
      if (!target || target.toLowerCase() === COURSE_REPO.toLowerCase()) {
        return `Préciser le dépôt : \`--repo ${REPO}\` pour ce projet. Sans \`--repo\`, \`gh\` peut ouvrir la PR sur le dépôt du cours (AGENTS.md, règle 5).`
      }
    }
    const git = gitInvocation(words)
    if (!git) continue
    if ([...git.globals, ...git.args].includes('--no-verify') || (git.subcommand === 'commit' && hasShortNoVerify(git.args))) {
      return '`--no-verify` (ou `git commit -n`) contourne les hooks git (AGENTS.md, règle 4) : corriger la cause de l’échec du hook ; si le blocage paraît injustifié, demander à l’utilisateur.'
    }
    if (writesHooksPath(git)) {
      return 'Modifier `core.hooksPath` désactive les hooks git (AGENTS.md, règle 4).'
    }
    if (git.subcommand === 'push') {
      const reason = pushRefusal(git.args, currentBranch)
      if (reason) return reason
    }
  }
  return null
}

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

export function currentBranchIn(cwd) {
  return () => {
    try {
      return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    } catch {
      return undefined
    }
  }
}

/**
 * Vrai si `cwd` est une copie de ce dépôt (worktrees compris) : une session
 * peut ouvrir d'autres dépôts, qui ont leurs propres règles. Dans le doute, le
 * garde-fou s'applique.
 */
function inThisRepository(cwd) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR
  if (!cwd || !projectDir) return true
  try {
    const commonDir = (dir) => realPath(resolve(dir, git(['rev-parse', '--git-common-dir'], dir))).toLowerCase()
    return commonDir(cwd) === commonDir(projectDir)
  } catch {
    return true
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const command = input.tool_input?.command
  const reason = typeof command === 'string' ? refusal(command, currentBranchIn(input.cwd), input.tool_name) : null
  if (reason && inThisRepository(input.cwd)) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `${reason} (.claude/hooks/guard-git.mjs, ADR-005 §4)`,
      },
    }))
  }
}

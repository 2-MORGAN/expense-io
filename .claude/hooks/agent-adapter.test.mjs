import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyChunks, claudeWrites, guard, isRecipeCall, parsePatch, promptStartsRecipe } from './agent-adapter.mjs'
import { refusal } from './guard-frozen.mjs'
import { BLOCK_MESSAGE } from './guard-recipe.mjs'

// Les garde-fous de Claude Code appliqués à OpenCode et Codex (AGENTS.md,
// « Harnais de validation ») : leurs outils d'écriture ramenés à ceux de
// Claude, pour réutiliser les mêmes règles.

const SPEC = `import { test } from './support/fixtures'

test('[MGR-01] liste les notes', async () => {
  await check(1)
})

test('[MGR-02] refuse un autre manager', async () => {
  await check(2)
})
`

const patch = (...lines) => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n')

describe('adaptateur : patch', () => {
  it('lit ajouts, modifications, suppressions et déplacements', () => {
    const ops = parsePatch(patch(
      '*** Add File: src/a.ts',
      '+export const a = 1',
      '*** Update File: src/b.ts',
      '*** Move to: src/c.ts',
      '@@ export function b',
      ' const x = 1',
      '-const y = 2',
      '+const y = 3',
      '*** Delete File: src/d.ts',
    ))
    expect(ops).toEqual([
      { type: 'add', path: 'src/a.ts', content: 'export const a = 1\n' },
      { type: 'update', path: 'src/b.ts', moveTo: 'src/c.ts', chunks: [{ old: ['const x = 1', 'const y = 2'], new: ['const x = 1', 'const y = 3'] }] },
      { type: 'delete', path: 'src/d.ts' },
    ])
  })

  it('applique les morceaux dans l’ordre, ou rend undefined si l’un est introuvable', () => {
    const chunks = [{ old: ['b'], new: ['B'] }, { old: ['d', 'e'], new: ['e'] }]
    expect(applyChunks('a\nb\nc\nd\ne\n', chunks)).toBe('a\nB\nc\ne\n')
    expect(applyChunks('a\nb\n', [{ old: ['z'], new: ['Z'] }])).toBeUndefined()
    expect(applyChunks('a\n', [{ old: [], new: ['b'] }])).toBe('a\nb\n')
  })
})

describe('adaptateur : outils d’écriture ramenés à ceux de Claude', () => {
  const read = (path) => (path === 'e2e/x.spec.ts' ? SPEC : undefined)

  it('Claude : tels quels', () => {
    const input = { file_path: 'src/a.ts', content: 'x' }
    expect(claudeWrites('Write', input, read)).toEqual([{ toolName: 'Write', input }])
    expect(claudeWrites('Read', { file_path: 'src/a.ts' }, read)).toEqual([])
  })

  it('OpenCode : edit et write, avec filePath ou path', () => {
    expect(claudeWrites('edit', { filePath: 'src/a.ts', oldString: 'a', newString: 'b', replaceAll: true }, read)).toEqual([
      { toolName: 'Edit', input: { file_path: 'src/a.ts', old_string: 'a', new_string: 'b', replace_all: true } },
    ])
    expect(claudeWrites('write', { path: 'src/a.ts', content: 'x' }, read)).toEqual([
      { toolName: 'Write', input: { file_path: 'src/a.ts', content: 'x' } },
    ])
  })

  it('apply_patch de Codex (command) et d’OpenCode (patchText) : contenu final par fichier', () => {
    const text = patch('*** Update File: e2e/x.spec.ts', '@@', '-  await check(2)', '+  await check(3)', '*** Delete File: src/old.ts')
    const expected = [
      { toolName: 'Write', input: { file_path: 'e2e/x.spec.ts', content: SPEC.replace('check(2)', 'check(3)') } },
      { toolName: 'Write', input: { file_path: 'src/old.ts', content: '' } },
    ]
    expect(claudeWrites('apply_patch', { command: text }, read)).toEqual(expected)
    expect(claudeWrites('apply_patch', { patchText: text }, read)).toEqual(expected)
  })

  it('déplacement : la source supprimée, la cible écrite ; morceau introuvable : chemin seul', () => {
    const moved = claudeWrites('apply_patch', { command: patch('*** Update File: e2e/x.spec.ts', '*** Move to: e2e/y.spec.ts') }, read)
    expect(moved).toEqual([
      { toolName: 'Write', input: { file_path: 'e2e/x.spec.ts', content: '' } },
      { toolName: 'Write', input: { file_path: 'e2e/y.spec.ts', content: SPEC } },
    ])
    const unknown = claudeWrites('apply_patch', { command: patch('*** Update File: src/a.ts', '@@', '-z', '+Z') }, read)
    expect(unknown).toEqual([{ toolName: 'Write', input: { file_path: 'src/a.ts' } }])
  })
})

describe('adaptateur : migrations et tests E2E de main figés', () => {
  const atBase = (path) => {
    if (path === 'e2e/x.spec.ts') return SPEC
    return path.startsWith('migrations/') ? 'SELECT 1;\n' : undefined
  }
  const refusals = (args) =>
    claudeWrites('apply_patch', args, (path) => atBase(path)).map(({ toolName, input }) =>
      refusal({ path: input.file_path, toolName, input, current: atBase(input.file_path), atBase })
    )

  it('refuse un patch sur une migration de main, ou qui retire un test', () => {
    expect(refusals({ command: patch('*** Update File: migrations/1700_x.sql', '@@', '-SELECT 1;', '+SELECT 2;') })[0]).toMatch(/déjà dans main/)
    expect(refusals({ command: patch('*** Delete File: e2e/x.spec.ts') })[0]).toMatch(/MGR-01/)
    expect(refusals({ patchText: patch('*** Update File: e2e/x.spec.ts', '@@', '-  await check(2)', '+  await check(3)') })[0]).toMatch(/MGR-02/)
  })

  it('laisse ajouter un test', () => {
    const add = patch('*** Update File: e2e/x.spec.ts', '@@', ' })', '+', "+test('[MGR-03] nouveau', async () => {})")
    expect(refusals({ command: add })).toEqual([null])
  })
})

describe('adaptateur : recette', () => {
  let dir
  // Lancé par un hook git (pre-push), git exporte GIT_DIR et ses voisines :
  // sans les retirer, les commandes git du test viseraient le vrai dépôt.
  let gitEnv
  beforeEach(() => {
    gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('GIT_')))
    for (const key of Object.keys(gitEnv)) delete process.env[key]
  })
  afterEach(() => {
    Object.assign(process.env, gitEnv)
    if (dir) rmSync(dir, { recursive: true, force: true })
  })
  const repo = () => {
    dir = mkdtempSync(join(tmpdir(), 'agent-adapter-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    return dir
  }

  it('reconnaît la recette : outil skill d’OpenCode, $nom ou /nom dans un prompt Codex', () => {
    expect(isRecipeCall('skill', { name: 'nouvelle-fonctionnalite' })).toBe(true)
    expect(isRecipeCall('skill', { name: 'code-review' })).toBe(false)
    expect(isRecipeCall('Skill', { skill: 'nouvelle-fonctionnalite' })).toBe(true)
    expect(promptStartsRecipe('$nouvelle-fonctionnalite ajoute un export CSV')).toBe(true)
    expect(promptStartsRecipe('/nouvelle-fonctionnalite')).toBe(true)
    expect(promptStartsRecipe('corrige le bug de nouvelle-fonctionnalite-x')).toBe(false)
  })

  it('refuse une seule fois la première écriture de code de la session, puis laisse passer', () => {
    const cwd = repo()
    const write = { tool: 'write', args: { filePath: 'src/a.ts', content: 'x' }, cwd, sessionId: 's1' }
    expect(guard({ ...write, args: { filePath: 'docs/a.md', content: 'x' } })).toBeNull()
    expect(guard(write)).toBe(BLOCK_MESSAGE)
    expect(guard(write)).toBeNull()
    expect(guard({ ...write, sessionId: 's2' })).toBe(BLOCK_MESSAGE)
  })

  it('ne refuse rien quand la recette est lancée', () => {
    const cwd = repo()
    expect(guard({ tool: 'skill', args: { name: 'nouvelle-fonctionnalite' }, cwd, sessionId: 's1' })).toBeNull()
    expect(guard({ tool: 'edit', args: { filePath: 'src/a.ts', oldString: 'a', newString: 'b' }, cwd, sessionId: 's1' })).toBeNull()
  })

  it('par un chemin à lien symbolique (macOS) : mêmes refus que par le chemin réel', () => {
    const real = realpathSync(repo())
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: real })
    mkdirSync(join(real, 'migrations'))
    writeFileSync(join(real, 'migrations', '1700_x.sql'), 'SELECT 1;\n')
    git('add', '.')
    git('commit', '-qm', 'init')
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    const link = `${real}-lien`
    symlinkSync(real, link, 'dir')
    try {
      const migration = { tool: 'edit', args: { filePath: 'migrations/1700_x.sql', oldString: '1', newString: '2' }, cwd: link, sessionId: 's1' }
      expect(guard(migration)).toMatch(/déjà dans main/)
      expect(guard({ tool: 'write', args: { filePath: `${link}/src/a.ts`, content: 'x' }, cwd: link, sessionId: 's1' })).toBe(BLOCK_MESSAGE)
    } finally {
      rmSync(link, { force: true })
    }
  })
})

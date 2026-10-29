import { win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blockReason, nodeMismatch, projectRoot, staleDependencies } from './check-on-stop.mjs'

const noGit = () => {
  throw new Error('pas de git')
}

describe('check-on-stop : dossier du check', () => {
  // VS Code fournit le dossier du projet en `c:\…` ; Vitest, lancé depuis un
  // tel dossier, fait échouer tous les tests dès describe().
  it('met la lettre de lecteur en majuscule', () => {
    expect(projectRoot({ CLAUDE_PROJECT_DIR: 'c:\\Users\\dev\\expense-io' }, {}, 'E:\\ailleurs', noGit)).toBe('C:\\Users\\dev\\expense-io')
    expect(projectRoot({}, { cwd: 'd:/dev/expense-io' }, 'E:\\ailleurs', noGit)).toBe('D:/dev/expense-io')
  })

  it('laisse les autres chemins tels quels', () => {
    expect(projectRoot({ CLAUDE_PROJECT_DIR: 'C:\\Users\\dev\\expense-io' }, {}, '/tmp', noGit)).toBe('C:\\Users\\dev\\expense-io')
    expect(projectRoot({}, {}, '/home/dev/expense-io', noGit)).toBe('/home/dev/expense-io')
  })

  // Session en worktree : CLAUDE_PROJECT_DIR désigne le checkout principal,
  // dont l'ESLint lisait les fichiers des worktrees avec des suppressions qui
  // ne leur correspondent pas (101 fausses erreurs).
  it('prend la copie de travail de la session avant le dossier du projet', () => {
    const toplevel = (dir) => (dir === '/depot/.claude/worktrees/x/src' ? '/depot/.claude/worktrees/x' : noGit())
    expect(projectRoot({ CLAUDE_PROJECT_DIR: '/depot' }, { cwd: '/depot/.claude/worktrees/x/src' }, '/courant', toplevel)).toBe(
      '/depot/.claude/worktrees/x'
    )
  })

  it('sinon le dossier du projet, celui du tour, puis le dossier courant', () => {
    expect(projectRoot({ CLAUDE_PROJECT_DIR: '/projet' }, { cwd: '/tour' }, '/courant', noGit)).toBe('/projet')
    expect(projectRoot({}, { cwd: '/tour' }, '/courant', noGit)).toBe('/tour')
    expect(projectRoot({}, {}, '/courant', noGit)).toBe('/courant')
  })

  it('Windows : la racine que donne git (`c:/…`) devient `C:\\…`', () => {
    expect(projectRoot({}, { cwd: 'c:\\dev\\x\\src' }, 'E:\\', () => 'c:/dev/x', win32)).toBe('C:\\dev\\x')
  })
})

describe('check-on-stop : environnement', () => {
  it('Node différent de .nvmrc', () => {
    expect(nodeMismatch('24\n', 'v22.14.0')).toMatch(/Node 22.*24/)
    expect(nodeMismatch('24', 'v24.22.2')).toBeNull()
    expect(nodeMismatch('v24', 'v24.1.0')).toBeNull()
    expect(nodeMismatch(undefined, 'v22.14.0')).toBeNull()
    expect(nodeMismatch('lts/*', 'v22.14.0')).toBeNull()
  })

  const lock = {
    packages: {
      '': { name: 'expense-io' },
      'node_modules/vitest': { version: '4.0.0', dev: true },
      'node_modules/@next/swc-darwin-arm64': { version: '16.0.0', optional: true },
    },
  }

  it('dépendances installées en retard sur package-lock.json', () => {
    const installed = { packages: { 'node_modules/vitest': { version: '4.0.0' } } }
    expect(staleDependencies(lock, installed)).toBeNull()
    expect(staleDependencies(lock, { packages: { 'node_modules/vitest': { version: '3.2.0' } } })).toMatch(/vitest.*npm install/)
    expect(staleDependencies(lock, { packages: {} })).toMatch(/vitest/)
    expect(staleDependencies(lock, undefined)).toMatch(/npm install/)
  })
})

describe('check-on-stop : message de blocage', () => {
  it('liste les changements de l’agent et lui interdit de toucher au reste', () => {
    const reason = blockReason(['src/a.ts', 'src/b.ts'], 'FAIL src/a.test.ts')
    expect(reason).toContain('src/a.ts, src/b.ts')
    expect(reason).toMatch(/ne modifie pas le code/i)
    expect(reason).toContain('FAIL src/a.test.ts')
    expect(blockReason(Array.from({ length: 30 }, (_, i) => `f${i}.ts`), '')).toContain('et 10 autres')
    expect(blockReason(null, 'x')).toMatch(/inconnus/)
  })
})

import { describe, expect, it } from 'vitest'
import { refusal, withoutQuotedText } from './guard-git.mjs'

const on = (branch) => () => branch

describe('guard-git : commandes refusées', () => {
  it.each([
    'git commit --no-verify -m "wip"',
    'git push --no-verify',
    'git commit -nm "wip"',
    'git commit -a -n -m "wip"',
    'HUSKY=0 git commit -m "wip"',
    'env HUSKY=0 git commit -m "wip"',
    'export HUSKY="0"',
    'git -c core.hooksPath=/dev/null commit -m "wip"',
    'git config core.hooksPath /dev/null',
    'git config --unset core.hooksPath',
    'git push origin main',
    'git push origin "main"',
    'git push origin HEAD:main',
    'git push origin feature:refs/heads/main',
    'git push origin :main',
    'git push --all origin',
    'git push -f origin feature',
    'git push -uf origin feature',
    'git push --force-with-lease origin feature',
    'git push origin +feature',
    'npm run check && git push origin main',
    'cd /c/repo; git -C . push origin main',
    'gh pr create --base main --title "x"',
    'gh pr create --repo NathanPrats/expense-io --base main',
  ])('%s', (command) => {
    expect(refusal(command, on('feature'))).not.toBeNull()
  })

  it.each(['$env:HUSKY = 0; git push', '$env:HUSKY="0"'])('PowerShell : %s', (command) => {
    expect(refusal(command, on('feature'), 'PowerShell')).toMatch(/HUSKY/)
  })

  it.each(['git push', 'git push origin', 'git push -u origin HEAD'])('« %s » depuis main', (command) => {
    expect(refusal(command, on('main'))).toMatch(/push sur `main`/)
  })
})

describe('guard-git : commandes admises', () => {
  it.each([
    'git push',
    'git push -u origin HEAD',
    'git push -u origin stanislasbeguin/2-490-journaux',
    'git push origin feature/main-menu',
    'git push --dry-run origin feature',
    'git commit -m "docs: interdire --no-verify, HUSKY=0 et le push sur main"',
    'git commit -am "fix: n’importe quoi"',
    `git commit -m "$(cat <<'EOF'\nchore: refuser git push --force et --no-verify\nEOF\n)"`,
    'git merge --no-verify-signatures feature',
    'git config core.hooksPath',
    'git config --get core.hooksPath',
    'git log --oneline -5 && git status',
    'rg -n -- --no-verify docs',
    'grep -rn HUSKY=0 .husky',
    'gh pr create --repo 2-MORGAN/expense-io --base main --title "x" --body "jamais de --no-verify"',
    'gh pr create -R "2-MORGAN/expense-io" --fill',
    'gh pr create --repo=someone/other-project --fill',
    'gh pr view 20 --repo 2-MORGAN/expense-io',
    'npm run check',
  ])('%s', (command) => {
    expect(refusal(command, on('feature'))).toBeNull()
  })

  it('git push --tags depuis main ne pousse que les étiquettes', () => {
    expect(refusal('git push --tags', on('main'))).toBeNull()
  })

  it.each([
    '$env:HUSKY="1"; git commit -m "wip"',
    'Set-Location "C:\\repo\\"; git commit -m "fix: refuser --no-verify"',
    "git commit -F - @'\nrefuser --no-verify et git push origin main\n'@",
  ])('PowerShell : %s', (command) => {
    expect(refusal(command, on('feature'), 'PowerShell')).toBeNull()
  })
})

describe('withoutQuotedText', () => {
  it('vide les chaînes de plusieurs mots et garde celles d’un seul mot', () => {
    expect(withoutQuotedText(`git commit -m "a 'b' c" -m 'd "e"' -m "wip"`)).toBe('git commit -m "" -m "" -m wip')
  })

  it('suit l’échappement de Bash dans des guillemets doubles', () => {
    expect(withoutQuotedText('echo "a \\" --no-verify" b')).toBe('echo "" b')
  })

  it('suit l’échappement de PowerShell : la barre oblique inverse est un caractère comme un autre', () => {
    expect(withoutQuotedText('cd "C:\\repo\\"; git push', 'PowerShell')).toBe('cd C:\\repo\\; git push')
  })
})

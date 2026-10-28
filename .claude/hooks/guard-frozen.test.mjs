import { describe, expect, it } from 'vitest'
import { brokenTests, isMigration, isSpec, specTests } from '../../scripts/frozen.mjs'
import { contentAfter, refusal } from './guard-frozen.mjs'

// Migrations et tests E2E déjà dans main, figés (ADR-005 §2) : la règle
// commune (scripts/frozen.mjs) et le hook qui l'applique à chaque écriture.

const SPEC = `import { expect, test } from './support/fixtures'

test.describe('Validation', () => {
  test('[MGR-01] liste les notes', async ({ page }) => {
    await expect(page).toHaveURL('/manager')
  })

  test('[MGR-02] refuse un autre manager', async ({ page }) => {
    await expect(page.getByText('Refusé')).toBeVisible()
  })
})
`

describe('frozen : fichiers concernés', () => {
  it('migrations horodatées de migrations/, scénarios .spec.ts de e2e/', () => {
    expect(isMigration('migrations/1793500000000_roles-connexion-worker.sql')).toBe(true)
    expect(isMigration('migrations/AGENTS.md')).toBe(false)
    expect(isMigration('migrations/old/1700000000001_init.sql')).toBe(false)
    expect(isMigration('scripts/1700_x.sql')).toBe(false)
    expect(isSpec('e2e/manager-approval.spec.ts')).toBe(true)
    expect(isSpec('e2e/support/api.ts')).toBe(false)
    expect(isSpec('src/domain/User.test.ts')).toBe(false)
  })
})

describe('frozen : tests d’un fichier', () => {
  it('par titre, sans commentaires ni mise en forme', () => {
    const tests = specTests(SPEC)
    expect([...tests.keys()]).toEqual(["'[MGR-01] liste les notes'", "'[MGR-02] refuse un autre manager'"])
    const reformatted = SPEC.replace("await expect(page).toHaveURL('/manager')", "// vérifie l'URL\n    await expect(page)\n      .toHaveURL('/manager')")
    expect(specTests(reformatted)).toEqual(tests)
    expect(specTests(SPEC.replace(/\n/g, '\r\n'))).toEqual(tests)
  })

  it('numérote les titres répétés (tests générés par une boucle)', () => {
    const loop = "for (const t of types) {\n  test(`[REC-01] ${t}`, async () => {})\n}\ntest(`[REC-01] ${t}`, async () => {})\n"
    expect([...specTests(loop).keys()]).toEqual(['`[REC-01] ${t}`', '`[REC-01] ${t}` (2)'])
  })

  it('signale un test modifié, désactivé ou retiré ; pas un test ajouté ni une mise en forme', () => {
    const changed = SPEC.replace("toHaveURL('/manager')", "toHaveURL('/expenses')")
    const skipped = SPEC.replace("test('[MGR-02]", "test.skip('[MGR-02]")
    const removed = SPEC.replace(/\n {2}test\('\[MGR-02\][\s\S]*?\n {2}\}\)\n/, '\n')
    const added = SPEC.replace(/\}\)\n$/, "  test('[MGR-03] nouveau', async () => {})\n})\n")
    expect(brokenTests(SPEC, changed)).toEqual(["'[MGR-01] liste les notes'"])
    expect(brokenTests(SPEC, skipped)).toEqual(["'[MGR-02] refuse un autre manager'"])
    expect(brokenTests(SPEC, removed)).toEqual(["'[MGR-02] refuse un autre manager'"])
    expect(brokenTests(SPEC, added)).toEqual([])
    expect(brokenTests(SPEC, SPEC.replace(/ {4}/g, '\t'))).toEqual([])
  })

  it('ne signale que ce que l’écriture casse, pas un test déjà modifié avant elle', () => {
    const current = SPEC.replace("toHaveURL('/manager')", "toHaveURL('/expenses')")
    const after = `${current}\ntest('[MGR-03] nouveau', async () => {})\n`
    expect(brokenTests(SPEC, after, current)).toEqual([])
  })
})

describe('guard-frozen : contenu après l’outil', () => {
  it('Edit, Edit replace_all, MultiEdit et Write', () => {
    expect(contentAfter('Edit', { old_string: 'a', new_string: 'b' }, 'a a')).toBe('b a')
    expect(contentAfter('Edit', { old_string: 'a', new_string: 'b', replace_all: true }, 'a a')).toBe('b b')
    expect(contentAfter('Edit', { old_string: 'x', new_string: '$&$1' }, 'x')).toBe('$&$1')
    expect(contentAfter('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'b', new_string: 'c' }] }, 'a')).toBe('c')
    expect(contentAfter('Write', { content: 'x\r\ny' })).toBe('x\ny')
    expect(contentAfter('Edit', { old_string: 'a\nb', new_string: 'c' }, 'a\r\nb')).toBe('c')
    expect(contentAfter('Read', { file_path: 'x' }, 'a')).toBeUndefined()
  })
})

describe('guard-frozen : refus', () => {
  const atBase = (files) => (path) => files[path]
  const MIGRATION = 'migrations/1793500000000_roles-connexion-worker.sql'

  it('refuse d’écrire dans une migration déjà dans main, pas dans une migration nouvelle', () => {
    const input = { file_path: MIGRATION, old_string: 'a', new_string: 'b' }
    expect(refusal({ path: MIGRATION, toolName: 'Edit', input, current: 'a', atBase: atBase({ [MIGRATION]: 'a' }) })).toMatch(
      /déjà dans main : .*migration nouvelle/
    )
    const fresh = 'migrations/1793700000000_nouvelle.sql'
    expect(refusal({ path: fresh, toolName: 'Write', input: { content: 'x' }, current: undefined, atBase: atBase({}) })).toBeNull()
  })

  it('refuse de modifier un test E2E de main, laisse en ajouter un', () => {
    const files = atBase({ 'e2e/manager-approval.spec.ts': SPEC })
    const path = 'e2e/manager-approval.spec.ts'
    const modify = { old_string: "toHaveURL('/manager')", new_string: "toHaveURL('/expenses')" }
    expect(refusal({ path, toolName: 'Edit', input: modify, current: SPEC, atBase: files })).toMatch(/\[MGR-01\].*ADR-005 §2/)
    const add = { old_string: '})\n', new_string: "  test('[MGR-03] nouveau', async () => {})\n})\n", replace_all: false }
    const tail = SPEC.lastIndexOf('})\n')
    const current = SPEC.slice(0, tail) + 'END' + SPEC.slice(tail)
    expect(refusal({ path, toolName: 'Edit', input: { ...add, old_string: 'END})\n' }, current, atBase: files })).toBeNull()
    expect(refusal({ path, toolName: 'Write', input: { content: '' }, current: SPEC, atBase: files })).toMatch(/\[MGR-01\].*\[MGR-02\]/)
  })

  it('laisse passer un fichier nouveau, un helper de e2e/support et le reste du dépôt', () => {
    const input = { content: 'x' }
    expect(refusal({ path: 'e2e/nouveau.spec.ts', toolName: 'Write', input, current: undefined, atBase: atBase({}) })).toBeNull()
    expect(refusal({ path: 'e2e/support/api.ts', toolName: 'Write', input, current: 'y', atBase: atBase({ 'e2e/support/api.ts': 'y' }) })).toBeNull()
    expect(refusal({ path: 'src/domain/User.ts', toolName: 'Write', input, current: 'y', atBase: atBase({ 'src/domain/User.ts': 'y' }) })).toBeNull()
  })
})

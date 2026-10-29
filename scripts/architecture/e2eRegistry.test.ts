import { describe, expect, it } from 'vitest'
import { registryGaps, registryIds, specIds } from './e2eRegistry'

const spec = (text: string, path = 'e2e/x.spec.ts') => ({ path, text })

describe('registre des E2E', () => {
  it('lit l’ID en tête du titre de chaque test, guillemets simples, doubles ou gabarit, titre à la ligne compris', () => {
    const ids = specIds([
      spec(`test('[MGR-01] liste', async () => {})\ntest("[RH-02] vide", async () => {})`),
      spec("for (const x of y) {\n  test(`[NDF-07] reçu ${x}`, async () => {})\n}\ntest(\n  '[AUTH-10a] rôle', async () => {})"),
    ])
    expect(ids).toEqual(['AUTH-10a', 'MGR-01', 'NDF-07', 'RH-02'])
  })

  it('ignore un ID cité ailleurs que dans un titre de test : commentaire, describe, assertion', () => {
    expect(
      specIds([spec("// voir [MGR-02]\ntest.describe('[RH-01] groupe', () => {})\nexpect(x).toBe('[ISO-01]')")])
    ).toEqual([])
  })

  it('lit la première colonne des tableaux du registre, fins de ligne Windows comprises', () => {
    const registry = '| ID | Scénario | Niveau |\r\n|---|---|---|\r\n| MGR-01 | liste | UI |\r\n| SIGNUP-08a | invitation | UI |\r\nTexte qui cite MGR-02 hors tableau.'
    expect(registryIds(registry)).toEqual(['MGR-01', 'SIGNUP-08a'])
  })

  it('signale un test sans ligne et une ligne sans test', () => {
    const gaps = registryGaps([spec("test('[MGR-01] a', f)\ntest('[MGR-02] b', f)")], '| MGR-01 | a |\n| MGR-09 | disparu |')
    expect(gaps).toEqual({ undocumented: ['MGR-02'], stale: ['MGR-09'] })
  })
})

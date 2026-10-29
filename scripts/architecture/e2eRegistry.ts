import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { byText, type SourceFile } from './graph'

// Registre des scénarios E2E (docs/tests/E2E.md, e2e/AGENTS.md) : chaque test
// Playwright porte un ID en tête de titre (`test('[MGR-11] …')`), et chaque ID
// a sa ligne dans un tableau du registre (`| MGR-11 | … |`). Un test sans
// ligne, ou une ligne sans test, fait échouer architecture.test.ts : le
// registre est ce que lisent les relecteurs et les correcteurs.

export const E2E_REGISTRY = 'docs/tests/E2E.md'
const E2E_DIR = 'e2e'

const SPEC = /\.spec\.ts$/
const SPEC_ID = /\btest\(\s*['"`]\[([A-Z]+-\d+[a-z]?)\]/g
const REGISTRY_ROW = /^\| ([A-Z]+-\d+[a-z]?) \|/gm

const lf = (text: string): string => text.replace(/\r\n/g, '\n')

/** Les fichiers de scénarios de `e2e/`, triés. */
export function readSpecs(root: string): SourceFile[] {
  return readdirSync(join(root, E2E_DIR))
    .filter((name) => SPEC.test(name))
    .sort(byText)
    .map((name) => ({ path: `${E2E_DIR}/${name}`, text: lf(readFileSync(join(root, E2E_DIR, name), 'utf8')) }))
}

/** IDs en tête de titre des appels `test(…)`, sans doublon, triés. */
export function specIds(specs: readonly SourceFile[]): string[] {
  const ids = specs.flatMap((spec) => [...spec.text.matchAll(SPEC_ID)].map((match) => match[1]))
  return [...new Set(ids)].sort(byText)
}

/** IDs de la première colonne des tableaux du registre, triés. */
export function registryIds(registry: string): string[] {
  return [...new Set([...lf(registry).matchAll(REGISTRY_ROW)].map((match) => match[1]))].sort(byText)
}

export interface RegistryGaps {
  /** IDs de tests absents du registre. */
  undocumented: string[]
  /** Lignes du registre sans test : scénario renommé ou supprimé. */
  stale: string[]
}

export function registryGaps(specs: readonly SourceFile[], registry: string): RegistryGaps {
  const inSpecs = specIds(specs)
  const inRegistry = registryIds(registry)
  return {
    undocumented: inSpecs.filter((id) => !inRegistry.includes(id)),
    stale: inRegistry.filter((id) => !inSpecs.includes(id)),
  }
}

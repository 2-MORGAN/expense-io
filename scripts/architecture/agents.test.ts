import { describe, expect, it } from 'vitest'
import {
  agentGaps,
  agentProblems,
  agentsWith,
  citedPaths,
  citedScripts,
  citedTargets,
  importsBlock,
  isClaudeImport,
  makeTargets,
  type AgentInputs,
} from './agents'
import type { Layer } from './layers'

// Les consignes par dossier (agents.ts) : le bloc « Peut importer » recopié
// depuis layers.ts, le CLAUDE.md qui n'importe que son AGENTS.md, puis les
// chemins, scripts npm et cibles make cités, qui doivent exister.

const LAYERS: Layer[] = [
  { path: 'src/domain', group: 'coeur', may: ['src/ports'] },
  { path: 'src/ports', group: 'coeur', may: [] },
]

const AGENTS = '# src/domain\n\n<!-- début : imports permis -->\nancien\n<!-- fin : imports permis -->\n\nSuite.\n'

describe('bloc « Peut importer »', () => {
  it('une ligne par couche, ses droits tels que layers.ts les déclare', () => {
    expect(importsBlock(['src/domain', 'src/ports'], LAYERS)).toBe(
      '\n| Module | Peut importer |\n|---|---|\n| `src/domain` | `src/ports` |\n| `src/ports` | rien |\n\n'
    )
    expect(() => importsBlock(['src/inconnue'], LAYERS)).toThrow(/src\/inconnue/)
  })

  it('recopié entre ses marqueurs, à l’identique au second passage, inchangé sans marqueurs', () => {
    const once = agentsWith(AGENTS, ['src/domain'], LAYERS)
    expect(once).toContain('| `src/domain` | `src/ports` |')
    expect(once).not.toContain('ancien')
    expect(once).toMatch(/Suite\.\n$/)
    expect(agentsWith(once, ['src/domain'], LAYERS)).toBe(once)
    expect(agentsWith(AGENTS.replace(/\n/g, '\r\n'), ['src/domain'], LAYERS)).toBe(once)
    expect(agentsWith('# sans bloc\n', ['src/domain'], LAYERS)).toBe('# sans bloc\n')
  })
})

describe('CLAUDE.md de dossier', () => {
  it('n’est que l’import de son AGENTS.md, commentaires HTML mis à part', () => {
    expect(isClaudeImport('@AGENTS.md\n')).toBe(true)
    expect(isClaudeImport('<!-- Modifier AGENTS.md. -->\r\n@AGENTS.md\r\n')).toBe(true)
    expect(isClaudeImport('@AGENTS.md\nUne consigne de plus.\n')).toBe(false)
    expect(isClaudeImport('# Consignes\n')).toBe(false)
  })
})

describe('ce que citent les consignes', () => {
  it('chemins du dépôt en code, alias @/ et cibles relatives des liens, sans motifs ni blocs de code', () => {
    const text = [
      'Voir `src/domain/expense/ReceiptAccess.ts`, `@/http/requireRole`, `docs/adr/` et `src/lib/db.ts:42`.',
      'Pas des chemins : `src/app/api/**/route.ts`, `migrations/<horodatage>_<nom>.sql`, `application/problem+json`, `route.ts`.',
      'Liens : [racine](../../CLAUDE.md), [ADR](../../docs/adr/README.md#statut), [site](https://example.com), [ici](#section).',
      '```',
      'src/absent/dans/un/bloc.ts',
      '`src/absent/dans/un/bloc.ts`',
      '```',
    ].join('\n')
    expect(citedPaths('src/domain/AGENTS.md', text)).toEqual([
      'CLAUDE.md',
      'docs/adr',
      'docs/adr/README.md',
      'src/domain/expense/ReceiptAccess.ts',
      'src/http/requireRole',
      'src/lib/db.ts',
    ])
  })

  it('scripts npm et cibles make, en code en ligne comme dans les blocs', () => {
    const text = [
      'Lancer `npm run check`, `npm run reconcile:orphan-receipts -- --execute` et `make test-e2e`.',
      'En prose, npm run absent et make absente ne comptent pas ; `make` seul non plus.',
      '```bash',
      'npm run migrate:up && make dev',
      '```',
    ].join('\n')
    expect(citedScripts(text)).toEqual(['check', 'migrate:up', 'reconcile:orphan-receipts'])
    expect(citedTargets(text)).toEqual(['dev', 'test-e2e'])
  })

  it('lit les cibles d’un Makefile, sans les affectations', () => {
    expect(makeTargets('X := 1\nhelp: ## Aide\n\techo\ntest-e2e: up\n.PHONY: help\n')).toEqual(['help', 'test-e2e'])
  })
})

describe('écarts des consignes', () => {
  const dirs = [
    { dir: 'src/domain', layers: ['src/domain'] },
    { dir: 'docs', layers: [] },
  ]
  const fresh = agentsWith(AGENTS, ['src/domain'], LAYERS)
  const inputs = (files: Record<string, string>, found: string[] = Object.keys(files)): AgentInputs => ({
    files,
    found,
    scripts: ['check'],
    targets: ['dev'],
    exists: (path) => ['src/domain', 'src/ports', 'CLAUDE.md'].includes(path),
  })

  it('aucun écart quand tout est en place', () => {
    const gaps = agentGaps(
      inputs({
        'AGENTS.md': 'Voir [CLAUDE.md](CLAUDE.md), `npm run check`, `make dev`.\n',
        'CLAUDE.md': '@AGENTS.md\n',
        'src/domain/AGENTS.md': fresh,
        'src/domain/CLAUDE.md': '@AGENTS.md\n',
        'docs/AGENTS.md': '# docs\n',
        'docs/CLAUDE.md': '@AGENTS.md\n',
      }),
      dirs,
      LAYERS,
      ['src/ports']
    )
    expect(agentProblems(gaps)).toEqual([])
  })

  it('signale fichiers manquants ou en trop, import, couches, bloc périmé, chemins, scripts et cibles', () => {
    const gaps = agentGaps(
      inputs(
        {
          'AGENTS.md': '`src/disparu.ts`, `npm run absent`, `make absente`.\n',
          'CLAUDE.md': '# Racine\n',
          'src/domain/AGENTS.md': AGENTS,
          'src/domain/CLAUDE.md': '# Consignes recopiées\n',
          'docs/AGENTS.md': '# docs\n',
        },
        ['AGENTS.md', 'CLAUDE.md', 'src/domain/AGENTS.md', 'src/domain/CLAUDE.md', 'docs/AGENTS.md', 'e2e/AGENTS.md']
      ),
      dirs,
      LAYERS,
      ['src/supprimee']
    )
    expect(gaps).toEqual({
      missing: ['docs/CLAUDE.md'],
      notImporting: ['CLAUDE.md', 'src/domain/CLAUDE.md'],
      undeclared: ['e2e/AGENTS.md'],
      layers: ['src/ports : couche sans consignes', 'src/supprimee : absente de layers.ts'],
      staleImports: ['src/domain/AGENTS.md'],
      deadPaths: ['AGENTS.md : src/disparu.ts'],
      unknownScripts: ['AGENTS.md : absent'],
      unknownTargets: ['AGENTS.md : absente'],
    })
    expect(agentProblems(gaps)).toHaveLength(8)
  })

  it('signale un AGENTS.md de couche sans marqueurs', () => {
    const gaps = agentGaps(inputs({ 'src/domain/AGENTS.md': '# sans bloc\n' }), dirs, LAYERS, ['src/ports'])
    expect(gaps.staleImports).toEqual(['src/domain/AGENTS.md : marqueurs absents'])
  })
})

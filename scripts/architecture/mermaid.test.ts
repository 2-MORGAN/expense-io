import { describe, expect, it } from 'vitest'
import type { Architecture, LayerGraph } from './graph'
import { freeId, label, layersMermaid, readmeWith, routesMermaid } from './mermaid'
import type { RouteGuards } from './routes'

// Le texte Mermaid (mermaid.ts) : exact et déterministe, des étiquettes qui
// ne cassent jamais le dessin, et la recopie des graphes dans le README.

const body = (text: string) => text.split('\n').slice(2)

describe('graphes en Mermaid', () => {
  it('couches : couleur par groupe, legacy en orange, interdit en rouge', () => {
    const arch: Architecture = {
      layers: [
        { path: 'src/app/api', group: 'entrees', label: 'routes', may: [] },
        { path: 'src/domain', group: 'coeur', may: [] },
        { path: 'src/lib/db', group: 'infra', may: [] },
      ],
      packages: [{ name: 'pg', packages: ['pg'] }],
      legacy: [],
    }
    const graph: LayerGraph = {
      modules: ['src/app/api', 'src/domain', 'src/lib/db', 'pg'],
      edges: [
        { from: 'src/app/api', to: 'src/domain', verdict: 'allowed' },
        { from: 'src/app/api', to: 'src/lib/db', verdict: 'legacy' },
        { from: 'src/domain', to: 'pg', verdict: 'forbidden' },
        { from: 'src/lib/db', to: 'pg', verdict: 'allowed' },
      ],
      unclassified: [],
      unsure: [],
      staleLegacy: [],
    }
    const text = layersMermaid(graph, arch)
    expect(text.startsWith('flowchart TB\n  %% Généré par npm run generate:architecture')).toBe(true)
    expect(body(text)).toEqual([
      '  m_app_2f_api["routes"]',
      '  m_domain["domain"]',
      '  m_lib_2f_db["lib/db"]',
      '  p_pg(["pg"])',
      '  m_app_2f_api --> m_domain',
      '  m_app_2f_api -.->|"legacy"| m_lib_2f_db',
      '  m_domain -->|"interdit"| p_pg',
      '  m_lib_2f_db --> p_pg',
      '  linkStyle 1 stroke:#ea580c,stroke-width:2px,color:#ea580c',
      '  linkStyle 2 stroke:#dc2626,stroke-width:2px,color:#dc2626',
      '  classDef entrees fill:#dbeafe,stroke:#2563eb,color:#111827',
      '  class m_app_2f_api entrees',
      '  classDef coeur fill:#dcfce7,stroke:#16a34a,color:#111827',
      '  class m_domain coeur',
      '  classDef infra fill:#fef9c3,stroke:#a16207,color:#111827',
      '  class m_lib_2f_db infra',
      '  classDef paquet fill:#f3f4f6,stroke:#6b7280,color:#111827',
      '  class p_pg paquet',
      '',
    ])
  })

  it('routes : une garde par nœud, une flèche par méthode, la méthode sans garde en rouge', () => {
    const routes: RouteGuards = {
      methods: [
        { method: 'GET', route: '/api/a', guard: { kind: 'role', role: 'manager' } },
        { method: 'POST', route: '/api/a', guard: { kind: 'none', reason: 'aucune garde' } },
        { method: 'GET', route: '/api/auth', guard: { kind: 'public' } },
      ],
      stalePublic: [],
    }
    expect(body(routesMermaid(routes))).toEqual([
      '  g_public(["Publique (PUBLIC_ROUTES)"])',
      '  g_role_manager(["Rôle manager"])',
      '  g_none(["SANS GARDE"])',
      '  r_GET_20__2f_api_2f_a["GET /api/a"]',
      '  r_POST_20__2f_api_2f_a["POST /api/a"]',
      '  r_GET_20__2f_api_2f_auth["GET /api/auth"]',
      '  g_role_manager --> r_GET_20__2f_api_2f_a',
      '  g_none --> r_POST_20__2f_api_2f_a',
      '  g_public --> r_GET_20__2f_api_2f_auth',
      '  classDef sansGarde fill:#fecaca,stroke:#dc2626,color:#111827',
      '  class g_none,r_POST_20__2f_api_2f_a sansGarde',
      '',
    ])
  })

  it('étiquettes : caractères de Mermaid codés, ni directive, ni contrôle, ni direction ; jamais vides', () => {
    expect(label('a "b" <c> & #d % e `f`')).toBe('"a #34;b#34; #60;c#62; #38; #35;d #37; e #96;f#96;"')
    expect(label('%%{init: {"theme":"dark"}}%%').slice(1, -1)).not.toMatch(/[%"]/)
    expect(label('a\u0007b‮c\n  d')).toBe('"a b c d"')
    expect(label('a\uD800b')).toBe('"a�b"')
    expect(label('  ')).toBe('"#32;"')
    expect(label('x'.repeat(150))).toBe(`"${'x'.repeat(99)}…"`)
  })

  it('identifiants : deux noms proches ne se confondent pas', () => {
    expect(freeId('a-b')).toBe('a_2d_b')
    expect(freeId('a_b')).toBe('a_5f_b')
  })

  it('README : chaque graphe recopié entre ses marqueurs, à l’identique au second passage', () => {
    const readme = '# Titre\n\n<!-- début : g.mmd -->\nancien\n<!-- fin : g.mmd -->\n\nsuite\n'
    const graphs = { 'docs/architecture/g.mmd': 'flowchart TB\n' }
    const expected = '# Titre\n\n<!-- début : g.mmd -->\n```mermaid\nflowchart TB\n```\n<!-- fin : g.mmd -->\n\nsuite\n'
    expect(readmeWith(readme, graphs)).toBe(expected)
    expect(readmeWith(expected, graphs)).toBe(expected)
    expect(readmeWith(readme.replace(/\n/g, '\r\n'), graphs)).toBe(expected)
    expect(() => readmeWith('# Titre\n', graphs)).toThrow(/marqueurs/)
  })
})

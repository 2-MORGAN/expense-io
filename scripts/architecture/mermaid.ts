import { posix } from 'node:path'
import { byText, type Architecture, type LayerGraph } from './graph'
import type { Group, Layer } from './layers'
import { routeName, type Guard, type RouteGuards, type RouteMethod } from './routes'

// Les graphes en Mermaid, texte que GitHub et la plupart des éditeurs
// dessinent. Déterministes : les mêmes graphes donnent le même texte, octet
// pour octet, fins de ligne LF. Les étiquettes sont codées (repris de
// builder, src/mermaid.ts) : un nom de dossier ou de route ne peut ni casser
// le dessin, ni y glisser une directive `%%{init: …}%%`.

const HEADER = '  %% Généré par npm run generate:architecture (scripts/architecture) : ne pas modifier à la main.'

/** Identifiant Mermaid d'un nom libre : hors lettres et chiffres ASCII, chaque caractère devient son code (`a-b` : `a_2d_b`). */
export const freeId = (raw: string): string =>
  Array.from(raw, (c) => (/^[A-Za-z0-9]$/.test(c) ? c : `_${(c.codePointAt(0) ?? 0).toString(16)}_`)).join('')

/** Contrôles de direction du texte (bidi), invisibles : ils retourneraient l'affichage d'une étiquette. */
const BIDI = /[‎‏‪-‮⁦-⁩]/g

const isControl = (c: string): boolean => {
  const code = c.codePointAt(0) ?? 0
  return code < 0x20 || (code >= 0x7f && code <= 0x9f)
}

/** Moitié de paire de substitution, seule : elle ne s'écrit pas en UTF-8. */
const isLoneSurrogate = (c: string): boolean => c.length === 1 && c >= '\uD800' && c <= '\uDFFF'

/** Un contrôle devient une espace, une moitié de paire seule devient �. */
function safeChar(c: string): string {
  if (isControl(c)) return ' '
  return isLoneSurrogate(c) ? '�' : c
}

/**
 * Texte d'une étiquette, entre guillemets : sur une ligne, sans contrôle ni
 * direction, coupé entre deux caractères, jamais vide ; « " < > & # % » et
 * l'accent grave remplacés par leur code (une directive, du HTML ou du
 * Markdown ne s'interprètent pas).
 */
export function label(text: string, max = 100): string {
  const clean = Array.from(text.replace(BIDI, ' '), safeChar)
  const flat = Array.from(clean.join('').replace(/\s+/g, ' ').trim())
  const cut = flat.length > max ? `${flat.slice(0, max - 1).join('')}…` : flat.join('')
  const coded = cut.replace(/[#"<>&%`]/g, (c) => `#${c.codePointAt(0)};`)
  return `"${coded || '#32;'}"`
}

// Une couleur par groupe plutôt que des boîtes : sans elles, la mise en page
// suit le sens des dépendances. Texte foncé sur fond clair, lisible en thème
// clair comme sombre.
const GROUP_STYLES: readonly [Group | 'paquet', string][] = [
  ['entrees', 'fill:#dbeafe,stroke:#2563eb,color:#111827'],
  ['coeur', 'fill:#dcfce7,stroke:#16a34a,color:#111827'],
  ['infra', 'fill:#fef9c3,stroke:#a16207,color:#111827'],
  ['paquet', 'fill:#f3f4f6,stroke:#6b7280,color:#111827'],
]

const LEGACY_LINK = 'stroke:#ea580c,stroke-width:2px,color:#ea580c'
const FORBIDDEN_LINK = 'stroke:#dc2626,stroke-width:2px,color:#dc2626'

/**
 * Les couches, colorées par groupe, puis les paquets ; une flèche par paire
 * de couches dont l'une importe l'autre : pleine si la matrice la permet,
 * pointillée orange « legacy » si elle est tolérée, rouge « interdit » sinon.
 */
export function layersMermaid(graph: LayerGraph, arch: Architecture): string {
  const layers = new Map<string, Layer>(arch.layers.map((l) => [l.path, l]))
  const short = (path: string) => path.replace(/^src\//, '')
  const id = (name: string) => (layers.has(name) ? `m_${freeId(short(name))}` : `p_${freeId(name)}`)
  const groupOf = (name: string): Group | 'paquet' => layers.get(name)?.group ?? 'paquet'
  const lines = ['flowchart TB', HEADER]
  for (const [group] of GROUP_STYLES)
    for (const name of graph.modules.filter((m) => groupOf(m) === group)) {
      const layer = layers.get(name)
      lines.push(layer ? `  ${id(name)}[${label(layer.label ?? short(name))}]` : `  ${id(name)}([${label(name)}])`)
    }
  const legacy: number[] = []
  const forbidden: number[] = []
  graph.edges.forEach((e, i) => {
    if (e.verdict === 'allowed') lines.push(`  ${id(e.from)} --> ${id(e.to)}`)
    else if (e.verdict === 'legacy') {
      lines.push(`  ${id(e.from)} -.->|"legacy"| ${id(e.to)}`)
      legacy.push(i)
    } else {
      lines.push(`  ${id(e.from)} -->|"interdit"| ${id(e.to)}`)
      forbidden.push(i)
    }
  })
  // linkStyle compte les flèches à partir de 0, dans l'ordre où elles sont écrites.
  if (legacy.length) lines.push(`  linkStyle ${legacy.join(',')} ${LEGACY_LINK}`)
  if (forbidden.length) lines.push(`  linkStyle ${forbidden.join(',')} ${FORBIDDEN_LINK}`)
  for (const [group, style] of GROUP_STYLES) {
    const members = graph.modules.filter((m) => groupOf(m) === group)
    if (!members.length) continue
    lines.push(`  classDef ${group} ${style}`)
    lines.push(`  class ${members.map(id).join(',')} ${group}`)
  }
  return `${lines.join('\n')}\n`
}

const GUARD_RANK: Record<Guard['kind'], number> = { public: 0, session: 1, role: 2, none: 3 }

function guardTitle(g: Guard): string {
  switch (g.kind) {
    case 'public':
      return 'Publique (PUBLIC_ROUTES)'
    case 'session':
      return 'Session requise'
    case 'role':
      return `Rôle ${g.role}`
    case 'none':
      return 'SANS GARDE'
  }
}

const guardId = (g: Guard): string => (g.kind === 'role' ? `g_role_${freeId(g.role)}` : `g_${g.kind}`)

const routeId = (m: RouteMethod): string => `r_${freeId(routeName(m))}`

/**
 * Qui peut appeler quoi : une garde par nœud à gauche, une méthode de route
 * par nœud à droite, une flèche de la garde vers chaque méthode qu'elle
 * protège. Une méthode sans garde est rouge.
 */
export function routesMermaid(routes: RouteGuards): string {
  const guards = new Map<string, Guard>()
  for (const { guard } of routes.methods) guards.set(guardId(guard), guard)
  const ordered = [...guards.values()].sort(
    (a, b) =>
      GUARD_RANK[a.kind] - GUARD_RANK[b.kind] || (a.kind === 'role' && b.kind === 'role' ? byText(a.role, b.role) : 0)
  )
  const lines = ['flowchart LR', HEADER]
  for (const g of ordered) lines.push(`  ${guardId(g)}([${label(guardTitle(g))}])`)
  for (const m of routes.methods) lines.push(`  ${routeId(m)}[${label(routeName(m))}]`)
  for (const m of routes.methods) lines.push(`  ${guardId(m.guard)} --> ${routeId(m)}`)
  const unguarded = routes.methods.filter((m) => m.guard.kind === 'none')
  if (unguarded.length) {
    lines.push('  classDef sansGarde fill:#fecaca,stroke:#dc2626,color:#111827')
    lines.push(`  class ${['g_none', ...unguarded.map(routeId)].join(',')} sansGarde`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * `doc` avec `block` entre les marqueurs du schéma `name`
 * (`<!-- début : name -->` … `<!-- fin : name -->`), à la place de ce qui s'y
 * trouvait. Lève une Error, qui situe le document par `where`, si les
 * marqueurs manquent.
 */
export function withBlock(doc: string, name: string, block: string, where: string): string {
  const start = `<!-- début : ${name} -->`
  const end = `<!-- fin : ${name} -->`
  const from = doc.indexOf(start)
  const to = doc.indexOf(end)
  if (from < 0 || to < from) throw new Error(`marqueurs « ${start} » et « ${end} » absents ${where}`)
  return `${doc.slice(0, from + start.length)}\n${block}${doc.slice(to)}`
}

/**
 * Le README avec chaque graphe recopié entre ses marqueurs, dans un bloc
 * ```mermaid que GitHub dessine. Lève une Error si des marqueurs manquent.
 */
export function readmeWith(readme: string, graphs: Readonly<Record<string, string>>): string {
  let out = readme.replace(/\r\n/g, '\n')
  for (const [file, text] of Object.entries(graphs))
    out = withBlock(out, posix.basename(file), `\`\`\`mermaid\n${text}\`\`\`\n`, 'du README')
  return out
}

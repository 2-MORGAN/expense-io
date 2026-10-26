import { posix } from 'node:path'
import { fileImports } from './imports'
import type { ExternalPackage, Layer, LegacyEdge } from './layers'

// Le graphe observé des imports entre couches (layers.ts) : une flèche par
// paire de couches dont l'une importe l'autre, sans compte, jugée permise,
// tolérée (legacy) ou interdite. Pur : les mêmes fichiers donnent le même
// graphe, dans le même ordre, quel que soit l'ordre de lecture.

export interface SourceFile {
  /** Chemin relatif au dépôt, séparé par `/`. */
  path: string
  text: string
}

export type Verdict = 'allowed' | 'legacy' | 'forbidden'

export interface Edge {
  from: string
  to: string
  verdict: Verdict
}

export interface LayerGraph {
  /** Couches qui ont au moins un fichier, puis paquets importés. */
  modules: string[]
  edges: Edge[]
  /** Fichiers de code hors de toute couche, et imports vers un chemin hors des couches. */
  unclassified: string[]
  /** Fichiers dont un import a un chemin calculé. */
  unsure: string[]
  /** Exceptions de LEGACY_EDGES qui ne servent plus. */
  staleLegacy: string[]
}

export interface Architecture {
  layers: readonly Layer[]
  packages: readonly ExternalPackage[]
  legacy: readonly LegacyEdge[]
}

export const CODE = /\.[cm]?[jt]sx?$/
// Les tests importent des fixtures et des outils de test : le graphe décrit
// le code de production.
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/

/** Ordre des chaînes par code UTF-16, le même sur tous les postes (pas de localeCompare). */
export const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export const edgeName = (e: { from: string; to: string }): string => `${e.from} → ${e.to}`

const withoutExtension = (path: string): string => path.replace(/\.d\.ts$/, '').replace(CODE, '')

/** Couche d'un chemin : la plus précise dont le dossier le contient, ou le fichier lui-même. */
export function layerOf(path: string, layers: readonly Layer[]): Layer | undefined {
  const bare = withoutExtension(path)
  let best: Layer | undefined
  for (const layer of layers) {
    if (bare !== layer.path && !bare.startsWith(`${layer.path}/`)) continue
    if (!best || layer.path.length > best.path.length) best = layer
  }
  return best
}

/** Nom du paquet d'un import : `@scope/nom/x` donne `@scope/nom`, `nom/x` donne `nom`. */
const packageName = (specifier: string): string =>
  specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/')

function packageOf(specifier: string, packages: readonly ExternalPackage[]): ExternalPackage | undefined {
  const name = packageName(specifier)
  const scope = name.startsWith('@') ? `${name.split('/')[0]}/*` : undefined
  return packages.find((p) => p.packages.includes(name) || (scope !== undefined && p.packages.includes(scope)))
}

type Target = { kind: 'module'; id: string } | { kind: 'outside'; path: string }

/** Ce que vise un import : une couche, un paquet dessiné, un chemin hors des couches, ou rien à juger. */
function targetOf(file: string, specifier: string, arch: Architecture): Target | undefined {
  let path: string | undefined
  if (specifier.startsWith('@/')) path = `src/${specifier.slice(2)}`
  else if (specifier === '.' || specifier === '..' || /^\.\.?\//.test(specifier))
    path = posix.normalize(posix.join(posix.dirname(file), specifier))
  if (path === undefined) {
    const pkg = packageOf(specifier, arch.packages)
    return pkg ? { kind: 'module', id: pkg.name } : undefined
  }
  const layer = layerOf(path, arch.layers)
  return layer ? { kind: 'module', id: layer.path } : { kind: 'outside', path }
}

/** Une déclaration qui vise une couche ou un paquet inconnu éteindrait une règle sans rien dire. */
function checkDeclaration(arch: Architecture): void {
  const known = new Set([...arch.layers.map((l) => l.path), ...arch.packages.map((p) => p.name)])
  const unknown = [
    ...arch.layers.flatMap((l) => l.may.filter((m) => !known.has(m)).map((m) => `${l.path} peut importer ${m}`)),
    ...arch.legacy.filter((e) => !known.has(e.from) || !known.has(e.to)).map((e) => `exception ${edgeName(e)}`),
  ]
  if (unknown.length) throw new Error(`layers.ts vise une couche ou un paquet inconnu : ${unknown.join(' ; ')}`)
}

export function layerGraph(files: readonly SourceFile[], arch: Architecture): LayerGraph {
  checkDeclaration(arch)
  const legacy = new Set(arch.legacy.map(edgeName))
  const used = new Set<string>()
  const edges = new Map<string, Edge>()
  const unclassified: string[] = []
  const unsure: string[] = []
  const sorted = [...files].sort((a, b) => byText(a.path, b.path))
  for (const file of sorted) {
    if (!CODE.test(file.path) || TEST.test(file.path)) continue
    const from = layerOf(file.path, arch.layers)
    if (!from) {
      unclassified.push(file.path)
      continue
    }
    used.add(from.path)
    const specifiers = fileImports(file.path, file.text)
    if (!specifiers) {
      unsure.push(file.path)
      continue
    }
    for (const specifier of specifiers) {
      const target = targetOf(file.path, specifier, arch)
      if (!target) continue
      if (target.kind === 'outside') {
        unclassified.push(`${file.path} → ${target.path}`)
        continue
      }
      if (target.id === from.path) continue
      const edge = { from: from.path, to: target.id }
      const verdict: Verdict = from.may.includes(target.id)
        ? 'allowed'
        : legacy.has(edgeName(edge))
          ? 'legacy'
          : 'forbidden'
      edges.set(edgeName(edge), { ...edge, verdict })
    }
  }
  const sortedEdges = [...edges.values()].sort((a, b) => byText(a.from, b.from) || byText(a.to, b.to))
  const packages = new Set(arch.packages.map((p) => p.name))
  const imported = new Set<string>()
  for (const { to } of sortedEdges) (packages.has(to) ? imported : used).add(to)
  return {
    modules: [...[...used].sort(byText), ...[...imported].sort(byText)],
    edges: sortedEdges,
    unclassified: [...new Set(unclassified)].sort(byText),
    unsure,
    staleLegacy: arch.legacy
      .filter((e) => edges.get(edgeName(e))?.verdict !== 'legacy')
      .map(edgeName)
      .sort(byText),
  }
}

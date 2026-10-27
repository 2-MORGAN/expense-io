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
export const byText = (a: string, b: string): number => Number(a > b) - Number(a < b)

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

type Target =
  | { kind: 'module'; id: string }
  /** Un paquet que PACKAGES ne dessine pas : jugé seulement depuis le cœur. */
  | { kind: 'external'; name: string }
  | { kind: 'outside'; path: string }

/** Chemin du dépôt qu'un import vise (alias `@/` ou chemin relatif), normalisé ; undefined pour un paquet. */
function pathOf(file: string, specifier: string): string | undefined {
  if (specifier.startsWith('@/')) return posix.normalize(`src/${specifier.slice(2)}`)
  if (specifier === '.' || specifier === '..' || /^\.\.?\//.test(specifier))
    return posix.normalize(posix.join(posix.dirname(file), specifier))
  return undefined
}

/** Ce que vise un import : une couche, un paquet, un chemin hors des couches, ou rien à juger. */
function targetOf(file: string, specifier: string, arch: Architecture): Target | undefined {
  const path = pathOf(file, specifier)
  if (path === undefined) {
    const pkg = packageOf(specifier, arch.packages)
    return pkg ? { kind: 'module', id: pkg.name } : { kind: 'external', name: packageName(specifier) }
  }
  const layer = layerOf(path, arch.layers)
  if (layer) return { kind: 'module', id: layer.path }
  // Un fichier de données ou une image hors de src/ (package.json, public/) n'est pas du code à juger.
  if (!path.startsWith('src/') && posix.extname(path) !== '' && !CODE.test(path)) return undefined
  return { kind: 'outside', path }
}

/** Une déclaration qui vise une couche ou un paquet inconnu éteindrait une règle sans rien dire. */
function checkDeclaration(arch: Architecture): void {
  const names = new Set([...arch.layers.map((l) => l.path), ...arch.packages.map((p) => p.name)])
  // Un module de Node (`node:crypto`) se nomme sans être déclaré dans PACKAGES.
  const known = (name: string) => names.has(name) || name.startsWith('node:')
  const unknown = [
    ...arch.layers.flatMap((l) => l.may.filter((m) => !known(m)).map((m) => `${l.path} peut importer ${m}`)),
    ...arch.legacy.filter((e) => !known(e.from) || !known(e.to)).map((e) => `exception ${edgeName(e)}`),
  ]
  if (unknown.length) throw new Error(`layers.ts vise une couche ou un paquet inconnu : ${unknown.join(' ; ')}`)
}

function verdictOf(from: Layer, to: string, legacy: ReadonlySet<string>): Verdict {
  if (from.may.includes(to)) return 'allowed'
  return legacy.has(edgeName({ from: from.path, to })) ? 'legacy' : 'forbidden'
}

/** Ce que la lecture des fichiers accumule. */
interface Observed {
  used: Set<string>
  edges: Map<string, Edge>
  unclassified: string[]
  unsure: string[]
}

/** La flèche vers une couche ou un paquet ; un paquet non dessiné ne se juge que depuis le cœur, qui reste pur. */
function addEdge(seen: Observed, from: Layer, to: string, external: boolean, legacy: ReadonlySet<string>): void {
  if (to === from.path || (external && from.group !== 'coeur')) return
  const edge = { from: from.path, to }
  seen.edges.set(edgeName(edge), { ...edge, verdict: verdictOf(from, to, legacy) })
}

/** Les imports d'un fichier de code, ajoutés à ce qui est observé. */
function observe(file: SourceFile, arch: Architecture, legacy: ReadonlySet<string>, seen: Observed): void {
  const from = layerOf(file.path, arch.layers)
  if (!from) {
    seen.unclassified.push(file.path)
    return
  }
  seen.used.add(from.path)
  const specifiers = fileImports(file.path, file.text)
  if (!specifiers) {
    seen.unsure.push(file.path)
    return
  }
  for (const specifier of specifiers) {
    const target = targetOf(file.path, specifier, arch)
    if (target?.kind === 'outside') seen.unclassified.push(`${file.path} → ${target.path}`)
    else if (target?.kind === 'module') addEdge(seen, from, target.id, false, legacy)
    else if (target?.kind === 'external') addEdge(seen, from, target.name, true, legacy)
  }
}

export function layerGraph(files: readonly SourceFile[], arch: Architecture): LayerGraph {
  checkDeclaration(arch)
  const legacy = new Set(arch.legacy.map(edgeName))
  const seen: Observed = { used: new Set(), edges: new Map(), unclassified: [], unsure: [] }
  for (const file of [...files].sort((a, b) => byText(a.path, b.path)))
    if (CODE.test(file.path) && !TEST.test(file.path)) observe(file, arch, legacy, seen)
  const edges = [...seen.edges.values()].sort((a, b) => byText(a.from, b.from) || byText(a.to, b.to))
  const layers = new Set(arch.layers.map((l) => l.path))
  const imported = new Set<string>()
  for (const { to } of edges) (layers.has(to) ? seen.used : imported).add(to)
  return {
    modules: [...[...seen.used].sort(byText), ...[...imported].sort(byText)],
    edges,
    unclassified: [...new Set(seen.unclassified)].sort(byText),
    unsure: seen.unsure,
    staleLegacy: arch.legacy
      .filter((e) => seen.edges.get(edgeName(e))?.verdict !== 'legacy')
      .map(edgeName)
      .sort(byText),
  }
}

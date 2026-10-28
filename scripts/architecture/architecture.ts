import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { byText, CODE, edgeName, layerGraph, type Architecture, type LayerGraph, type SourceFile } from './graph'
import { LAYERS, LEGACY_EDGES, PACKAGES, PUBLIC_ROUTES } from './layers'
import { codemap, migrationFunctions } from './codemap'
import { migrationTables } from './docs'
import { layersMermaid, routesMermaid } from './mermaid'
import { routeGuards, routeName, type RouteGuards } from './routes'

// Point commun du générateur (generate.ts) et du test du dépôt
// (architecture.test.ts) : lit src/, calcule les deux graphes et dit ce qui
// doit faire échouer la vérification.

export const ARCHITECTURE: Architecture = { layers: LAYERS, packages: PACKAGES, legacy: LEGACY_EDGES }

export const README = 'docs/architecture/README.md'

export interface Analysis {
  layers: LayerGraph
  routes: RouteGuards
  /** Graphe versionné → contenu attendu. */
  graphs: Record<string, string>
}

/** Les fichiers de code sous `dir`, lus sur le disque, triés, dossiers cachés compris ; liens symboliques ignorés. */
export function readSources(root: string, dir = 'src'): SourceFile[] {
  const out: SourceFile[] = []
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...readSources(root, path))
    else if (entry.isFile() && CODE.test(entry.name))
      out.push({ path, text: readFileSync(join(root, path), 'utf8').replace(/^﻿/, '') })
  }
  return out.sort((a, b) => byText(a.path, b.path))
}

export function analyze(
  sources: readonly SourceFile[],
  arch: Architecture = ARCHITECTURE,
  publicRoutes: readonly string[] = PUBLIC_ROUTES
): Analysis {
  const layers = layerGraph(sources, arch)
  const routes = routeGuards(sources, publicRoutes)
  return {
    layers,
    routes,
    graphs: {
      'docs/architecture/layers.mmd': layersMermaid(layers, arch),
      'docs/architecture/routes.mmd': routesMermaid(routes),
    },
  }
}

/** Les fichiers d'un dossier du dépôt dont le nom correspond, triés ; vide si le dossier manque. */
function readFlat(root: string, dir: string, name: RegExp): SourceFile[] {
  let entries: string[]
  try {
    entries = readdirSync(join(root, dir))
  } catch {
    return []
  }
  return entries
    .filter((entry) => name.test(entry))
    .sort(byText)
    .map((entry) => ({ path: `${dir}/${entry}`, text: readFileSync(join(root, dir, entry), 'utf8').replace(/\r\n/g, '\n') }))
}

/** La carte du code (CODEMAP.md), depuis src/, les migrations et les specs E2E. */
export function codemapFor(root: string, sources: readonly SourceFile[], analysis: Analysis): string {
  const migrations = readFlat(root, 'migrations', /\.sql$/)
  return codemap({
    sources,
    methods: analysis.routes.methods,
    tables: migrationTables(migrations),
    sqlFunctions: migrationFunctions(migrations),
    specs: readFlat(root, 'e2e', /\.spec\.ts$/),
  })
}

/** Ce qui fait échouer la vérification, en plus d'un graphe qui a dérivé du code. */
export function problems({ layers, routes }: Analysis): string[] {
  const list = (title: string, items: readonly string[]) => (items.length ? [`${title} : ${items.join(' ; ')}`] : [])
  return [
    ...list(
      'flèche interdite entre couches (scripts/architecture/layers.ts)',
      layers.edges.filter((e) => e.verdict === 'forbidden').map(edgeName)
    ),
    ...list('fichier ou import hors des couches déclarées dans layers.ts', layers.unclassified),
    ...list('import au chemin calculé, que le graphe ne sait pas juger', layers.unsure),
    ...list('exception de LEGACY_EDGES qui ne sert plus, à retirer', layers.staleLegacy),
    ...list(
      'route sans garde',
      routes.methods.flatMap((m) => (m.guard.kind === 'none' ? [`${routeName(m)} (${m.guard.reason})`] : []))
    ),
    ...list('entrée de PUBLIC_ROUTES sans route, à retirer', routes.stalePublic),
  ]
}

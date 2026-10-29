import { readdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { byText, type SourceFile } from './graph'
import { withBlock } from './mermaid'

// La page des développeurs (docs/index.html) et ses schémas : les graphes
// générés depuis le code (layers.mmd, routes.mmd) et les vues écrites à la
// main (docs/architecture/vues/*.mmd), recopiés dans la page entre leurs
// marqueurs, comme dans le README de docs/architecture. Le texte de la page
// s'écrit à la main ; architecture.test.ts vérifie qu'il ne perd ni une ADR,
// ni une table, ni un type d'événement de l'outbox (AGENTS.md,
// « Documentation développeur »).

export const DOC_PAGE = 'docs/index.html'
/** Dossier des schémas : la page nomme chacun par son chemin depuis ce dossier (`layers.mmd`, `vues/systeme.mmd`). */
export const DIAGRAMS = 'docs/architecture'
export const VIEWS = `${DIAGRAMS}/vues`
/** Vue du schéma des données, comparée aux tables des migrations. */
export const DATA_VIEW = 'vues/schema.mmd'
const ADR_DIR = 'docs/adr'
const MIGRATIONS = 'migrations'

const START = '<!-- début : '

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

/** Texte sûr dans un élément HTML ; Mermaid relit les entités avant de dessiner. */
export const escapeHtml = (text: string): string => text.replace(/[&<>]/g, (c) => ESCAPES[c])

const lf = (text: string): string => text.replace(/\r\n/g, '\n')

/** Les fichiers `ext` de `dir`, triés, lus sur le disque (fins de ligne LF). */
function readDir(root: string, dir: string, ext: string): SourceFile[] {
  return readdirSync(join(root, dir))
    .filter((name) => name.endsWith(ext))
    .sort(byText)
    .map((name) => ({ path: `${dir}/${name}`, text: lf(readFileSync(join(root, dir, name), 'utf8')) }))
}

/** Les vues écrites à la main, par chemin depuis la racine du dépôt. */
export function readViews(root: string): Record<string, string> {
  return Object.fromEntries(readDir(root, VIEWS, '.mmd').map((file) => [file.path, file.text]))
}

/** Les schémas de la page par nom de marqueur : graphes générés, puis vues. */
export function pageDiagrams(...sets: readonly Readonly<Record<string, string>>[]): Record<string, string> {
  return Object.fromEntries(
    sets.flatMap((set) => Object.entries(set)).map(([file, text]) => [posix.relative(DIAGRAMS, file), text])
  )
}

/** Les schémas que nomment les marqueurs de début de la page. */
export function pageMarkers(page: string): string[] {
  return page
    .split(START)
    .slice(1)
    .map((rest) => {
      const end = rest.indexOf(' -->')
      return end < 0 ? rest : rest.slice(0, end)
    })
}

/**
 * La page avec chaque schéma recopié entre ses marqueurs, dans un
 * `<pre class="mermaid">` que la page dessine. Un schéma sans marqueurs est
 * laissé aux écarts (`docGaps`) ; un marqueur de fin manquant lève une Error.
 */
export function pageWith(page: string, diagrams: Readonly<Record<string, string>>): string {
  let out = lf(page)
  const markers = pageMarkers(out)
  for (const [name, text] of Object.entries(diagrams)) {
    if (!markers.includes(name)) continue
    out = withBlock(out, name, `<pre class="mermaid">\n${escapeHtml(text)}</pre>\n`, `de ${DOC_PAGE}`)
  }
  return out
}

// Nom de table, avec ou sans schéma `public.`, entre guillemets ou non.
const TABLE = String.raw`(?:"?public"?\.)?"?(\w+)"?`
const CREATE_TABLE = new RegExp(String.raw`^\s*CREATE TABLE (?:IF NOT EXISTS )?${TABLE}`, 'i')
const DROP_TABLE = new RegExp(String.raw`^\s*DROP TABLE (?:IF EXISTS )?${TABLE}`, 'i')
const RENAME_TABLE = new RegExp(String.raw`^\s*ALTER TABLE (?:IF EXISTS )?(?:ONLY )?${TABLE} RENAME TO "?(\w+)"?`, 'i')

/** Tables que laissent les migrations, prises dans l'ordre, partie « Up » seulement. */
export function migrationTables(migrations: readonly SourceFile[]): string[] {
  const tables = new Set<string>()
  for (const { text } of [...migrations].sort((a, b) => byText(a.path, b.path))) {
    const up = lf(text).split('-- Down Migration')[0]
    for (const line of up.split('\n')) {
      const created = CREATE_TABLE.exec(line)?.[1]
      if (created) tables.add(created.toLowerCase())
      const dropped = DROP_TABLE.exec(line)?.[1]
      if (dropped) tables.delete(dropped.toLowerCase())
      const renamed = RENAME_TABLE.exec(line)
      if (renamed && tables.delete(renamed[1].toLowerCase())) tables.add(renamed[2].toLowerCase())
    }
  }
  return [...tables].sort(byText)
}

const SCRIPT_TAG = /<script\b[^>]*>/gi

/**
 * Scripts externes de la page sans empreinte (SRI) ni `crossorigin` : un
 * fichier modifié sur le CDN y serait exécuté. Un script inline n'est pas visé.
 */
export function unpinnedScripts(page: string): string[] {
  return [...page.matchAll(SCRIPT_TAG)]
    .map((match) => match[0])
    .filter((tag) => /\ssrc=/i.test(tag))
    .filter((tag) => !/\sintegrity="sha(256|384|512)-[\w+/=]+"/i.test(tag) || !/\scrossorigin=/i.test(tag))
    .map((tag) => /\ssrc="([^"]*)"/i.exec(tag)?.[1] ?? tag)
}

const ER_ENTITY = /^\s*(\w+)\s*\{/

/** Entités d'un schéma Mermaid `erDiagram` : chaque bloc `nom {`. */
export function erEntities(mmd: string): string[] {
  const names = lf(mmd)
    .split('\n')
    .flatMap((line) => ER_ENTITY.exec(line)?.slice(1, 2) ?? [])
  return [...new Set(names)].sort(byText)
}

const EVENT_TYPE = /^export const [A-Z_]+ = '([a-z_]+(?:\.[a-z_]+)+)'/gm
const TEST = /\.test\.[cm]?[jt]sx?$/

/** Types d'événements de l'outbox : les constantes `export const X = 'a.b'` du domaine, hors tests. */
export function outboxEventTypes(sources: readonly SourceFile[]): string[] {
  const types = sources
    .filter((file) => file.path.startsWith('src/domain/') && !TEST.test(file.path))
    .flatMap((file) => [...file.text.matchAll(EVENT_TYPE)].map((match) => match[1]))
  return [...new Set(types)].sort(byText)
}

const ADR_FILE = /^ADR-(\d{3})-[\w-]+\.md$/

/** Numéros des ADR (`ADR-001-titre.md` : `001`), sans le modèle `000`. */
export function adrNumbers(files: readonly string[]): string[] {
  return files
    .flatMap((file) => ADR_FILE.exec(file)?.slice(1, 2) ?? [])
    .filter((n) => n !== '000')
    .sort(byText)
}

export interface DocInputs {
  /** Noms des fichiers de docs/adr. */
  adrFiles: string[]
  migrations: SourceFile[]
  /** Fichiers de src/, pour les types d'événements. */
  sources: readonly SourceFile[]
}

export function readDocInputs(root: string, sources: readonly SourceFile[]): DocInputs {
  return {
    adrFiles: readdirSync(join(root, ADR_DIR)).sort(byText),
    migrations: readDir(root, MIGRATIONS, '.sql'),
    sources,
  }
}

export interface DocGaps {
  /** Schémas sans marqueurs dans la page. */
  unplaced: string[]
  /** Marqueurs de la page sans schéma : schéma supprimé ou renommé. */
  staleMarkers: string[]
  /** ADR de docs/adr sans fiche `id="adr-NNN"` dans la page. */
  adrs: string[]
  /** Tables des migrations absentes du schéma des données. */
  tables: string[]
  /** Entités du schéma des données qui ne sont pas des tables. */
  staleEntities: string[]
  /** Types d'événements de l'outbox que la page ne cite pas. */
  events: string[]
  /** Scripts externes chargés sans empreinte SRI. */
  scripts: string[]
}

/** Ce qui manque à la page, ou ce qu'elle présente encore à tort. */
export function docGaps(page: string, diagrams: Readonly<Record<string, string>>, inputs: DocInputs): DocGaps {
  const markers = pageMarkers(page)
  const tables = migrationTables(inputs.migrations)
  const entities = erEntities(diagrams[DATA_VIEW] ?? '')
  return {
    unplaced: Object.keys(diagrams).filter((name) => !markers.includes(name)),
    staleMarkers: markers.filter((name) => !(name in diagrams)),
    adrs: adrNumbers(inputs.adrFiles)
      .filter((n) => !page.includes(`id="adr-${n}"`))
      .map((n) => `ADR-${n}`),
    tables: tables.filter((table) => !entities.includes(table)),
    staleEntities: entities.filter((entity) => !tables.includes(entity)),
    events: outboxEventTypes(inputs.sources).filter((type) => !page.includes(type)),
    scripts: unpinnedScripts(page),
  }
}

/** Les écarts en messages : ce qui fera échouer architecture.test.ts. */
export function docProblems(gaps: DocGaps): string[] {
  const list = (title: string, items: readonly string[]) => (items.length ? [`${title} : ${items.join(' ; ')}`] : [])
  return [
    ...list(`schéma sans marqueurs dans ${DOC_PAGE}`, gaps.unplaced),
    ...list(`marqueur de ${DOC_PAGE} sans schéma`, gaps.staleMarkers),
    ...list(`ADR sans fiche (id="adr-NNN") dans ${DOC_PAGE}`, gaps.adrs),
    ...list(`table absente de ${DIAGRAMS}/${DATA_VIEW}`, gaps.tables),
    ...list(`entité de ${DIAGRAMS}/${DATA_VIEW} qui n'est plus une table`, gaps.staleEntities),
    ...list(`type d'événement de l'outbox absent de ${DOC_PAGE}`, gaps.events),
    ...list(`script externe sans integrity="sha384-…" ni crossorigin dans ${DOC_PAGE}`, gaps.scripts),
  ]
}

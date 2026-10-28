import { readdirSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { getMigrationFilePaths } from 'node-pg-migrate/migration'
import { describe, expect, it } from 'vitest'

// node-pg-migrate lit tous les fichiers de migrations/ sauf ceux qui
// commencent par un point : sans `--ignore-pattern`, les consignes du dossier
// (AGENTS.md, CLAUDE.md) passeraient pour des migrations et `npm run
// migrate:up` échouerait. Le motif des scripts npm n'y garde que les fichiers
// horodatés ; il est passé ici à la fonction même dont se sert la CLI.

const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts
const IGNORE_PATTERN = /--ignore-pattern "([^"]+)"/

describe.each(['migrate:up', 'migrate:down'])('npm run %s', (name) => {
  it('ne lit que les migrations SQL horodatées de migrations/', async () => {
    const pattern = IGNORE_PATTERN.exec(scripts[name])?.[1]
    expect(pattern, `${name} : ajouter --ignore-pattern "[^0-9].*"`).toBeDefined()
    const files = (await getMigrationFilePaths('migrations', { ignorePattern: pattern })).map((file) => basename(file))
    const sql = readdirSync('migrations').filter((file) => /^\d+_[\w-]+\.sql$/.test(file))
    expect(files).toEqual(sql)
    expect(readdirSync('migrations')).toContain('AGENTS.md')
  })
})

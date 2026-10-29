import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import {
  LEGACY_DB_ACCESS,
  LEGACY_GET_POOL,
  LEGACY_SQL_INTERPOLATION,
} from './eslint.config.mjs'

// Test des règles d'architecture de eslint.config.mjs (ADR-005 T6) : chaque
// règle doit bloquer le code qu'elle vise, et chaque entrée des listes LEGACY_*
// doit encore en avoir besoin. Une règle qui cesse de se déclencher, ou un
// fichier devenu conforme mais resté dans une liste, fait échouer ce test.

const eslint = new ESLint({ cwd: process.cwd() })

async function messagesFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(process.cwd(), filePath) })
  return result.messages.filter((m) => m.severity === 2).map((m) => m.message)
}

// Un motif glob échappe les segments dynamiques ([id]) : on retrouve le chemin.
const unescape = (path: string) => path.replace(/\\([[\]])/g, '$1')

// Même dossier, nom absent des listes LEGACY_* : les règles s'y appliquent.
const asNewFile = (path: string) => join(dirname(unescape(path)), '__stale-check__.ts')

describe('règles d’architecture', () => {
  describe('routes et UI (src/app, src/components)', () => {
    it.each([
      ['getPool', `import { getPool } from '@/lib/db'\nexport const x = getPool`],
      ['pg', `import { Pool } from 'pg'\nexport const x = Pool`],
    ])('refusent l’import de %s', async (_name, code) => {
      const messages = await messagesFor(code, 'src/app/api/new/route.ts')
      expect(messages.join('\n')).toMatch(/accès à la base/)
    })

    it('refusent du SQL en dur', async () => {
      const messages = await messagesFor(
        `export const q = 'SELECT id FROM expense_notes WHERE id = $1'`,
        'src/components/New.tsx'
      )
      expect(messages.join('\n')).toMatch(/Pas de SQL/)
    })

    it('acceptent une route sans SQL ni accès base', async () => {
      const messages = await messagesFor(
        `export async function GET() { return Response.json({ ok: true }) }`,
        'src/app/api/new/route.ts'
      )
      expect(messages).toEqual([])
    })
  })

  describe('SQL construit par interpolation', () => {
    it.each([
      ['gabarit en majuscules', 'export const q = (s: string) => `SELECT id FROM t ORDER BY ${s}`'],
      ['gabarit en minuscules', 'export const q = (s: string) => `select id from t order by ${s}`'],
      ['gabarit en casse mixte', 'export const q = (s: string) => `Select id From t Where a = ${s}`'],
      ['concaténation en majuscules', `export const q = (s: string) => 'SELECT id FROM t ORDER BY ' + s`],
      ['concaténation en minuscules', `export const q = (s: string) => 'select id from t order by ' + s`],
      ['insert en minuscules', 'export const q = (s: string) => `insert into t (a) values (${s})`'],
      ['update en minuscules', 'export const q = (s: string) => `update t set a = ${s}`'],
    ])('refusent un %s', async (_name, code) => {
      const messages = await messagesFor(code, 'src/lib/new.ts')
      expect(messages.join('\n')).toMatch(/interpolation/)
    })

    it.each([
      ['requête paramétrée', 'export const q = `select id from t where a = $1`'],
      ['message courant', 'export const m = (n: string) => `Impossible de choisir ${n} from the list`'],
      ['classe CSS', 'export const c = (n: string) => `bg-gradient-to-r from-${n} to-white`'],
    ])('acceptent une %s', async (_name, code) => {
      const messages = await messagesFor(code, 'src/lib/new.ts')
      expect(messages).toEqual([])
    })
  })

  describe('getPool()', () => {
    it('est refusé hors de src/lib/db.ts', async () => {
      const messages = await messagesFor(
        `import { getPool } from './db'\nexport const x = getPool`,
        'src/lib/new.ts'
      )
      expect(messages.join('\n')).toMatch(/getPool\(\)/)
    })

    it('reste permis dans src/lib/db.ts', async () => {
      const messages = await messagesFor(
        `import { getPool } from './db'\nexport const x = getPool`,
        'src/lib/db.ts'
      )
      expect(messages).toEqual([])
    })
  })

  describe('withSystemTransaction() (2-481)', () => {
    const code = `import { withSystemTransaction } from '@/lib/db'\nexport const x = withSystemTransaction`

    it('est refusé hors du worker, de l’outbox et des lectures avant session', async () => {
      const messages = await messagesFor(code, 'src/adapters/NewRepository.ts')
      expect(messages.join('\n')).toMatch(/withSystemTransaction\(\) ne pose aucun contexte/)
    })

    it.each(['src/worker/new.ts', 'src/lib/outbox.ts', 'src/modules/identity/adapters/PostgresAccountRegistry.ts'])(
      'reste permis dans %s, où getPool() reste refusé',
      async (path) => {
        expect(await messagesFor(code, path)).toEqual([])
        const pool = await messagesFor(`import { getPool } from '@/lib/db'\nexport const x = getPool`, path)
        expect(pool.join('\n')).toMatch(/getPool\(\)/)
      }
    )
  })

  describe('domaine (src/domain)', () => {
    it.each([
      ['pg', `import { Pool } from 'pg'`],
      ['next/server', `import { NextResponse } from 'next/server'`],
      ['next-auth', `import { auth } from 'next-auth'`],
      ['@aws-sdk', `import { S3Client } from '@aws-sdk/client-s3'`],
      ['tesseract.js', `import Tesseract from 'tesseract.js'`],
      ['react', `import { useState } from 'react'`],
      ['@/lib', `import { getPool } from '@/lib/db'`],
      ['../lib', `import { getPool } from '../lib/db'`],
      ['@/adapters', `import { S3ReceiptAdapter } from '@/adapters/S3ReceiptAdapter'`],
      ['@/components', `import { NavItem } from '@/components/NavItem'`],
    ])('refuse l’import de %s', async (_name, line) => {
      const messages = await messagesFor(`${line}\nexport const x = 1`, 'src/domain/New.ts')
      expect(messages.join('\n')).toMatch(/domaine reste pur/)
    })

    it('accepte un import d’un port ou d’un autre fichier du domaine', async () => {
      const messages = await messagesFor(
        `import type { ReceiptStoragePort } from '@/ports/ReceiptStoragePort'\nimport type { User } from './User'\nexport type X = [ReceiptStoragePort, User]`,
        'src/domain/New.ts'
      )
      expect(messages).toEqual([])
    })
  })

  describe('tests désactivés', () => {
    it.each(['only', 'skip', 'fixme', 'fail', 'fails'])('refusent .%s', async (property) => {
      const messages = await messagesFor(
        `declare const test: Record<string, (...a: unknown[]) => void>\ntest.${property}('a', () => {})`,
        'src/utils/new.test.ts'
      )
      expect(messages.join('\n')).toMatch(new RegExp(`'${property}' is restricted`))
    })

    it('refusent aussi .skip dans e2e/', async () => {
      const messages = await messagesFor(
        `declare const test: Record<string, (...a: unknown[]) => void>\ntest.skip('a', () => {})`,
        'e2e/new.spec.ts'
      )
      expect(messages.join('\n')).toMatch(/'skip' is restricted/)
    })

    it('refusent aussi .only dans les tests de scripts/', async () => {
      const messages = await messagesFor(
        `declare const it: Record<string, (...a: unknown[]) => void>\nit.only('a', () => {})`,
        'scripts/architecture/new.test.ts'
      )
      expect(messages.join('\n')).toMatch(/'only' is restricted/)
    })
  })
})

describe('listes LEGACY_*', () => {
  it('ne contiennent aucun doublon', () => {
    for (const list of [LEGACY_DB_ACCESS, LEGACY_GET_POOL, LEGACY_SQL_INTERPOLATION]) {
      expect(new Set(list).size).toBe(list.length)
    }
  })

  // Chaque fichier listé doit encore enfreindre la règle : sinon il est
  // conforme et doit sortir de la liste (CLAUDE.md : les listes ne font que
  // raccourcir).
  it.each(LEGACY_DB_ACCESS)('LEGACY_DB_ACCESS : %s enfreint encore une règle', async (path) => {
    const code = readFileSync(unescape(path), 'utf8')
    const messages = await messagesFor(code, asNewFile(path))
    expect(messages.join('\n')).toMatch(/accès à la base|Pas de SQL/)
  })

  it.each(LEGACY_GET_POOL)('LEGACY_GET_POOL : %s utilise encore getPool()', (path) => {
    expect(readFileSync(unescape(path), 'utf8')).toContain('getPool')
  })

  it.each(LEGACY_SQL_INTERPOLATION)(
    'LEGACY_SQL_INTERPOLATION : %s interpole encore du SQL',
    async (path) => {
      const code = readFileSync(unescape(path), 'utf8')
      const messages = await messagesFor(code, asNewFile(path))
      expect(messages.join('\n')).toMatch(/interpolation/)
    }
  )
})

async function errorRulesFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(process.cwd(), filePath) })
  return result.messages.filter((m) => m.severity === 2).map((m) => m.ruleId ?? '')
}

describe('règles SonarJS', () => {
  it('refusent une regex au temps super-linéaire (ReDoS)', async () => {
    const rules = await errorRulesFor(String.raw`export const EMAIL = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/`, 'src/lib/new.ts')
    expect(rules).toContain('sonarjs/super-linear-regex')
  })

  it('refusent un mot de passe en dur, sauf dans les données de test et de démonstration', async () => {
    // SonarJS écarte les valeurs d'exemple (« secret », « changeme »…) : une
    // valeur de la forme des comptes de démonstration.
    const code = `export const account = { email: 'hr@expense.io', password: 'manager1234' }`
    expect(await errorRulesFor(code, 'src/lib/new.ts')).toContain('sonarjs/no-hardcoded-passwords')
    for (const path of ['e2e/new.spec.ts', 'scripts/seed.mjs', 'src/lib/new.test.ts']) {
      expect(await errorRulesFor(code, path)).not.toContain('sonarjs/no-hardcoded-passwords')
    }
  })

  it('ne jugent pas les types générés par openapi-typescript', async () => {
    const code = `export interface paths { '/x': { get: never } }`
    expect(await errorRulesFor(code, 'src/types/new.d.ts')).toContain('sonarjs/class-name')
    expect(await errorRulesFor(code, 'src/types/api.d.ts')).not.toContain('sonarjs/class-name')
  })

  it('coupent les règles AWS CDK, sans changer la version de React vue par Next.js', async () => {
    const config = await eslint.calculateConfigForFile(join(process.cwd(), 'src/app/page.tsx'))
    expect(config.rules['sonarjs/aws-s3-bucket-versioning']?.[0]).toBe(0)
    expect(config.rules['sonarjs/super-linear-regex']?.[0]).toBe(2)
    expect(config.settings.react?.version).not.toBe('999.999.999')
  })
})

// Les constats SonarJS du code existant, figés par `eslint --suppress-all`.
// ESLint échoue déjà sur un constat de plus ou sur une suppression qui ne sert
// plus, mais pas sur l'entrée d'un fichier supprimé ou renommé. Les règles
// d'architecture, elles, ont leurs listes LEGACY_*, relues en revue.
describe('eslint-suppressions.json', () => {
  const suppressions: Record<string, Record<string, { count: number }>> = JSON.parse(
    readFileSync('eslint-suppressions.json', 'utf8')
  )

  it('ne fige que des constats SonarJS', () => {
    const rules = Object.values(suppressions).flatMap((byRule) => Object.keys(byRule))
    expect(rules.filter((rule) => !rule.startsWith('sonarjs/'))).toEqual([])
  })

  it('ne vise que des fichiers qui existent', () => {
    expect(Object.keys(suppressions).filter((path) => !existsSync(path))).toEqual([])
  })
})

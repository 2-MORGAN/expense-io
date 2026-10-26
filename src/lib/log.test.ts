import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeError, log, logError } from '@/lib/log'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Lignes écrites sur la sortie d'erreur, relues en JSON. */
function errorLines(): () => Record<string, unknown>[] {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  return () => spy.mock.calls.map(([line]) => JSON.parse(String(line)))
}

describe('log', () => {
  it('écrit une ligne JSON horodatée en UTC : heure, niveau, message, puis les champs', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T10:00:00.000Z'))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    log('info', 'worker.started', { types: ['email.send'] })
    expect(info).toHaveBeenCalledWith(
      '{"time":"2026-10-25T10:00:00.000Z","level":"info","msg":"worker.started","types":["email.send"]}'
    )
  })
})

describe('describeError', () => {
  it('masque les adresses email, accentuées comprises (ADR-005 §5)', () => {
    expect(describeError(new Error('Key (email)=(jean-françois.dupont@exemple.fr) already exists.')))
      .toBe('Key (email)=([email]) already exists.')
  })

  it('masque les paramètres d’une URL, où figure la signature d’une URL pré-signée', () => {
    expect(describeError('GET http://localhost:4567/receipts/a.png?X-Amz-Credential=k&X-Amz-Signature=s failed'))
      .toBe('GET http://localhost:4567/receipts/a.png?[redacted] failed')
  })

  it('reste rapide sur un message énorme, qu’une saisie recopiée par PostgreSQL peut produire', () => {
    const started = performance.now()
    describeError(new Error(`invalid input syntax for type date: "${'a'.repeat(1_000_000)}"`))
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('masque une adresse coupée par la troncature', () => {
    expect(describeError(`${'x'.repeat(995)} jane.doe@acme.test`)).not.toContain('jane')
  })

  it('masque les identifiants d’une URL de connexion', () => {
    expect(describeError('connect to postgres://expense:s3cret@localhost:5433/expense_io failed'))
      .toBe('connect to postgres://[redacted]@localhost:5433/expense_io failed')
  })

  it('décrit une valeur impossible à convertir en texte', () => {
    expect(describeError(Object.create(null))).toBe('Unprintable error')
  })

  it('rend le nom d’une erreur sans message', () => {
    const aborted = new Error()
    aborted.name = 'ResponseAborted'
    expect(describeError(aborted)).toBe('ResponseAborted')
  })

  it('laisse intacts les chemins de paquets et les imports', () => {
    const text = "at /app/node_modules/@smithy/core/dist-cjs/index.js:12:3 (Cannot find module '@/lib/x')"
    expect(describeError(text)).toBe(text)
  })
})

describe('logError', () => {
  it('journalise le contexte, le message et la pile, sans donnée interdite', () => {
    const lines = errorLines()
    logError('http.error', new Error('duplicate key for jane.doe@acme.test'), { requestId: 'r1', status: 500 })

    const [line] = lines()
    expect(line).toMatchObject({
      level: 'error',
      msg: 'http.error',
      requestId: 'r1',
      status: 500,
      error: 'duplicate key for [email]',
    })
    expect(line.stack).toMatch(/^Error: duplicate key for \[email\]\n\s+at .*log\.test\.ts/)
    expect(JSON.stringify(line)).not.toContain('jane.doe')
  })

  it('borne la pile', () => {
    const lines = errorLines()
    const error = new Error('boom')
    error.stack = `Error: boom\n${'    at frame (file.ts:1:1)\n'.repeat(500)}`
    logError('http.error', error)
    expect(lines()[0].stack).toHaveLength(4000)
  })

  it('accepte une valeur qui n’est pas une Error, sans pile', () => {
    const lines = errorLines()
    logError('worker.crashed', 'boom')
    expect(lines()[0]).toMatchObject({ msg: 'worker.crashed', error: 'boom' })
    expect(lines()[0]).not.toHaveProperty('stack')
  })
})

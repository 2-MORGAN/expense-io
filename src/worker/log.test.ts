import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeError, log } from '@/worker/log'

describe('describeError', () => {
  it('masque les adresses email (ADR-005 §5)', () => {
    expect(describeError(new Error('550 5.1.1 <jane.doe@acme.test>: Recipient rejected')))
      .toBe('550 5.1.1 <[email]>: Recipient rejected')
  })
  it('tronque à 1 000 caractères', () => {
    expect(describeError(new Error('x'.repeat(2000)))).toHaveLength(1000)
  })
  it('accepte une valeur qui n’est pas une Error', () => {
    expect(describeError('boom')).toBe('boom')
  })
})

describe('log', () => {
  afterEach(() => vi.restoreAllMocks())

  it('écrit une ligne JSON horodatée en UTC, avant le niveau', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-23T10:10:00.000Z'))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    log('info', 'outbox.sent', { eventId: 'e1', attempts: 1 })
    vi.useRealTimers()
    expect(info).toHaveBeenCalledWith(
      '{"time":"2026-10-23T10:10:00.000Z","level":"info","msg":"outbox.sent","eventId":"e1","attempts":1}'
    )
  })
})

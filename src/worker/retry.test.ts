import { describe, expect, it } from 'vitest'
import { nextAttemptAfterFailure } from '@/worker/retry'

describe('nextAttemptAfterFailure', () => {
  it.each([[1, 60], [2, 300], [3, 1800], [4, 7200], [5, 43200]])(
    'échec n°%i, 5 relances → nouvel essai dans %i s', (attempts, delaySeconds) => {
      expect(nextAttemptAfterFailure(attempts, 5)).toEqual({ status: 'pending', delaySeconds })
    })
  it('6e échec avec 5 relances → dead', () => {
    expect(nextAttemptAfterFailure(6, 5)).toEqual({ status: 'dead' })
  })
  it('3 relances (OCR) → dead au 4e échec', () => {
    expect(nextAttemptAfterFailure(3, 3)).toEqual({ status: 'pending', delaySeconds: 1800 })
    expect(nextAttemptAfterFailure(4, 3)).toEqual({ status: 'dead' })
  })
})

import { describe, expect, it } from 'vitest'
import { describeError } from '@/worker/log'

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

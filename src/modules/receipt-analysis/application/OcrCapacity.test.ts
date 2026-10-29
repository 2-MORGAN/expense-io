import { afterEach, describe, expect, it, vi } from 'vitest'
import { OcrCapacity } from './OcrCapacity'

afterEach(() => vi.useRealTimers())

describe('OCR admission and execution', () => {
  it('refuses the eleventh upload before it is buffered', () => {
    const capacity = new OcrCapacity()
    const reservations = Array.from({ length: 10 }, () => capacity.reserve())
    expect(() => capacity.reserve()).toThrow('OCR_OVERLOADED')
    reservations[0].release()
    capacity.reserve().release()
    reservations.forEach((reservation) => reservation.release())
  })

  it('runs two engines and starts the next only after a slot is released', async () => {
    const capacity = new OcrCapacity(2, 1)
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const started = vi.fn(async () => {})
    const jobs = [capacity.reserve().run(() => first.promise), capacity.reserve().run(() => second.promise), capacity.reserve().run(started)]
    await Promise.resolve()
    expect(started).not.toHaveBeenCalled()
    first.resolve()
    await jobs[0]
    await jobs[2]
    expect(started).toHaveBeenCalledOnce()
    second.resolve()
    await jobs[1]
  })

  it('removes an expired waiter without starting its engine', async () => {
    vi.useFakeTimers()
    const capacity = new OcrCapacity(1, 1)
    const pending = Promise.withResolvers<void>()
    const active = capacity.reserve(undefined, 1000).run(() => pending.promise)
    const task = vi.fn(async () => {})
    const queued = capacity.reserve(undefined, 10).run(task)
    const rejected = expect(queued).rejects.toThrow('OCR_TIMEOUT')
    await vi.advanceTimersByTimeAsync(10)
    await rejected
    pending.resolve()
    await active
    expect(task).not.toHaveBeenCalled()
    await capacity.reserve().run(async () => {})
  })

  it('keeps an aborted active slot until its engine has actually stopped', async () => {
    const capacity = new OcrCapacity(1, 1)
    const controller = new AbortController()
    const stopped = Promise.withResolvers<void>()
    const task = vi.fn(async () => {})
    const active = capacity.reserve(controller.signal).run(() => stopped.promise)
    const next = capacity.reserve().run(task)
    await Promise.resolve()
    const aborted = expect(active).rejects.toThrow()
    controller.abort()
    await Promise.resolve()
    expect(task).not.toHaveBeenCalled()
    stopped.resolve()
    await aborted
    await next
    expect(task).toHaveBeenCalledOnce()
  })
})

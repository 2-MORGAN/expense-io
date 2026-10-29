import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Avant chaque fichier du projet `components` (vitest.config.mts), en jsdom :
// démonte ce que le test a rendu et rend `fetch` et les espions d'origine.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

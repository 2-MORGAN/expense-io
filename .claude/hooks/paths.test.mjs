import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pathInRepository, realPath } from './paths.mjs'

// Un dépôt ouvert par un chemin qui passe par un lien symbolique (sous macOS,
// `tmpdir()` donne /var/…, git /private/var/…) : les garde-fous doivent y
// voir les mêmes fichiers que par le chemin réel.

describe('chemins : lien symbolique', () => {
  let dir
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const layout = () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'paths-')))
    mkdirSync(join(dir, 'real', 'src'), { recursive: true })
    writeFileSync(join(dir, 'real', 'src', 'a.ts'), '')
    symlinkSync(join(dir, 'real'), join(dir, 'link'), 'dir')
    return { real: join(dir, 'real'), link: join(dir, 'link') }
  }

  it('chemin réel, que le fichier existe ou non', () => {
    const { real, link } = layout()
    expect(realPath(join(link, 'src', 'a.ts'))).toBe(join(real, 'src', 'a.ts'))
    expect(realPath(join(link, 'src', 'neuf', 'b.ts'))).toBe(join(real, 'src', 'neuf', 'b.ts'))
  })

  it('chemin depuis la racine, par le lien ou par le chemin réel', () => {
    const { real, link } = layout()
    expect(pathInRepository(real, join(link, 'src', 'a.ts'))).toBe('src/a.ts')
    expect(pathInRepository(link, join(real, 'src', 'neuf.ts'))).toBe('src/neuf.ts')
    expect(pathInRepository(real, join(dir, 'ailleurs.ts'))).toBeUndefined()
  })
})

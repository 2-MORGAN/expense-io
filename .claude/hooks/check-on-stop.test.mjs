import { describe, expect, it } from 'vitest'
import { projectRoot } from './check-on-stop.mjs'

describe('check-on-stop : dossier du check', () => {
  // VS Code fournit le dossier du projet en `c:\…` ; Vitest, lancé depuis un
  // tel dossier, fait échouer tous les tests dès describe().
  it('met la lettre de lecteur en majuscule', () => {
    expect(projectRoot({ CLAUDE_PROJECT_DIR: 'c:\\Users\\dev\\expense-io' }, {}, 'E:\\ailleurs')).toBe('C:\\Users\\dev\\expense-io')
    expect(projectRoot({}, { cwd: 'd:/dev/expense-io' }, 'E:\\ailleurs')).toBe('D:/dev/expense-io')
  })

  it('laisse les autres chemins tels quels', () => {
    expect(projectRoot({ CLAUDE_PROJECT_DIR: 'C:\\Users\\dev\\expense-io' }, {}, '/tmp')).toBe('C:\\Users\\dev\\expense-io')
    expect(projectRoot({}, {}, '/home/dev/expense-io')).toBe('/home/dev/expense-io')
  })

  it('prend le dossier du projet, sinon celui du tour, sinon le dossier courant', () => {
    expect(projectRoot({ CLAUDE_PROJECT_DIR: '/projet' }, { cwd: '/tour' }, '/courant')).toBe('/projet')
    expect(projectRoot({}, { cwd: '/tour' }, '/courant')).toBe('/tour')
    expect(projectRoot({}, {}, '/courant')).toBe('/courant')
  })
})

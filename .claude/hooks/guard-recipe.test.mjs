import { describe, expect, it } from 'vitest'
import { decide, isRecipe, needsRecipe, recipeStarted } from './guard-recipe.mjs'

// La recette d'une fonctionnalité ne s'oublie pas (AGENTS.md, « Façon de
// travailler ») : le hook note qu'elle a été lancée, et sinon pose la question
// à l'humain avant la première écriture de code de la session.

describe('recette : lancement reconnu', () => {
  it('la skill, nommée seule ou préfixée par son dossier', () => {
    expect(isRecipe('nouvelle-fonctionnalite')).toBe(true)
    expect(isRecipe('/nouvelle-fonctionnalite')).toBe(true)
    expect(isRecipe('.claude/worktrees/x:nouvelle-fonctionnalite')).toBe(true)
    expect(isRecipe('code-review')).toBe(false)
    expect(isRecipe('autre-nouvelle-fonctionnalite')).toBe(false)
    expect(isRecipe(undefined)).toBe(false)
  })

  it('tapée par l’humain ou appelée par Claude', () => {
    expect(recipeStarted({ hook_event_name: 'UserPromptExpansion', command_name: 'nouvelle-fonctionnalite' })).toBe(true)
    expect(
      recipeStarted({ hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'nouvelle-fonctionnalite' } })
    ).toBe(true)
    expect(recipeStarted({ hook_event_name: 'UserPromptExpansion', command_name: 'code-review' })).toBe(false)
    expect(recipeStarted({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { skill: 'nouvelle-fonctionnalite' } })).toBe(false)
  })
})

describe('recette : fichiers concernés', () => {
  it('le code, le schéma, les E2E et le contrat ; pas la doc ni les outils', () => {
    expect(needsRecipe('src/domain/expense/ReceiptAccess.ts')).toBe(true)
    expect(needsRecipe('migrations/1793500000000_x.sql')).toBe(true)
    expect(needsRecipe('e2e/manager-approval.spec.ts')).toBe(true)
    expect(needsRecipe('openapi.yaml')).toBe(true)
    expect(needsRecipe('docs/index.html')).toBe(false)
    expect(needsRecipe('AGENTS.md')).toBe(false)
    expect(needsRecipe('scripts/seed.mjs')).toBe(false)
    expect(needsRecipe('../ailleurs/src/x.ts')).toBe(false)
  })
})

describe('recette : décision', () => {
  it('demande une fois par session, puis laisse passer', () => {
    const first = decide({}, 's1', 'src/x.ts')
    expect(first.ask).toBe(true)
    expect(decide(first.state, 's1', 'src/y.ts').ask).toBe(false)
    expect(decide(first.state, 's2', 'src/y.ts').ask).toBe(true)
  })

  it('ne demande rien si la recette est lancée, ni pour un fichier hors du code', () => {
    expect(decide({ s1: 'recipe' }, 's1', 'src/x.ts').ask).toBe(false)
    expect(decide({}, 's1', 'docs/index.html')).toEqual({ ask: false, state: {} })
    expect(decide({}, undefined, 'src/x.ts').ask).toBe(false)
  })
})

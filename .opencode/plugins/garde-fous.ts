// Plugin OpenCode (AGENTS.md, « Harnais de validation ») : les garde-fous de
// Claude Code, mêmes règles, sans copie. Avant chaque appel d'outil : commande
// shell → guard-git.mjs ; écriture (`edit`, `write`, `apply_patch`) →
// agent-adapter.mjs (migrations et tests E2E de main figés, recette d'une
// fonctionnalité). Lever une erreur refuse l'appel ; l'agent lit la raison.
// Pas de `npm run check` en fin de tour : OpenCode n'a pas de hook bloquant à
// cet endroit, le pre-push husky et la CI le font.
//
// OpenCode traite chaque export de ce fichier comme un plugin : n'en ajouter
// aucun autre.
import { guard } from '../../.claude/hooks/agent-adapter.mjs'
import { currentBranchIn, refusal } from '../../.claude/hooks/guard-git.mjs'

type ToolCall = { tool: string; sessionID?: string }
type ToolArgs = { args: Record<string, unknown> }

export const GardeFous = async ({ directory }: { directory: string }) => ({
  'tool.execute.before': async (input: ToolCall, output: ToolArgs) => {
    const { command } = output.args
    let reason
    if (input.tool !== 'bash') reason = guard({ tool: input.tool, args: output.args, cwd: directory, sessionId: input.sessionID })
    else if (typeof command === 'string') reason = refusal(command, currentBranchIn(directory))
    if (reason) throw new Error(`${reason} (.opencode/plugins/garde-fous.ts)`)
  },
})

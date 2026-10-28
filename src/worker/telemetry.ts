import { config } from 'dotenv'
import { startTelemetry } from '@/lib/telemetry/sdk'

// Premier import de main.ts (ADR-007) : l'instrumentation de pg doit être en
// place avant que pg ne soit chargé, donc avant le reste du worker. Seules les
// variables OTEL_* de `.env` sont lues dès maintenant : les autres le sont par
// main(), comme avant, et aucun module du worker ne voit de différence. Sans
// collecteur configuré, rien ne démarre.
const fromFile: Record<string, string> = {}
config({ quiet: true, processEnv: fromFile })
for (const [name, value] of Object.entries(fromFile)) {
  if (name.startsWith('OTEL_') && process.env[name] === undefined) process.env[name] = value
}

export const telemetry = startTelemetry('expense-io-worker')

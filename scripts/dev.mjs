import { spawn } from 'node:child_process'

// Même cycle de vie en développement et en E2E : le bouton utilise le vrai worker.
const children = [
  spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev'], { stdio: 'inherit' }),
  spawn(process.execPath, ['--import', 'tsx', 'src/worker/main.ts'], { stdio: 'inherit' }),
]
// Délai avant SIGKILL à l'arrêt. `npm run test:e2e:coverage` l'allonge : chaque
// processus écrit sa couverture en sortant, ce qui prend plusieurs secondes.
// Une valeur absente ou invalide garde 5 s : `Number('abc')` donnerait NaN,
// et un délai NaN déclencherait le SIGKILL tout de suite.
const requestedExitTimeoutMs = Number(process.env.DEV_EXIT_TIMEOUT_MS)
const exitTimeoutMs = Number.isFinite(requestedExitTimeoutMs) && requestedExitTimeoutMs > 0 ? requestedExitTimeoutMs : 5000
let closing = false
function close(code = 0) {
  if (closing) return
  closing = true
  for (const child of children) child.kill('SIGTERM')
  const timer = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL')
    process.exit(code)
  }, exitTimeoutMs)
  Promise.all(children.map((child) => child.exitCode !== null ? Promise.resolve() : new Promise((resolve) => child.once('exit', resolve))))
    .then(() => { clearTimeout(timer); process.exit(code) })
}
process.once('SIGINT', () => close())
process.once('SIGTERM', () => close())
for (const child of children) {
  child.once('error', () => close(1))
  child.once('exit', (code) => { if (!closing) close(code ?? 1) })
}

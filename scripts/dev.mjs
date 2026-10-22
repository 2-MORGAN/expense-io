import { spawn } from 'node:child_process'

// Même cycle de vie en développement et en E2E : le bouton utilise le vrai worker.
const children = [
  spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev'], { stdio: 'inherit' }),
  spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'src/worker.ts'], { stdio: 'inherit' }),
]
let closing = false
function close(code = 0) {
  if (closing) return
  closing = true
  for (const child of children) child.kill('SIGTERM')
  const timer = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL')
    process.exit(code)
  }, 5000)
  Promise.all(children.map((child) => child.exitCode !== null ? Promise.resolve() : new Promise((resolve) => child.once('exit', resolve))))
    .then(() => { clearTimeout(timer); process.exit(code) })
}
process.once('SIGINT', () => close())
process.once('SIGTERM', () => close())
for (const child of children) {
  child.once('error', () => close(1))
  child.once('exit', (code) => { if (!closing) close(code ?? 1) })
}

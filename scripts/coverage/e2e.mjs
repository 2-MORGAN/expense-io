// `npm run test:e2e:coverage` : toute la suite Playwright sous
// NODE_V8_COVERAGE, puis le rapport c8 du serveur Next.js, du worker et des
// scripts (coverage-e2e-report/). En Node plutôt qu'en shell, pour tourner
// pareil sous macOS, Linux et Windows : chaque outil est lancé par le Node
// courant, sans shell ni `rm -rf`. Arguments passés à Playwright :
// `npm run test:e2e:coverage -- -g "NDF-"`.
//
// Code de sortie : celui de Playwright si la suite échoue, sinon celui du
// rapport (un rapport absent ne passe pas inaperçu).
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = process.cwd()
const RAW = path.join(root, 'coverage-e2e')
const REPORT = path.join(root, 'coverage-e2e-report')

function run(label, args, env = process.env) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env })
  if (result.error) {
    console.error(`coverage: ${label} n'a pas pu démarrer (${result.error.message})`)
    return 1
  }
  return result.status ?? 1
}

rmSync(RAW, { recursive: true, force: true })

const tests = run('playwright', [require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)], {
  ...process.env,
  NODE_V8_COVERAGE: RAW,
  // Chaque processus écrit sa couverture en sortant : on lui en laisse le temps
  // (`next dev` n'accorde que 100 ms par défaut, scripts/dev.mjs 5 s).
  NEXT_EXIT_TIMEOUT_MS: '60000',
  DEV_EXIT_TIMEOUT_MS: '75000',
})

const flatten = run('flatten', ['--import', 'tsx', path.join('scripts', 'coverage', 'flatten.ts'), RAW])
const report = flatten === 0
  ? run('c8 report', [
      require.resolve('c8/bin/c8.js'),
      'report',
      '--exclude-after-remap',
      `--temp-directory=${RAW}`,
      '--include=src/**',
      '--include=scripts/*.mjs',
      '--exclude=**/*.test.ts',
      '--reporter=text-summary',
      '--reporter=html',
      '--reporter=json-summary',
      `--reports-dir=${REPORT}`,
    ])
  : flatten

if (report !== 0) console.error('coverage: rapport E2E non produit, voir les erreurs ci-dessus')
process.exit(tests !== 0 ? tests : report)

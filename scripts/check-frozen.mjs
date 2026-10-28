// Migrations et tests E2E existants inchangés (ADR-005 §2, règle commune :
// scripts/frozen.mjs). Compare la copie de travail à <base> : en CI, la branche
// visée par la PR ; en local, `make frozen`, depuis le commit de main dont
// part la branche. Échoue si une migration de <base> est modifiée ou
// supprimée, ou si un test E2E de <base> est modifié, désactivé ou supprimé.
// `--e2e-change-approved` (label `changement-e2e` de la PR, posé quand une ADR
// acceptée décide le changement) ne vérifie plus que les migrations.
import { existsSync, readFileSync } from 'node:fs'
import { brokenTests, E2E_RULE, fileAt, git, isMigration, isSpec, MIGRATION_RULE } from './frozen.mjs'

const [base, ...flags] = process.argv.slice(2)
if (!base) {
  console.error('Usage : node scripts/check-frozen.mjs <base> [--e2e-change-approved]')
  process.exit(2)
}
const e2eApproved = flags.includes('--e2e-change-approved')

const problems = []
const changed = git(['diff', '--name-status', '--no-renames', base, '--', 'migrations', 'e2e']).split('\n').filter(Boolean)
for (const line of changed) {
  const [status, path] = line.split('\t')
  if (status === 'A') continue
  if (isMigration(path)) {
    problems.push(`${path} : migration de ${base} ${status === 'D' ? 'supprimée' : 'modifiée'} ; ${MIGRATION_RULE}.`)
  } else if (isSpec(path) && !e2eApproved) {
    const after = existsSync(path) ? readFileSync(path, 'utf8') : ''
    const broken = brokenTests(fileAt(base, path) ?? '', after)
    if (broken.length) problems.push(`${path} : ${broken.join(', ')} modifié, désactivé ou retiré. ${E2E_RULE}.`)
  }
}

for (const problem of problems) console.error(`!! ${problem}`)
if (problems.length) {
  console.error(`Comparaison avec ${base}. Changement de test voulu : ADR acceptée, puis label \`changement-e2e\` sur la PR.`)
  process.exit(1)
}
console.log(`Migrations et tests E2E de ${base} inchangés${e2eApproved ? ' (tests E2E non vérifiés : label changement-e2e)' : ''}.`)

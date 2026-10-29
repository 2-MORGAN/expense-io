// Mesure d'usage (ADR-008, docs/analytics.md) : joue dans l'application des
// parcours de démonstration qui remplissent les rapports d'Umami (entonnoirs,
// objectifs, propriété `ocr`, appareils, heatmap, replays). Chaque personne a son
// navigateur, car Umami reconnaît un visiteur à son navigateur et à son IP :
//  - entreprise A (PC Windows) : inscription, email confirmé, note commencée puis
//    abandonnée, invitation d'un salarié ;
//  - entreprise B (Mac) : inscription, email confirmé, page RH, sans inviter ;
//  - salarié de A (téléphone Android) : invitation acceptée, une note avec la
//    suggestion OCR gardée, une avec la suggestion corrigée.
// Sans option : vérifie les prérequis et décrit les parcours. `--execute` : les
// joue. Application locale seulement (APP_URL), lancée par `make dev` avec Umami
// configuré ; Chromium de Playwright (`npx playwright install chromium`).
// Comptes jetables `*.demo.test`, mots de passe aléatoires jamais affichés ;
// `make clean` les efface avec le reste des données locales.
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from '@playwright/test'
import { config as loadEnv } from 'dotenv'

loadEnv({ quiet: true })

const appUrl = new URL(process.env.APP_URL ?? 'http://localhost:3000')
const mailpitUrl = process.env.MAILPIT_URL ?? 'http://localhost:8025'
const receipt = fileURLToPath(new URL('../e2e/fixtures/recu-ocr-complet.png', import.meta.url))
const execute = process.argv.includes('--execute')
const run = Date.now().toString(36)

// Un navigateur par personne : Umami compterait sinon un seul visiteur.
const BROWSERS = {
  windows: devices['Desktop Chrome'],
  mac: {
    ...devices['Desktop Chrome'],
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  },
  android: devices['Pixel 7'],
}

const SCENARIO = [
  'Entreprise A (PC Windows) : inscription, email confirmé, note commencée puis abandonnée, invitation d’un salarié',
  'Entreprise B (Mac) : inscription, email confirmé, page RH, sans inviter',
  'Salarié de A (téléphone Android) : invitation acceptée, note avec la suggestion OCR gardée, note avec la suggestion corrigée',
]

const password = () => randomBytes(12).toString('base64url')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Attend qu'un champ ait la valeur attendue (suggestion OCR, formulaire vidé). */
async function waitValue(locator, value, timeout = 30_000) {
  const end = Date.now() + timeout
  while ((await locator.inputValue()) !== value) {
    if (Date.now() > end) throw new Error(`le champ n'a pas pris la valeur « ${value} »`)
    await sleep(250)
  }
}

/** Chemin du lien `path` de l'email reçu par `to`, lu dans Mailpit. */
async function emailLink(to, path) {
  const end = Date.now() + 60_000
  const query = encodeURIComponent(`to:${to}`)
  while (Date.now() < end) {
    const search = await (await fetch(`${mailpitUrl}/api/v1/search?query=${query}`)).json()
    for (const { ID } of search.messages ?? []) {
      const { Text } = await (await fetch(`${mailpitUrl}/api/v1/message/${ID}`)).json()
      const link = Text.split(/\s+/).find((word) => /^https?:\/\//.test(word) && word.includes(path))
      if (link) return new URL(link).pathname + new URL(link).search
    }
    await sleep(500)
  }
  throw new Error(`aucun email avec un lien ${path} pour ${to} : le worker tourne-t-il (make dev) ?`)
}

/** Laisse partir les envois d'Umami : la heatmap envoie ses lots au plus tard 5 s après le dernier geste. */
async function flush(page) {
  await page.waitForLoadState('networkidle')
  await sleep(6_000)
}

async function newPage(browser, device) {
  const context = await browser.newContext({ ...BROWSERS[device], baseURL: appUrl.origin })
  return context.newPage()
}

async function signUpCompany(browser, device, name, email) {
  const page = await newPage(browser, device)
  const secret = password()
  await page.goto('/signup')
  await page.getByLabel('Nom').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mot de passe').fill(secret)
  await page.getByRole('button', { name: "S'inscrire" }).click()
  await page.waitForURL(/\/signup\/verify$/, { timeout: 30_000 })
  await flush(page)
  await page.goto(await emailLink(email, '/verify-email'))
  await page.waitForURL(/\/login\?verified=1$/)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mot de passe').fill(secret)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.waitForURL(/\/expenses$/, { timeout: 30_000 })
  return page
}

async function openHrPage(page) {
  await page.getByRole('banner').getByRole('link', { name: 'RH' }).click()
  await page.waitForURL(/\/hr$/)
}

async function submitNote(page, correctedAmount) {
  await page.getByLabel('Reçu (image ou PDF)').setInputFiles(receipt)
  await page.getByRole('button', { name: 'Pré-remplir depuis le reçu' }).click()
  await waitValue(page.getByLabel('Montant (€)'), '42.5', 60_000)
  if (correctedAmount) await page.getByLabel('Montant (€)').fill(correctedAmount)
  await page.getByRole('button', { name: 'Soumettre' }).click()
  await waitValue(page.getByLabel('Montant (€)'), '')
  await flush(page)
}

/** Application locale, Mailpit joignable, script d'Umami chargé par les pages. */
async function checkPrerequisites(browser) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(appUrl.hostname)) {
    throw new Error(`APP_URL (${appUrl.origin}) n'est pas locale : ce script ne joue que sur un poste de dev`)
  }
  const mailpit = await fetch(`${mailpitUrl}/api/v1/messages?limit=1`).catch(() => null)
  if (!mailpit?.ok) throw new Error(`Mailpit injoignable sur ${mailpitUrl} : lancer make dev`)
  const page = await newPage(browser, 'windows')
  const app = await page.goto('/login').catch(() => null)
  if (!app?.ok()) throw new Error(`application injoignable sur ${appUrl.origin} : lancer make dev`)
  await page
    .waitForFunction(() => 'umami' in window, null, { timeout: 15_000 })
    .catch(() => {
      throw new Error("Umami n'est pas chargé : UMAMI_SCRIPT_URL et UMAMI_WEBSITE_ID dans .env, puis relancer make dev")
    })
  await page.context().close()
}

const browser = await chromium.launch()
try {
  await checkPrerequisites(browser)
  console.log(`Application ${appUrl.origin}, Mailpit ${mailpitUrl}, Umami chargé.`)
  if (!execute) {
    console.log('Parcours joués avec --execute (npm run analytics:demo -- --execute) :')
    for (const line of SCENARIO) console.log(`- ${line}`)
  } else {
    const employeeEmail = `salarie-${run}@entreprise-a.demo.test`
    const hrA = await signUpCompany(browser, 'windows', 'Hélène RH', `rh-${run}@entreprise-a.demo.test`)
    await hrA.getByLabel('Montant (€)').fill('18')
    await hrA.getByLabel('Description').fill('Parking')
    await flush(hrA)
    await openHrPage(hrA)
    await hrA.getByLabel('Email du salarié').fill(employeeEmail)
    await hrA.getByRole('button', { name: "Envoyer l'invitation" }).click()
    await hrA.getByRole('status').filter({ hasText: `Invitation envoyée à ${employeeEmail}.` }).waitFor()
    await flush(hrA)
    await hrA.context().close()
    console.log(`✓ ${SCENARIO[0]}`)

    const hrB = await signUpCompany(browser, 'mac', 'Bruno RH', `rh-${run}@entreprise-b.demo.test`)
    await openHrPage(hrB)
    await flush(hrB)
    await hrB.context().close()
    console.log(`✓ ${SCENARIO[1]}`)

    const employee = await newPage(browser, 'android')
    await employee.goto(await emailLink(employeeEmail, '/signup?invitation='))
    await waitValue(employee.getByLabel('Email'), employeeEmail)
    await employee.getByLabel('Nom').fill('Samir Salarié')
    await employee.getByLabel('Mot de passe').fill(password())
    await employee.getByRole('button', { name: "S'inscrire" }).click()
    await employee.waitForURL(/\/expenses$/, { timeout: 30_000 })
    await submitNote(employee, null)
    await submitNote(employee, '45')
    await employee.context().close()
    console.log(`✓ ${SCENARIO[2]}`)
    console.log('Rapports à lire dans Umami : docs/analytics.md, « Lire les réponses ».')
  }
} catch (error) {
  console.error(`Démonstration interrompue : ${error.message}`)
  console.error('Voir docs/analytics.md, « Dépannage ».')
  process.exitCode = 1
} finally {
  await browser.close()
}

const AMOUNT_KEYWORD_PATTERN = /total|montant|ttc|à payer|net à/i
const CURRENCY_HINT_PATTERN = /€|eur\b/i
const DECIMAL_AMOUNT_PATTERN = /\b\d{1,3}(?:[ .]\d{3})*[.,]\d{2}/g
const INTEGER_AMOUNT_PATTERN = /\b\d{1,5}\b/g

const DATE_PATTERNS = [
  /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/,
  /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/,
  /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})\b/,
]

const FRENCH_MONTHS: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
}
const FRENCH_TEXTUAL_DATE_PATTERN = new RegExp(
  `\\b(\\d{1,2})\\s+(${Object.keys(FRENCH_MONTHS).join('|')})\\s+(\\d{4})\\b`,
  'i'
)

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export interface ExpenseNoteSuggestion {
  amount?: number
  expenseDate?: string
  description?: string
}

// Le nom du commerçant figure en tête de ticket : au-delà, ce sont des articles.
const MERCHANT_SEARCH_LINES = 6
const MAX_DESCRIPTION_LENGTH = 60
// Mentions de document ou de contexte : le nom s'arrête avant elles, et une
// ligne qui commence par l'une d'elles n'est pas un nom (« FACTURE », « Date : »).
// Mots entiers, bornés par des lettres Unicode : `\b` ne connaît que l'ASCII et
// verrait « tel » dans « Hôtel ».
const DOCUMENT_WORD_PATTERN =
  /(?<!\p{L})(?:facture|ticket|re[cç]u|note|date|table|caisse|commande|exemple|fictif|n[°o]\s*:)(?!\p{L})/iu
// Lignes qui ne sont jamais un nom : identifiants légaux, contacts, montants.
const NON_MERCHANT_PATTERN =
  /(?<!\p{L})(?:siret|siren|tva|t[ée]l|total|montant|ttc|net à|à payer)(?!\p{L})|www\.|@/iu
const LOWERCASE_PARTICLES = new Set(['le', 'la', 'les', 'du', 'de', 'des', 'et', 'au', 'aux', 'à'])

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

// « BISTRO CENTRAL » → « Bistro Central », « RESTAURANT LE TEST » → « Restaurant le Test ».
function toTitleCase(name: string): string {
  return name
    .toLowerCase()
    .split(' ')
    .map((word, index) => (index > 0 && LOWERCASE_PARTICLES.has(word) ? word : capitalize(word)))
    .join(' ')
}

/**
 * Suggère une description : le nom du commerçant, lu sur l'une des premières
 * lignes. Une ligne avec des chiffres (adresse, numéro) ou une mention légale
 * est écartée. Heuristique volontairement prudente : rien plutôt qu'un nom
 * douteux, l'utilisateur garde la main sur le champ.
 */
export function parseDescription(text: string): string | undefined {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MERCHANT_SEARCH_LINES)

  for (const line of lines) {
    const documentWord = line.search(DOCUMENT_WORD_PATTERN)
    const candidate = (documentWord === -1 ? line : line.slice(0, documentWord))
      .replace(/[\s\-–:|,.]+$/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (/\d/.test(candidate) || NON_MERCHANT_PATTERN.test(candidate)) continue
    if ((candidate.match(/\p{L}/gu) ?? []).length < 3) continue
    if (candidate.length > MAX_DESCRIPTION_LENGTH) continue
    return candidate === candidate.toUpperCase() ? toTitleCase(candidate) : candidate
  }
  return undefined
}

export function parseAmount(text: string): number | undefined {
  const lines = text.split('\n')
  const keywordLine = lines.find((line) => AMOUNT_KEYWORD_PATTERN.test(line))
  const candidateLines = keywordLine ? [keywordLine] : lines

  const decimalAmounts: number[] = []
  for (const line of candidateLines) {
    for (const match of line.matchAll(DECIMAL_AMOUNT_PATTERN)) {
      const value = Number.parseFloat(match[0].replace(/[ .](?=\d{3})/g, '').replace(',', '.'))
      if (Number.isFinite(value) && value > 0) decimalAmounts.push(value)
    }
  }
  if (decimalAmounts.length > 0) return Math.max(...decimalAmounts)

  const integerAmounts: number[] = []
  for (const line of lines) {
    if (!AMOUNT_KEYWORD_PATTERN.test(line) && !CURRENCY_HINT_PATTERN.test(line)) continue
    for (const match of line.matchAll(INTEGER_AMOUNT_PATTERN)) {
      const value = Number.parseInt(match[0], 10)
      if (Number.isFinite(value) && value > 0) integerAmounts.push(value)
    }
  }
  return integerAmounts.length > 0 ? Math.max(...integerAmounts) : undefined
}

function toIsoDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day))
  const isValid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return isValid ? date.toISOString().slice(0, 10) : undefined
}

export function parseExpenseDate(text: string): string | undefined {
  const ddmmyyyy = text.match(DATE_PATTERNS[0])
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy
    const iso = toIsoDate(Number(year), Number(month), Number(day))
    if (iso) return iso
  }
  const yyyymmdd = text.match(DATE_PATTERNS[1])
  if (yyyymmdd) {
    const [, year, month, day] = yyyymmdd
    const iso = toIsoDate(Number(year), Number(month), Number(day))
    if (iso) return iso
  }
  const ddmmyy = text.match(DATE_PATTERNS[2])
  if (ddmmyy) {
    const [, day, month, year] = ddmmyy
    const iso = toIsoDate(2000 + Number(year), Number(month), Number(day))
    if (iso) return iso
  }
  const textual = stripAccents(text).match(FRENCH_TEXTUAL_DATE_PATTERN)
  if (textual) {
    const [, day, monthName, year] = textual
    const iso = toIsoDate(Number(year), FRENCH_MONTHS[monthName.toLowerCase()], Number(day))
    if (iso) return iso
  }
  return undefined
}

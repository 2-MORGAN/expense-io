import fs from 'node:fs/promises'
import { parse } from 'yaml'

// Le JSON est un artefact dérivé, consommé par Ajv et les tests ; jamais édité à la main.
const source = parse(await fs.readFile('openapi.yaml', 'utf8'))
const receipt = source.components.schemas.Receipt
// The domain consumes a small transport-independent policy, not the HTTP document.
const policy = {
  maxBytes: receipt['x-maxBytes'],
  mediaTypes: receipt['x-mediaTypes'],
  ocrMaxPixels: receipt['x-ocrMaxPixels'],
  ocrMaxSide: receipt['x-ocrMaxSide'],
}
for (const [target, value] of [
  ['src/generated/api-contract.json', source],
  ['src/generated/receipt-policy.json', policy],
]) {
  const output = `${JSON.stringify(value, null, 2)}\n`
  if (process.argv.includes('--check')) {
    if (await fs.readFile(target, 'utf8').catch(() => '') !== output) {
      console.error(`${target} is stale. Run npm run generate:api.`)
      process.exitCode = 1
    }
  } else {
    await fs.mkdir('src/generated', { recursive: true })
    await fs.writeFile(target, output)
  }
}

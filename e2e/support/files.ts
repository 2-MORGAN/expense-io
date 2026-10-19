import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

/** Format accepté à la fois par `setInputFiles` et par le multipart de l'API. */
export interface UploadFile {
  name: string
  mimeType: string
  buffer: Buffer
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

/**
 * PNG valide de 8×8 px, unique par libellé (couleur et chunk tEXt dérivés du
 * libellé) : permet de vérifier qu'une URL de reçu renvoie bien LE fichier
 * envoyé pour cette note, et pas celui d'une autre.
 */
export function pngReceipt(label: string, name = 'recu.png'): UploadFile {
  const size = 8
  const [red, green, blue] = createHash('sha256').update(label).digest()
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // profondeur 8 bits
  header[9] = 2 // RGB
  // Une ligne = octet de filtre (0) + `size` pixels RGB identiques.
  const row = Buffer.alloc(1 + size * 3)
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = red
    row[2 + x * 3] = green
    row[3 + x * 3] = blue
  }
  const pixels = Buffer.concat(Array.from({ length: size }, () => row))
  const buffer = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('tEXt', Buffer.from(`Comment\0${label}`, 'latin1')),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  return { name, mimeType: 'image/png', buffer }
}

/** PDF minimal (une page vide), unique par libellé. */
export function pdfReceipt(label: string, name = 'recu.pdf'): UploadFile {
  const content = [
    '%PDF-1.4',
    `% ${label}`,
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
    '',
  ].join('\n')
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(content, 'latin1') }
}

export function textFile(name = 'recu.txt'): UploadFile {
  return { name, mimeType: 'text/plain', buffer: Buffer.from('ceci n’est pas un reçu', 'utf8') }
}

/** Un octet de plus que la limite de 10 Mio de la création de note. */
export function oversizedPng(): UploadFile {
  return {
    name: 'recu-trop-gros.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  }
}

/** Images de ticket de caisse servant aux tests OCR (`e2e/fixtures/`). */
export function fixtureImage(fileName: string): UploadFile {
  return {
    name: fileName,
    mimeType: 'image/png',
    buffer: readFileSync(path.join(__dirname, '..', 'fixtures', fileName)),
  }
}

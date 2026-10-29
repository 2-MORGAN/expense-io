import { describe, expect, it } from 'vitest'
import { DEFAULT_NOTE_SORT, SORTABLE_COLUMNS, parseNoteSort } from './NoteSort'

// Tri de `GET /api/expense-notes?sort=`, à l'identique de NDF-12 et NDF-13.

describe('parseNoteSort', () => {
  it('trie par date de création décroissante par défaut', () => {
    expect(DEFAULT_NOTE_SORT).toBe('created_at DESC')
    expect(parseNoteSort(null)).toBe('created_at DESC')
    expect(parseNoteSort('')).toBe('created_at DESC')
    expect(parseNoteSort('   ')).toBe('created_at DESC')
  })

  it('accepte chaque colonne autorisée, dans les deux sens', () => {
    for (const column of SORTABLE_COLUMNS) {
      expect(parseNoteSort(`${column} ASC`)).toBe(`${column} ASC`)
      expect(parseNoteSort(`${column} DESC`)).toBe(`${column} DESC`)
    }
  })

  it('prend ASC sans direction et ignore la casse (NDF-13)', () => {
    expect(parseNoteSort('amount')).toBe('amount ASC')
    expect(parseNoteSort('Amount desc')).toBe('amount DESC')
    expect(parseNoteSort('  amount   asc  ')).toBe('amount ASC')
  })

  it('renvoie le tri par défaut pour toute valeur hors liste blanche (NDF-13, faille S1)', () => {
    for (const sort of ['montant ASC', 'amount ASC, description', 'amount SIDEWAYS', 'amount; DROP TABLE users', 'id ASC']) {
      expect(parseNoteSort(sort), sort).toBe('created_at DESC')
    }
  })
})

// Tri de la liste de ses propres notes (`GET /api/expense-notes?sort=`) :
// règle pure, sans base ni HTTP. Seules ces 5 colonnes se trient ; la forme
// acceptée est `<colonne> [ASC|DESC]`, casse ignorée comme pour un
// identifiant SQL non cité, ASC par défaut. Toute autre valeur donne le tri
// par défaut (faille S1 corrigée, NDF-12 et NDF-13). Le résultat est une clé
// fermée : l'adaptateur la traduit par une table de requêtes fixes.

export const SORTABLE_COLUMNS = ['created_at', 'amount', 'expense_date', 'description', 'status'] as const

export type SortableColumn = (typeof SORTABLE_COLUMNS)[number]
export type NoteSort = `${SortableColumn} ${'ASC' | 'DESC'}`

export const DEFAULT_NOTE_SORT: NoteSort = 'created_at DESC'

function isSortable(column: string): column is SortableColumn {
  return (SORTABLE_COLUMNS as readonly string[]).includes(column)
}

export function parseNoteSort(sort: string | null): NoteSort {
  const match = /^(\w+)(?:\s+(asc|desc))?$/i.exec(sort?.trim() ?? '')
  const column = match?.[1].toLowerCase()
  if (!column || !isSortable(column)) {
    return DEFAULT_NOTE_SORT
  }
  const direction = match?.[2]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
  return `${column} ${direction}`
}

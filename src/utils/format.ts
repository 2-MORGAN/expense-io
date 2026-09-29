export function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount)
}

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date)
}

export function truncate(value: string, maxLength = 40): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

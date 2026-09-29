export function respondError(error: unknown): Response {
  console.error(error)
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined
  return Response.json({ error: message, stack }, { status: 500 })
}

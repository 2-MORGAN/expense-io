import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import type { TestUser } from './db'
import { pngReceipt, type UploadFile } from './files'

// Contrat HTTP actuel, tel qu'observé (voir docs/tests/E2E.md).

export type NoteStatus = 'pending' | 'approved' | 'rejected'

export interface ExpenseNoteDto {
  id: string
  userId: string
  amount: number
  expenseDate: string
  description: string
  status: NoteStatus
  createdAt: string
}

export interface CompanyUserDto {
  id: string
  name: string
  email: string
  role: 'employee' | 'manager'
  managerId: string | null
}

export type Decision = 'approve' | 'reject'

export interface NoteInput {
  amount?: string
  expenseDate?: string
  description?: string
  receipt?: UploadFile
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** UUID valide qui ne correspond à aucune ligne. */
export const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

/**
 * Connexion par le fournisseur Credentials d'Auth.js (même `authorize()` que
 * le formulaire /login, sans passer par l'UI). Le cookie de session est
 * conservé par le contexte de requêtes (et donc par le navigateur s'il s'agit
 * de `context.request`).
 */
export async function signInWithCredentials(
  request: APIRequestContext,
  email: string,
  password: string
): Promise<void> {
  const csrfResponse = await request.get('/api/auth/csrf')
  expect(csrfResponse.ok(), 'GET /api/auth/csrf').toBeTruthy()
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string }
  const response = await request.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password, callbackUrl: '/expenses' },
    maxRedirects: 0,
  })
  const location = response.headers()['location'] ?? ''
  if (response.status() !== 302 || location.includes('error=')) {
    throw new Error(
      `Connexion impossible pour ${email} (HTTP ${response.status()}, location=${location})`
    )
  }
}

/** Vérifie une réponse d'erreur métier : statut + champ `error` (format actuel `{ error }`). */
export async function expectApiError(
  response: APIResponse,
  status: number,
  message: string
): Promise<void> {
  expect(response.status(), `${response.url()} → statut`).toBe(status)
  expect(await response.json(), `${response.url()} → corps`).toMatchObject({ error: message })
}

export function expectNoteShape(note: ExpenseNoteDto): void {
  expect(note.id).toMatch(UUID_PATTERN)
  expect(note.userId).toMatch(UUID_PATTERN)
  expect(typeof note.amount).toBe('number')
  expect(note.expenseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(typeof note.description).toBe('string')
  expect(['pending', 'approved', 'rejected']).toContain(note.status)
  expect(new Date(note.createdAt).toISOString()).toBe(note.createdAt)
}

export function expectUserShape(user: CompanyUserDto): void {
  expect(user.id).toMatch(UUID_PATTERN)
  expect(typeof user.name).toBe('string')
  expect(typeof user.email).toBe('string')
  expect(['employee', 'manager']).toContain(user.role)
  if (user.managerId !== null) {
    expect(user.managerId).toMatch(UUID_PATTERN)
  }
}

let noteCounter = 0

/** Client HTTP authentifié pour un utilisateur donné. */
export class ApiClient {
  constructor(
    readonly request: APIRequestContext,
    readonly user: TestUser
  ) {}

  // --- Employé (tout utilisateur connecté) --------------------------------

  listNotes(query?: Record<string, string>): Promise<APIResponse> {
    return this.request.get('/api/expense-notes', { params: query })
  }

  async notes(query?: Record<string, string>): Promise<ExpenseNoteDto[]> {
    const response = await this.listNotes(query)
    expect(response.status(), 'GET /api/expense-notes').toBe(200)
    return (await response.json()) as ExpenseNoteDto[]
  }

  createNote(input: NoteInput): Promise<APIResponse> {
    const multipart: Record<string, string | UploadFile> = {}
    if (input.amount !== undefined) multipart.amount = input.amount
    if (input.expenseDate !== undefined) multipart.expenseDate = input.expenseDate
    if (input.description !== undefined) multipart.description = input.description
    if (input.receipt !== undefined) multipart.receipt = input.receipt
    return this.request.post('/api/expense-notes', { multipart })
  }

  /** Soumet une note valide (valeurs par défaut surchargeables) et renvoie le DTO créé. */
  async submitNote(input: NoteInput = {}): Promise<ExpenseNoteDto> {
    noteCounter += 1
    const description = input.description ?? `Note e2e ${noteCounter} de ${this.user.name}`
    const response = await this.createNote({
      amount: input.amount ?? '42.50',
      expenseDate: input.expenseDate ?? '2026-10-01',
      description,
      receipt: input.receipt ?? pngReceipt(`${this.user.email}/${description}`),
    })
    expect(response.status(), `POST /api/expense-notes : ${await response.text()}`).toBe(201)
    return (await response.json()) as ExpenseNoteDto
  }

  receiptUrl(noteId: string): Promise<APIResponse> {
    return this.request.get(`/api/expense-notes/${noteId}/receipt-url`)
  }

  suggest(receipt?: UploadFile): Promise<APIResponse> {
    return this.request.post('/api/expense-notes/receipt-suggestion', {
      multipart: receipt ? { receipt } : { autre: 'champ' },
    })
  }

  // --- Manager ------------------------------------------------------------

  managerPendingResponse(): Promise<APIResponse> {
    return this.request.get('/api/manager/expense-notes')
  }

  async managerPending(): Promise<ExpenseNoteDto[]> {
    const response = await this.managerPendingResponse()
    expect(response.status(), 'GET /api/manager/expense-notes').toBe(200)
    return (await response.json()) as ExpenseNoteDto[]
  }

  managerDecide(noteId: string, decision: Decision): Promise<APIResponse> {
    return this.request.post(`/api/manager/expense-notes/${noteId}/${decision}`)
  }

  managerReceiptUrl(noteId: string): Promise<APIResponse> {
    return this.request.get(`/api/manager/expense-notes/${noteId}/receipt-url`)
  }

  // --- RH -----------------------------------------------------------------

  hrPendingResponse(): Promise<APIResponse> {
    return this.request.get('/api/hr/expense-notes')
  }

  async hrPending(): Promise<ExpenseNoteDto[]> {
    const response = await this.hrPendingResponse()
    expect(response.status(), 'GET /api/hr/expense-notes').toBe(200)
    return (await response.json()) as ExpenseNoteDto[]
  }

  hrDecide(noteId: string, decision: Decision): Promise<APIResponse> {
    return this.request.post(`/api/hr/expense-notes/${noteId}/${decision}`)
  }

  hrReceiptUrl(noteId: string): Promise<APIResponse> {
    return this.request.get(`/api/hr/expense-notes/${noteId}/receipt-url`)
  }

  hrUsersResponse(): Promise<APIResponse> {
    return this.request.get('/api/hr/users')
  }

  async hrUsers(): Promise<CompanyUserDto[]> {
    const response = await this.hrUsersResponse()
    expect(response.status(), 'GET /api/hr/users').toBe(200)
    return (await response.json()) as CompanyUserDto[]
  }

  setManager(userId: string, managerId: string | null): Promise<APIResponse> {
    return this.request.put(`/api/hr/users/${userId}/manager`, { data: { managerId } })
  }

  /** Rattache via l'API RH et vérifie le succès. */
  async assignManager(userId: string, managerId: string | null): Promise<CompanyUserDto> {
    const response = await this.setManager(userId, managerId)
    expect(response.status(), `PUT /api/hr/users/${userId}/manager`).toBe(200)
    return (await response.json()) as CompanyUserDto
  }
}

/** Statut actuel d'une note, lu par son auteur via GET /api/expense-notes. */
export async function statusOf(authorApi: ApiClient, noteId: string): Promise<NoteStatus | undefined> {
  return (await authorApi.notes()).find((note) => note.id === noteId)?.status
}

/** Télécharge un reçu depuis son URL pré-signée et renvoie statut, type et contenu. */
export async function downloadReceipt(
  request: APIRequestContext,
  url: string
): Promise<{ status: number; contentType: string; body: Buffer }> {
  const response = await request.get(url)
  return {
    status: response.status(),
    contentType: response.headers()['content-type'] ?? '',
    body: await response.body(),
  }
}

/** URL pré-signée S3 de courte durée (≤ 5 min), sans exiger de domaine précis. */
export function expectPresignedUrl(url: string): void {
  const parsed = new URL(url)
  expect(parsed.searchParams.get('X-Amz-Signature')).toBeTruthy()
  const expires = Number(parsed.searchParams.get('X-Amz-Expires'))
  expect(expires).toBeGreaterThan(0)
  expect(expires).toBeLessThanOrEqual(300)
}

'use server'

import bcrypt from 'bcryptjs'
import { AuthError } from 'next-auth'
import { getPool } from '@/lib/db'
import { signIn, signOut } from '@/lib/auth'

export interface AuthFormState {
  error?: string
}

const MIN_PASSWORD_LENGTH = 8
const EMAIL_PATTERN = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/

export async function signup(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const name = formData.get('name')
  const email = formData.get('email')
  const password = formData.get('password')

  const emailMatch = typeof email === 'string' ? EMAIL_PATTERN.exec(email) : null
  if (
    typeof name !== 'string' ||
    name.trim().length === 0 ||
    !emailMatch ||
    typeof password !== 'string' ||
    password.length < MIN_PASSWORD_LENGTH
  ) {
    return {
      error: `Nom requis, email invalide, ou mot de passe trop court (${MIN_PASSWORD_LENGTH} caractères minimum).`,
    }
  }

  const existing = await getPool().query('SELECT id FROM users WHERE email = $1', [email])
  if ((existing.rowCount ?? 0) > 0) {
    return { error: 'Un compte existe déjà avec cet email.' }
  }

  const domain = emailMatch[1].toLowerCase()
  const companyName = domain.split('.')[0]

  const insertedCompany = await getPool().query<{ id: string }>(
    `INSERT INTO companies (name, email_domain) VALUES ($1, $2)
     ON CONFLICT (email_domain) DO NOTHING
     RETURNING id`,
    [companyName, domain]
  )

  let companyId: string
  let role: 'employee' | 'hr_admin'
  if (insertedCompany.rows[0]) {
    companyId = insertedCompany.rows[0].id
    role = 'hr_admin'
  } else {
    const existingCompany = await getPool().query<{ id: string }>(
      'SELECT id FROM companies WHERE email_domain = $1',
      [domain]
    )
    companyId = existingCompany.rows[0].id
    role = 'employee'
  }

  const passwordHash = await bcrypt.hash(password, 12)
  await getPool().query(
    'INSERT INTO users (name, email, password_hash, company_id, role) VALUES ($1, $2, $3, $4, $5)',
    [name.trim(), email, passwordHash, companyId, role]
  )

  try {
    await signIn('credentials', { email, password, redirectTo: '/expenses' })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: 'Le compte a été créé mais la connexion automatique a échoué.' }
    }
    throw error
  }
  return {}
}

export async function login(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = formData.get('email')
  const password = formData.get('password')

  if (typeof email !== 'string' || typeof password !== 'string') {
    return { error: 'Champs invalides.' }
  }

  try {
    await signIn('credentials', { email, password, redirectTo: '/expenses' })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: 'Email ou mot de passe incorrect.' }
    }
    throw error
  }
  return {}
}

export async function logout(): Promise<void> {
  await signOut({ redirectTo: '/login' })
}

import bcrypt from 'bcryptjs'
import { PostgresAccountRegistry } from '@/adapters/PostgresAccountRegistry'
import { PostgresInvitationRepository } from '@/adapters/PostgresInvitationRepository'
import { InviteEmployee } from '@/modules/identity/application/InviteEmployee'
import { SignUp } from '@/modules/identity/application/SignUp'
import { hashToken } from '@/lib/tokens'

const BCRYPT_COST = 12

export const accountRegistry = new PostgresAccountRegistry()
export const inviteEmployee = new InviteEmployee(new PostgresInvitationRepository())
export const signUp = new SignUp(accountRegistry, (password) => bcrypt.hash(password, BCRYPT_COST), hashToken)

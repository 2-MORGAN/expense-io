export type UserRole = 'employee' | 'manager' | 'hr_admin'

export interface UserProps {
  id: string
  email: string
  name: string
  role: UserRole
  managerId: string | null
}

export class User {
  constructor(private readonly props: UserProps) {}

  get id(): string {
    return this.props.id
  }

  get role(): UserRole {
    return this.props.role
  }

  isRootManager(): boolean {
    return this.props.role === 'manager' && this.props.managerId === null
  }

  canManage(other: User): boolean {
    return this.props.role === 'manager' && other.props.managerId === this.props.id
  }
}

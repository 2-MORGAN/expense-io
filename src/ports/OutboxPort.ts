export interface OutboxEvent {
  id: string
  companyId: string
  type: string
  payload: unknown
  attempts: number
  leaseToken: string
  createdAt: Date
}

export interface OutboxPort {
  claim(types: string[]): Promise<OutboxEvent | null>
}

import type { ReceiptOwner, ReceiptViewer } from '@/domain/expense/ReceiptAccess'

// Ce qu'il faut pour décider de l'accès à un reçu : sa clé, l'auteur de la
// note et le lecteur, tels que la base (sous RLS) les montre au lecteur.
export interface ReceiptAccess {
  receiptKey: string
  submitter: ReceiptOwner
  viewer: ReceiptViewer
}

// Lecture seule. `null` si la note ou l'un des comptes n'est pas visible.
export interface ReceiptAccessRepository {
  findReceipt(noteId: string, viewerId: string): Promise<ReceiptAccess | null>
}

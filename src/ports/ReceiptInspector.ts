import type { Receipt } from '@/domain/receipt/Receipt'

// Vérification du contenu d'un reçu (image décodable, PDF complet), sans OCR,
// upload ni persistance. La couche HTTP ne dépend que de ce port ; l'adaptateur
// (sharp, pdf-lib) est branché par la composition (ADR-002 §3.3).
export interface ReceiptInspector {
  /** Lève une `OcrError` si le contenu est invalide ou ne correspond pas au type. */
  inspect(receipt: Receipt): Promise<void>
}

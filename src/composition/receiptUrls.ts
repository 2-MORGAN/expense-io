import { PostgresReceiptAccessRepository } from '@/modules/expenses/adapters/PostgresReceiptAccessRepository'
import { S3ReceiptAdapter } from '@/adapters/S3ReceiptAdapter'
import { GetReceiptUrl } from '@/modules/expenses/application/GetReceiptUrl'

export const getReceiptUrl = new GetReceiptUrl(new PostgresReceiptAccessRepository(), new S3ReceiptAdapter())

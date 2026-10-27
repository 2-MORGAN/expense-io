import { PostgresReceiptAccessRepository } from '@/adapters/PostgresReceiptAccessRepository'
import { S3ReceiptAdapter } from '@/adapters/S3ReceiptAdapter'
import { GetReceiptUrl } from '@/application/GetReceiptUrl'

export const getReceiptUrl = new GetReceiptUrl(new PostgresReceiptAccessRepository(), new S3ReceiptAdapter())

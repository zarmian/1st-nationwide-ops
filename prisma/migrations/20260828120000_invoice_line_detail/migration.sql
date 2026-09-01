-- Per-site invoice lines: a secondary breakdown under the description.
ALTER TABLE "InvoiceLine" ADD COLUMN "detail" TEXT;

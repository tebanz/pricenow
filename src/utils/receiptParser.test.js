import test from 'node:test'
import assert from 'node:assert/strict'
import { isAdministrativeReceiptLine, parseReceiptOcr, RECEIPT_TYPES } from './receiptParser.js'

const products = [
  { id: 'pan-1', name: 'Pan hallulla', category: 'Panaderia', default_unit: 'kg' },
  { id: 'leche-1', name: 'Leche entera', category: 'Lacteos', default_unit: 'litro' },
]

test('detects itemized receipt with products', () => {
  const parsed = parseReceiptOcr([
    'SUPERMERCADO LOCAL',
    'PAN HALLULLA $1.990',
    'LECHE ENTERA 1 UN $1.250',
    'TOTAL $3.240',
  ].join('\n'), products)

  assert.equal(parsed.meta.receipt_type, RECEIPT_TYPES.ITEMIZED)
  assert.equal(parsed.meta.has_itemized_products, true)
  assert.equal(parsed.items.length, 2)
  assert.equal(parsed.items.every(item => item.include_in_report), true)
})

test('detects summary receipt without product items', () => {
  const parsed = parseReceiptOcr([
    'MINIMARKET CENTRAL',
    'NETO $10.000',
    'IVA $1.900',
    'TOTAL $11.900',
  ].join('\n'), products)

  assert.equal(parsed.meta.receipt_type, RECEIPT_TYPES.SUMMARY)
  assert.equal(parsed.items.length, 0)
  assert.equal(parsed.meta.net_amount, 10000)
  assert.equal(parsed.meta.tax_amount, 1900)
  assert.equal(parsed.meta.total_amount, 11900)
})

test('detects payment voucher and does not create products', () => {
  const parsed = parseReceiptOcr([
    'COMPROBANTE DE VENTA',
    'TARJETA DEBITO',
    'APROBACION 123456',
    'TERMINAL 87654321',
    'TOTAL $15.990',
  ].join('\n'), products)

  assert.equal(parsed.meta.receipt_type, RECEIPT_TYPES.PAYMENT)
  assert.equal(parsed.items.length, 0)
  assert.equal(parsed.meta.payment_method, 'debito')
  assert.equal(parsed.meta.total_amount, 15990)
})

test('does not treat date or folio as prices', () => {
  const parsed = parseReceiptOcr([
    'FECHA 13/06/2026 HORA 12:45',
    'FOLIO 123456789',
    'RUT 76.123.456-7',
    'TOTAL $8.500',
  ].join('\n'), products)

  assert.equal(isAdministrativeReceiptLine('FECHA 13/06/2026 HORA 12:45'), true)
  assert.equal(parsed.items.length, 0)
  assert.notEqual(parsed.meta.receipt_type, RECEIPT_TYPES.ITEMIZED)
})

test('total without product lines does not create products', () => {
  const parsed = parseReceiptOcr('TOTAL $1.250', products)
  assert.equal(parsed.items.length, 0)
  assert.equal(parsed.meta.total_amount, 1250)
})

test('detects unknown document when there are no reliable signals', () => {
  const parsed = parseReceiptOcr([
    'GRACIAS POR SU VISITA',
    'ATENDIDO POR PRICE NOW',
    'CODIGO 99887766',
  ].join('\n'), products)

  assert.equal(parsed.meta.receipt_type, RECEIPT_TYPES.UNKNOWN)
  assert.equal(parsed.items.length, 0)
})

test('marks inconsistent itemized receipt as unselected', () => {
  const parsed = parseReceiptOcr([
    'SUPERMERCADO LOCAL',
    'PAN HALLULLA $1.990',
    'LECHE ENTERA $1.250',
    'TOTAL $20.000',
  ].join('\n'), products)

  assert.equal(parsed.meta.receipt_type, RECEIPT_TYPES.ITEMIZED)
  assert.match(parsed.meta.reconciliation_warning, /no coincide/i)
  assert.equal(parsed.items.every(item => item.include_in_report === false), true)
})

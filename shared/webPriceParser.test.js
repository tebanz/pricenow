import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateParsedUnitPrice,
  isAllowedProviderUrl,
  parseOfficialCatalogHtml,
  parseOfficialCatalogText,
  parsePackageFromName,
} from './webPriceParser.js'

test('extrae productos desde JSON-LD', () => {
  const html = `
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "itemListElement": [{
          "@type": "Product",
          "name": "Arroz Ejemplo Grado 1 1 kg",
          "sku": "SKU-1",
          "brand": { "name": "Ejemplo" },
          "url": "/arroz-ejemplo-1kg/p",
          "offers": {
            "@type": "Offer",
            "price": "1790",
            "availability": "https://schema.org/InStock"
          }
        }]
      }
    </script>`

  const products = parseOfficialCatalogHtml({
    html,
    provider: 'jumbo',
    sourceUrl: 'https://www.jumbo.cl/despensa/arroz',
    category: 'Arroz',
  })

  assert.equal(products.length, 1)
  assert.equal(products[0].source_product_id, 'SKU-1')
  assert.equal(products[0].final_price, 1790)
  assert.equal(products[0].quantity, 1)
  assert.equal(products[0].unit, 'kg')
  assert.equal(products[0].unit_price, 1790)
  assert.equal(products[0].stock_status, 'in_stock')
})

test('extrae un producto desde una tarjeta HTML publica', () => {
  const html = `
    <a href="/product/arroz-g2-ejemplo-1-kg" aria-label="Arroz Ejemplo G2 largo delgado 1 Kg">
      <span>Oferta</span><span>$1.390</span><span>$1.790</span><span>$1.390 x kg</span>
    </a>`

  const products = parseOfficialCatalogHtml({
    html,
    provider: 'unimarc',
    sourceUrl: 'https://www.unimarc.cl/category/despensa/arroz',
    category: 'Arroz',
  })

  assert.equal(products.length, 1)
  assert.equal(products[0].final_price, 1390)
  assert.equal(products[0].normal_price, 1790)
  assert.equal(products[0].unit, 'kg')
})

test('interpreta packs y unidades normalizadas', () => {
  assert.deepEqual(parsePackageFromName('Bebida cola pack 6 un de 350 ml'), {
    quantity: 2100,
    unit: 'ml',
    package_text: 'pack 6 un de 350 ml',
  })
  assert.equal(calculateParsedUnitPrice(4200, 2100, 'ml'), 2000)
})

test('solo permite dominios oficiales configurados', () => {
  assert.equal(isAllowedProviderUrl('jumbo', 'https://www.jumbo.cl/despensa/arroz'), true)
  assert.equal(isAllowedProviderUrl('jumbo', 'https://example.com/jumbo'), false)
  assert.equal(isAllowedProviderUrl('lider', 'http://www.lider.cl/supermercado'), false)
})

test('extrae candidatos desde texto visible copiado de una categoria', () => {
  const products = parseOfficialCatalogText({
    text: `Arroz Tottus G2 Grano Largo Delgado 1 Kg. $ 1.350 UN. ($ 1.350 por KG)\nArroz Tucapel G1 Pregraneado 1 Kg $ 1.790 UN. $ 2.150 UN.`,
    provider: 'tottus',
    sourceUrl: 'https://www.tottus.cl/tottus-cl/lista/CATG27292/Arroz',
    category: 'Arroz',
  })
  assert.equal(products.length, 2)
  assert.equal(products[0].final_price, 1350)
  assert.equal(products[0].unit, 'kg')
  assert.equal(products[1].normal_price, 2150)
})

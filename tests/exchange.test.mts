import assert from 'node:assert/strict'
import { test } from 'node:test'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { ExchangeError, packageKey, sniffImage, toKstIso } from '../src/lib/exchange/format.ts'
import {
  buildProductJson,
  buildProductZip,
  contentDisposition,
  htmlToPlainText,
  nameImages,
  productZipName,
} from '../src/lib/exchange/product-package.ts'
import { readDetailPackage } from '../src/lib/exchange/detail-package.ts'
import { toNaverDetailContent, validateDetailHtml } from '../src/lib/exchange/detail-html.ts'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])
const WEBP = strToU8('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ')

const source = {
  id: '6f1c2e8a-0000-4000-8000-000000000001',
  sku: 'P001',
  name: '대추방울토마토 1.5kg',
  brand: '위더스상점',
  categoryText: '식품>농산물>과일>토마토',
  basePrice: 19900,
  origin: '국산(경남)',
  description: '<p>달고 <b>신선한</b> 토마토</p><p>당일 수확</p>',
  options: [
    { displayName: '3kg', priceDelta: 12000, isActive: true, position: 2 },
    { displayName: '품절옵션', priceDelta: 0, isActive: false, position: 3 },
    { displayName: '1.5kg', priceDelta: 0, isActive: true, position: 1 },
  ],
}

function detailZip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files)
}

function manifest(overrides: Record<string, unknown> = {}): Uint8Array {
  return strToU8(
    JSON.stringify({
      format: 'marketing-desk/detail@1',
      sku: 'P001',
      product_name: '토마토',
      kind: 'template',
      template: 'fresh-fruit',
      html: 'detail.html',
      images: ['images/01.png'],
      created_at: '2026-10-22T15:30:00+09:00',
      source: 'marketing_desk',
      future_field: true,
      ...overrides,
    })
  )
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>t</title>
<style>body{width:860px;margin:0 auto}.hero{color:#166534}.hero::before{content:"x"}</style></head>
<body><section class="hero"><h1>토마토</h1><img src="images/01.png" alt=""></section></body></html>`

test('sniffImage: by content, not by name', () => {
  assert.equal(sniffImage(PNG), 'png')
  assert.equal(sniffImage(JPG), 'jpg')
  assert.equal(sniffImage(WEBP), 'webp')
  assert.equal(sniffImage(strToU8('GIF89a')), null)
})

test('packageKey and toKstIso', () => {
  assert.equal(packageKey(' P001 ', 'id'), 'P001')
  assert.equal(packageKey(null, 'id'), 'id')
  assert.equal(toKstIso(new Date('2026-10-22T06:00:00Z')), '2026-10-22T15:00:00+09:00')
})

test('htmlToPlainText strips tags and keeps line breaks', () => {
  assert.equal(htmlToPlainText(source.description), '달고 신선한 토마토\n당일 수확')
  assert.equal(htmlToPlainText(null), '')
  assert.equal(htmlToPlainText('<style>p{color:red}</style><script>x()</script><p>본문</p>'), '본문')
})

test('product ZIP follows the layout Desk readProductZIP accepts', () => {
  const { images, skipped } = nameImages([JPG, PNG, strToU8('GIF89a')])
  assert.equal(skipped, 1)
  const json = buildProductJson(source, images, new Date('2026-10-22T06:00:00Z'))
  const files = unzipSync(buildProductZip(json, images))

  const names = Object.keys(files).sort()
  assert.deepEqual(names, ['images/01.jpg', 'images/02.png', 'product.json'])
  for (const name of names.filter((n) => n.startsWith('images/'))) {
    assert.match(name.slice('images/'.length), /^[0-9A-Za-z._-]{1,80}$/)
  }

  const parsed = JSON.parse(new TextDecoder().decode(files['product.json']))
  assert.equal(parsed.format, 'marketing-desk/product@1')
  assert.equal(parsed.sku, 'P001')
  assert.equal(parsed.name, source.name)
  assert.equal(parsed.origin, '국산(경남)')
  assert.equal(parsed.price, 19900)
  assert.equal(parsed.source, 'my_store')
  assert.deepEqual(parsed.options, [
    { name: '1.5kg', price_delta: 0 },
    { name: '3kg', price_delta: 12000 },
  ])
  for (const path of parsed.images) assert.ok(files[path], `${path} listed but missing`)
})

test('product ZIP: SKU falls back to the product id; bad image skipped', () => {
  const json = buildProductJson({ ...source, sku: null }, [], new Date())
  assert.equal(json.sku, source.id)
  assert.deepEqual(nameImages([strToU8('<html>')]), { images: [], skipped: 1 })
})

test('productZipName and contentDisposition keep headers ASCII-safe', () => {
  assert.equal(productZipName('P/001 토마토', 'id'), 'desk-product-P_001_토마토.zip')
  assert.equal(productZipName(null, 'abc'), 'desk-product-abc.zip')
  const header = contentDisposition('desk-product-토마토.zip')
  assert.match(header, /^attachment; filename="desk-product-___\.zip"; filename\*=UTF-8''desk-product-/)
})

test('readDetailPackage: accepts the contract layout', () => {
  const pkg = readDetailPackage(
    detailZip({ 'manifest.json': manifest(), 'detail.html': strToU8(PAGE), 'images/01.png': PNG })
  )
  assert.equal(pkg.manifest.sku, 'P001')
  assert.equal(pkg.manifest.kind, 'template')
  assert.equal(pkg.images.length, 1)
  assert.equal(pkg.images[0].type, 'png')
})

test('readDetailPackage: rejects foreign files, paths and formats', () => {
  const base = { 'manifest.json': manifest(), 'detail.html': strToU8(PAGE), 'images/01.png': PNG }
  assert.throws(() => readDetailPackage(detailZip({ ...base, 'evil.sh': strToU8('x') })), /허용되지 않은 파일/)
  assert.throws(() => readDetailPackage(detailZip({ ...base, '../x.png': PNG })), /허용되지 않은 파일/)
  assert.throws(
    () => readDetailPackage(detailZip({ ...base, 'manifest.json': manifest({ format: 'marketing-desk/detail@2' }) })),
    /지원하지 않는 형식/
  )
  assert.throws(
    () => readDetailPackage(detailZip({ ...base, 'images/01.png': strToU8('not an image') })),
    /PNG, JPEG, WebP/
  )
  assert.throws(
    () => readDetailPackage(detailZip({ ...base, 'manifest.json': manifest({ images: ['images/02.png'] }) })),
    /ZIP에 없습니다/
  )
  assert.throws(() => readDetailPackage(strToU8('not a zip')), /ZIP 파일을 읽지 못했습니다/)
})

test('readDetailPackage: rejects oversized documents after inflating', () => {
  const big = new Uint8Array(1024 * 1024 + 1).fill(0x20)
  assert.throws(
    () => readDetailPackage(detailZip({ 'manifest.json': manifest(), 'detail.html': big, 'images/01.png': PNG })),
    /너무 큽니다/
  )
})

test('validateDetailHtml: passive markup with package images passes', () => {
  assert.doesNotThrow(() => validateDetailHtml(PAGE, new Set(['images/01.png'])))
})

test('validateDetailHtml: refuses scripts, handlers, links and external resources', () => {
  const images = new Set(['images/01.png'])
  const refused = [
    '<script>alert(1)</script>',
    '<img src="images/01.png" onerror="x()">',
    '<a href="https://evil.example">x</a>',
    '<a href="java\tscript:x()">x</a>',
    '<img src="https://evil.example/a.png">',
    '<div style="background:url(https://evil.example/a.png)"></div>',
    '<style>@import "https://evil.example/a.css";</style>',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<svg><image href="x"/></svg>',
    '<img srcset="https://evil.example/a.png 2x" src="images/01.png">',
    '<div style="background:\\75 rl(https://evil.example/y)"></div>',
    '<style>p{background:\\75 rl(https://evil.example/y)}</style>',
    '<xmp><img src=x onerror=alert(1)></xmp>',
    '<noembed><img src=x onerror=alert(1)></noembed>',
  ]
  for (const html of refused) {
    assert.throws(() => validateDetailHtml(html, images), ExchangeError, html)
  }
})

test('toNaverDetailContent: inlines styles, keeps body, swaps image URLs', () => {
  const url = 'https://shop-phinf.pstatic.net/20261022_1/a.png'
  const result = toNaverDetailContent(PAGE, new Map([['images/01.png', url]]))
  assert.match(result, /^<div style="[^"]*width: 860px/)
  assert.match(result, /<section style="color: #166534;?">/)
  assert.ok(result.includes(`src="${url}"`))
  assert.ok(!result.includes('<style'))
  assert.ok(!result.includes('class='))
  assert.ok(!result.includes('<title'))
  assert.throws(() => toNaverDetailContent(PAGE, new Map()), /업로드하지 못한 사진/)
})

test('toNaverDetailContent: comment tricks cannot smuggle markup past the checks', () => {
  const tricky = '<body><img src="images/01.png"><p title="<!--">a</p><p title="-->"><img src=x onerror=alert(1)></p></body>'
  const url = 'https://shop-phinf.pstatic.net/a.png'
  // Input is rejected outright (src=x is not a package image) ...
  assert.throws(() => validateDetailHtml(tricky, new Set(['images/01.png'])), ExchangeError)
  // ... and the converter re-validates its own output.
  const withComment = '<body><!-- note --><p title="<!--">a</p><img src="images/01.png"><p title="-->">b</p></body>'
  const result = toNaverDetailContent(withComment, new Map([['images/01.png', url]]))
  assert.ok(!result.includes('note'))
  assert.ok(result.includes('>a</p>') && result.includes('>b</p>'))
})

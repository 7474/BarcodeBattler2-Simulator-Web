import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanShopName, isIsbn, itemLink, resolveOpenBD, resolveOpenFacts, resolveRakuten, resolveYahoo, safeImageUrl } from '../worker/products.ts'

const routes = (table: Record<string, unknown>) => {
  const calls: string[] = []
  const fetchJson = async (url: string) => {
    calls.push(url)
    const key = Object.keys(table).find(prefix => url.startsWith(prefix))
    if (!key) throw new Error(`unexpected ${url}`)
    const value = table[key]
    if (value instanceof Error) throw value
    return value
  }
  return { fetchJson, calls }
}

test('Yahoo!ショッピング: JAN search, shop tags stripped, only Yahoo image hosts', async () => {
  const { fetchJson, calls } = routes({
    'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch': {
      hits: [{ name: '【送料無料】 サントリー 天然水 550ml ★お得★', url: 'https://store.shopping.yahoo.co.jp/shop/item.html', exImage: { url: 'https://item-shopping.c.yimg.jp/i/n/store_item' }, image: { medium: 'https://evil.example/x.jpg' } }],
    },
  })
  const result = await resolveYahoo('app', '4901777018686', fetchJson)
  assert.deepEqual(result, {
    source: 'yahoo', name: 'サントリー 天然水 550ml', thumbnailUrl: 'https://item-shopping.c.yimg.jp/i/n/store_item',
    itemUrl: 'https://store.shopping.yahoo.co.jp/shop/item.html',
  })
  assert.match(calls[0], /jan_code=4901777018686/)
  assert.match(calls[0], /appid=app/)
  assert.doesNotMatch(calls[0], /affiliate/)
  const affiliate = routes({ 'https://shopping.yahooapis.jp/': { hits: [{ name: 'x', url: 'https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=1&pid=2&vc_url=x' }] } })
  assert.equal((await resolveYahoo('app', '4901777018686', affiliate.fetchJson, 'vc-id'))?.itemUrl, 'https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=1&pid=2&vc_url=x')
  assert.match(affiliate.calls[0], /affiliate_type=vc&affiliate_id=vc-id/)
  assert.equal(await resolveYahoo('app', '4901777018686', routes({ 'https://shopping.yahooapis.jp/': { hits: [] } }).fetchJson), null)
})

test('楽天市場: JAN as keyword, both image formats, only Rakuten image hosts', async () => {
  const flat = routes({
    'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701': {
      items: [{ itemName: '【楽天限定】 伊右衛門 500ml×24本', itemUrl: 'https://item.rakuten.co.jp/shop/item/', affiliateUrl: 'https://hb.afl.rakuten.co.jp/hgc/abc/?pc=x', mediumImageUrls: ['https://thumbnail.image.rakuten.co.jp/@0_mall/shop/cabinet/a.jpg?_ex=128x128'] }],
    },
  })
  assert.deepEqual(await resolveRakuten('app', 'key', '4901777411760', flat.fetchJson), {
    source: 'rakuten', name: '伊右衛門 500ml×24本', thumbnailUrl: 'https://thumbnail.image.rakuten.co.jp/@0_mall/shop/cabinet/a.jpg?_ex=128x128',
    itemUrl: 'https://hb.afl.rakuten.co.jp/hgc/abc/?pc=x',
  })
  assert.match(flat.calls[0], /keyword=4901777411760/)
  assert.match(flat.calls[0], /applicationId=app/)
  assert.match(flat.calls[0], /accessKey=key/)
  assert.match(flat.calls[0], /formatVersion=2/)
  assert.doesNotMatch(flat.calls[0], /affiliateId/)
  await resolveRakuten('app', 'key', '4901777411760', flat.fetchJson, 'afl-id')
  assert.match(flat.calls[1], /affiliateId=afl-id/)
  const nested = routes({
    'https://openapi.rakuten.co.jp/': { items: [{ item: { itemName: 'お茶', mediumImageUrls: [{ imageUrl: 'https://evil.example/a.jpg' }], smallImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/b.jpg' }] } }] },
  })
  assert.deepEqual(await resolveRakuten('app', 'key', '4901777411760', nested.fetchJson), { source: 'rakuten', name: 'お茶', thumbnailUrl: 'https://thumbnail.image.rakuten.co.jp/b.jpg', itemUrl: null })
  assert.equal(await resolveRakuten('app', 'key', '4901777411760', routes({ 'https://openapi.rakuten.co.jp/': { items: [] } }).fetchJson), null)
})

test('openBD: ISBN only, title and cover', async () => {
  assert.equal(isIsbn('9784088820255'), true)
  assert.equal(isIsbn('4901777018686'), false)
  const { fetchJson, calls } = routes({
    'https://api.openbd.jp/v1/get': [{ summary: { title: 'ONE PIECE 1', cover: 'https://cover.openbd.jp/9784088820255.jpg' } }],
  })
  assert.deepEqual(await resolveOpenBD('9784088820255', fetchJson), { source: 'openbd', name: 'ONE PIECE 1', thumbnailUrl: 'https://cover.openbd.jp/9784088820255.jpg' })
  assert.equal(await resolveOpenBD('4901777018686', fetchJson), null)
  assert.equal(calls.length, 1)
  assert.equal(await resolveOpenBD('9784088820255', routes({ 'https://api.openbd.jp/': [null] }).fetchJson), null)
})

test('Open Facts: Japanese name first, falls through sister databases and errors', async () => {
  const food = routes({
    'https://world.openfoodfacts.org/': { status: 1, product: { product_name_ja: 'コカ・コーラ', product_name: 'Coca-Cola', image_front_small_url: 'https://images.openfoodfacts.org/images/products/490/210/207/2618/front_ja.5.200.jpg' } },
  })
  assert.deepEqual(await resolveOpenFacts('4902102072618', food.fetchJson), {
    source: 'openfoodfacts', name: 'コカ・コーラ',
    cacheImageUrl: 'https://images.openfoodfacts.org/images/products/490/210/207/2618/front_ja.5.200.jpg',
    itemUrl: 'https://world.openfoodfacts.org/product/4902102072618',
  })
  const beauty = routes({
    'https://world.openfoodfacts.org/': new Error('timeout'),
    'https://world.openbeautyfacts.org/': { status: 1, product: { product_name: '', brands: 'Kao', image_small_url: 'https://images.openfoodfacts.org/wrong-host.jpg' } },
  })
  assert.deepEqual(await resolveOpenFacts('4901301000000', beauty.fetchJson), {
    source: 'openbeautyfacts', name: 'Kao', cacheImageUrl: null, itemUrl: 'https://world.openbeautyfacts.org/product/4901301000000',
  })
  const none = routes({ 'https://world.': { status: 0 } })
  assert.equal(await resolveOpenFacts('4901301000000', none.fetchJson), null)
  assert.equal(none.calls.length, 4)
})

test('image URLs must be https on an allowed host; shop names keep text when only tags', () => {
  assert.equal(safeImageUrl('http://cover.openbd.jp/a.jpg', ['cover.openbd.jp']), 'https://cover.openbd.jp/a.jpg')
  assert.equal(safeImageUrl('https://cover.openbd.jp:8443/a.jpg', ['cover.openbd.jp']), null)
  assert.equal(safeImageUrl('https://user@cover.openbd.jp/a.jpg', ['cover.openbd.jp']), null)
  assert.equal(safeImageUrl('javascript:alert(1)', ['cover.openbd.jp']), null)
  assert.equal(cleanShopName('【限定】'), '【限定】')
})

test('item links: platform name, affiliate flag, and only allowed hosts', () => {
  assert.deepEqual(itemLink('https://item.rakuten.co.jp/shop/item/'), { url: 'https://item.rakuten.co.jp/shop/item/', platform: '楽天市場', affiliate: false })
  assert.deepEqual(itemLink('https://hb.afl.rakuten.co.jp/hgc/x/'), { url: 'https://hb.afl.rakuten.co.jp/hgc/x/', platform: '楽天市場', affiliate: true })
  assert.equal(itemLink('https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=1')?.affiliate, true)
  assert.equal(itemLink('https://store.shopping.yahoo.co.jp/a/b.html')?.platform, 'Yahoo!ショッピング')
  assert.equal(itemLink('https://evil.example/item'), null)
  assert.equal(itemLink('javascript:alert(1)'), null)
  assert.equal(itemLink(null), null)
})

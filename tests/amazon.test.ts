import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AMAZON_ASSOCIATE_TAG,
  AMAZON_SEARCH_ENDPOINT,
  amazonAffiliateEnabled,
  amazonApiEnabled,
  amazonProductFromResponse,
  amazonSearchLinks,
  createAmazonSearchRequest,
  searchAmazonProduct,
} from '../worker/amazon.ts'

const env = {
  AMAZON_CLIENT_ID: 'client-id',
  AMAZON_CLIENT_SECRET: 'client-secret',
}

test('Amazon barcode affiliate links use the configured tracking ID without API credentials', () => {
  assert.equal(AMAZON_ASSOCIATE_TAG, 'koudenpa0a-22')
  assert.equal(amazonAffiliateEnabled(), true)
  assert.equal(amazonApiEnabled({}), false)
  assert.deepEqual(amazonSearchLinks('4901234567894'), {
    affiliateUrl: 'https://www.amazon.co.jp/s?k=4901234567894&tag=koudenpa0a-22',
    standardUrl: 'https://www.amazon.co.jp/s?k=4901234567894',
  })
  assert.deepEqual(amazonSearchLinks('978-4-00-000000-0'), {
    affiliateUrl: 'https://www.amazon.co.jp/s?k=978-4-00-000000-0&tag=koudenpa0a-22',
    standardUrl: 'https://www.amazon.co.jp/s?k=978-4-00-000000-0',
  })
  assert.equal(amazonApiEnabled(env), true)
})

test('Creators API search request targets Japan with bearer auth and barcode query', () => {
  const init = createAmazonSearchRequest('test-token', '4901234567894', AMAZON_ASSOCIATE_TAG)
  const headers = new Headers(init.headers)
  const payload = JSON.parse(String(init.body))
  assert.equal(AMAZON_SEARCH_ENDPOINT, 'https://creatorsapi.amazon/catalog/v1/searchItems')
  assert.equal(init.method, 'POST')
  assert.equal(payload.marketplace, 'www.amazon.co.jp')
  assert.equal(payload.partnerTag, AMAZON_ASSOCIATE_TAG)
  assert.equal(payload.keywords, '4901234567894')
  assert.ok(payload.resources.includes('itemInfo.externalIds'))
  assert.equal(headers.get('authorization'), ['Bearer', 'test-token'].join(' '))
  assert.equal(headers.get('x-marketplace'), 'www.amazon.co.jp')
})

test('Creators API lookup obtains and reuses an OAuth token', async () => {
  const originalFetch = globalThis.fetch
  const requests: { url: string; init: RequestInit }[] = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    requests.push({ url, init })
    if (url.endsWith('/auth/o2/token')) {
      const form = new URLSearchParams(String(init.body))
      assert.equal(form.get('grant_type'), 'client_credentials')
      assert.equal(form.get('client_id'), env.AMAZON_CLIENT_ID)
      assert.equal(form.get('scope'), 'creatorsapi::default')
      return Response.json({ access_token: 'lookup-test-token', expires_in: 3600 })
    }
    return Response.json({ itemsResult: { items: [] } })
  }
  try {
    assert.equal(await searchAmazonProduct(env, '4901234567894'), null)
    assert.equal(await searchAmazonProduct(env, '4901234567894'), null)
    assert.equal(requests.length, 3)
    assert.ok(requests[0]!.url.endsWith('/auth/o2/token'))
    assert.equal(requests[1]!.url, AMAZON_SEARCH_ENDPOINT)
    assert.equal(new Headers(requests[1]!.init.headers).get('authorization'),
      ['Bearer', 'lookup-test-token'].join(' '))
    assert.equal(requests[2]!.url, AMAZON_SEARCH_ENDPOINT)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Amazon product selection requires an exact EAN or UPC and validates its thumbnail URL', () => {
  const response = {
    itemsResult: {
      items: [
        {
          asin: 'B000000001',
          itemInfo: { title: { displayValue: 'Not this product' }, externalIds: { eans: { displayValues: ['4900000000000'] } } },
        },
        {
          asin: 'B000000002',
          itemInfo: {
            title: { displayValue: '商品\u0000名' },
            externalIds: { eans: { displayValues: ['4901234567894'] } },
          },
          images: { primary: { small: { url: 'https://m.media-amazon.com/images/I/example.jpg' } } },
        },
      ],
    },
  }
  assert.deepEqual(amazonProductFromResponse(response, '4901234567894'), {
    asin: 'B000000002',
    name: '商品名',
    thumbnail: 'https://m.media-amazon.com/images/I/example.jpg',
  })
  assert.equal(amazonProductFromResponse(response, '4901234567895'), null)
  assert.equal(amazonProductFromResponse({
    itemsResult: {
      items: [{
        asin: 'B000000002',
        itemInfo: { externalIds: { eans: { displayValues: ['4901234567894'] } } },
        images: { primary: { small: { url: 'https://attacker.example/image.jpg' } } },
      }],
    },
  }, '4901234567894')?.thumbnail, null)
})

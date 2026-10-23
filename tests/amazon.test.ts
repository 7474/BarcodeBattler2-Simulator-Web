import test from 'node:test'
import assert from 'node:assert/strict'
import { amazonAffiliateEnabled, amazonProductFromResponse, createAmazonSearchRequest } from '../worker/amazon.ts'

const env = {
  AMAZON_ACCESS_KEY: 'access-key',
  AMAZON_SECRET_KEY: 'secret-key',
  AMAZON_ASSOCIATE_TAG: 'example-22',
}

test('Amazon affiliate lookup requires a tag and both PA-API credentials', () => {
  assert.equal(amazonAffiliateEnabled(env), true)
  assert.equal(amazonAffiliateEnabled({ ...env, AMAZON_ASSOCIATE_TAG: 'invalid tag' }), false)
  assert.equal(amazonAffiliateEnabled({ ...env, AMAZON_SECRET_KEY: undefined }), false)
})

test('Amazon SearchItems request targets Japan and signs the barcode query', async () => {
  const { url, init } = await createAmazonSearchRequest(env, '4901234567894', new Date('2026-10-23T19:31:05.000Z'))
  const headers = new Headers(init.headers)
  const payload = JSON.parse(String(init.body))
  assert.equal(url, 'https://webservices.amazon.co.jp/paapi5/searchitems')
  assert.equal(payload.Marketplace, 'www.amazon.co.jp')
  assert.equal(payload.PartnerTag, env.AMAZON_ASSOCIATE_TAG)
  assert.equal(payload.Keywords, '4901234567894')
  assert.ok(payload.Resources.includes('ItemInfo.ExternalIds'))
  assert.equal(headers.get('x-amz-date'), '20261023T193105Z')
  assert.match(headers.get('authorization')!, /^AWS4-HMAC-SHA256 Credential=access-key\/20261023\/us-west-2\/ProductAdvertisingAPI\/aws4_request,/)
  assert.ok(!headers.get('authorization')!.includes(env.AMAZON_SECRET_KEY))
})

test('Amazon product selection requires an exact EAN or UPC and validates its thumbnail URL', () => {
  const response = {
    SearchResult: {
      Items: [
        {
          ASIN: 'B000000001',
          ItemInfo: { Title: { DisplayValue: 'Not this product' }, ExternalIds: { EANs: { DisplayValues: ['4900000000000'] } } },
        },
        {
          ASIN: 'B000000002',
          ItemInfo: {
            Title: { DisplayValue: '商品\u0000名' },
            ExternalIds: { EANs: { DisplayValues: ['4901234567894'] } },
          },
          Images: { Primary: { Small: { URL: 'https://m.media-amazon.com/images/I/example.jpg' } } },
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
    SearchResult: {
      Items: [{
        ASIN: 'B000000002',
        ItemInfo: { ExternalIds: { EANs: { DisplayValues: ['4901234567894'] } } },
        Images: { Primary: { Small: { URL: 'https://attacker.example/image.jpg' } } },
      }],
    },
  }, '4901234567894')?.thumbnail, null)
})

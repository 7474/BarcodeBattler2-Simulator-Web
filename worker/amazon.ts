const encoder = new TextEncoder()
const endpoint = 'https://webservices.amazon.co.jp/paapi5/searchitems'
const host = 'webservices.amazon.co.jp'
const region = 'us-west-2'
const service = 'ProductAdvertisingAPI'
const target = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems'
const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target'
const imageHosts = new Set([
  'm.media-amazon.com',
  'images-fe.ssl-images-amazon.com',
  'images-jp.ssl-images-amazon.com',
  'images-na.ssl-images-amazon.com',
])

export interface AmazonEnv {
  AMAZON_ACCESS_KEY?: string
  AMAZON_SECRET_KEY?: string
  AMAZON_ASSOCIATE_TAG?: string
}

export interface AmazonProduct {
  asin: string
  name: string | null
  thumbnail: string | null
}

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

async function hmac(key: Uint8Array, value: string): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(value)))
}

export function amazonAffiliateEnabled(env: AmazonEnv): boolean {
  return !!env.AMAZON_ACCESS_KEY && !!env.AMAZON_SECRET_KEY &&
    !!env.AMAZON_ASSOCIATE_TAG && /^[A-Za-z0-9_-]{1,64}$/.test(env.AMAZON_ASSOCIATE_TAG)
}

export async function createAmazonSearchRequest(
  env: AmazonEnv,
  barcode: string,
  date = new Date(),
): Promise<{ url: string; init: RequestInit }> {
  if (!amazonAffiliateEnabled(env)) throw new Error('Amazon Product Advertising API is not configured.')

  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payload = JSON.stringify({
    PartnerTag: env.AMAZON_ASSOCIATE_TAG,
    PartnerType: 'Associates',
    Marketplace: 'www.amazon.co.jp',
    Keywords: barcode,
    SearchIndex: 'All',
    ItemCount: 10,
    Resources: ['Images.Primary.Small', 'ItemInfo.Title', 'ItemInfo.ExternalIds'],
  })
  const canonicalHeaders = [
    'content-encoding:amz-1.0',
    'content-type:application/json; charset=utf-8',
    `host:${host}`,
    `x-amz-date:${amzDate}`,
    `x-amz-target:${target}`,
    '',
  ].join('\n')
  const canonicalRequest = [
    'POST',
    '/paapi5/searchitems',
    '',
    canonicalHeaders,
    signedHeaders,
    await sha256(payload),
  ].join('\n')
  const scope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256(canonicalRequest)}`
  const dateKey = await hmac(encoder.encode(`AWS4${env.AMAZON_SECRET_KEY}`), dateStamp)
  const regionKey = await hmac(dateKey, region)
  const serviceKey = await hmac(regionKey, service)
  const signingKey = await hmac(serviceKey, 'aws4_request')
  const signature = hex(await hmac(signingKey, stringToSign))
  const authorization = `AWS4-HMAC-SHA256 Credential=${env.AMAZON_ACCESS_KEY}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    url: endpoint,
    init: {
      method: 'POST',
      headers: {
        'Content-Encoding': 'amz-1.0',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Amz-Date': amzDate,
        'X-Amz-Target': target,
        Authorization: authorization,
      },
      body: payload,
    },
  }
}

function imageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && imageHosts.has(url.hostname) && !url.port &&
      !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

export function amazonProductFromResponse(value: unknown, barcode: string): AmazonProduct | null {
  if (!value || typeof value !== 'object') return null
  const items = (value as { SearchResult?: { Items?: unknown } }).SearchResult?.Items
  if (!Array.isArray(items)) return null
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as {
      ASIN?: unknown
      ItemInfo?: {
        Title?: { DisplayValue?: unknown }
        ExternalIds?: { EANs?: { DisplayValues?: unknown }; UPCs?: { DisplayValues?: unknown } }
      }
      Images?: { Primary?: { Small?: { URL?: unknown } } }
    }
    const identifiers = [
      item.ItemInfo?.ExternalIds?.EANs?.DisplayValues,
      item.ItemInfo?.ExternalIds?.UPCs?.DisplayValues,
    ].flatMap(values => Array.isArray(values) ? values : [])
    if (!identifiers.includes(barcode) || typeof item.ASIN !== 'string' || !/^[A-Z0-9]{10}$/.test(item.ASIN)) continue
    const title = item.ItemInfo?.Title?.DisplayValue
    return {
      asin: item.ASIN,
      name: typeof title === 'string' ? title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) || null : null,
      thumbnail: imageUrl(item.Images?.Primary?.Small?.URL),
    }
  }
  return null
}

export async function searchAmazonProduct(env: AmazonEnv, barcode: string): Promise<AmazonProduct | null> {
  const { url, init } = await createAmazonSearchRequest(env, barcode)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3500)
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal })
    if (!response.ok || !response.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
      await response.body?.cancel()
      return null
    }
    const chunks: Uint8Array[] = []
    let size = 0
    const reader = response.body?.getReader()
    if (!reader) return null
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 128 * 1024) {
          await reader.cancel()
          return null
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return amazonProductFromResponse(JSON.parse(new TextDecoder().decode(bytes)), barcode)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Product name / thumbnail resolvers, tried in order by the Worker.
 * Each returns null when the source has nothing for the barcode, and throws on
 * transport errors (the caller moves on to the next source either way).
 *
 * - Yahoo!ショッピング 商品検索 v3 (jan_code): https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html
 *   Needs a Client ID; credit display: https://developer.yahoo.co.jp/attribution/
 * - 楽天市場商品検索 (keyword = JAN): https://webservice.rakuten.co.jp/documentation/ichiba-item-search
 *   Needs an application ID and access key; credit: https://webservice.rakuten.co.jp/guide/credit
 * - openBD (ISBN): https://openbd.jp/ — data may be used only to introduce or
 *   promote books (https://openbd.jp/terms/); shown unmodified with buy links.
 * - Open Food Facts and its sister databases (ODbL, images CC BY-SA).
 */
export type ProductSource = 'amazon' | 'yahoo' | 'rakuten' | 'openbd' | 'openfoodfacts' | 'openbeautyfacts' | 'openproductsfacts' | 'openpetfoodfacts'

export interface ResolvedProduct {
  source: ProductSource
  name: string | null
  /** Image shown straight from the provider (allowed by the CSP img-src). */
  thumbnailUrl?: string | null
  /** Image the Worker copies into R2 and serves from /api/images. */
  cacheImageUrl?: string | null
  /** The product's page on the source platform; thumbnails link here. */
  itemUrl?: string | null
}

export type FetchJson = (url: string) => Promise<unknown>

/** Hosts whose images are linked directly (they are not stored). */
export const LINKED_IMAGE_HOSTS: Record<'yahoo' | 'rakuten' | 'openbd', readonly string[]> = {
  yahoo: ['item-shopping.c.yimg.jp'],
  rakuten: ['thumbnail.image.rakuten.co.jp'],
  openbd: ['cover.openbd.jp'],
}

const OPEN_FACTS = [
  ['openfoodfacts', 'world.openfoodfacts.org', 'images.openfoodfacts.org'],
  ['openbeautyfacts', 'world.openbeautyfacts.org', 'images.openbeautyfacts.org'],
  ['openproductsfacts', 'world.openproductsfacts.org', 'images.openproductsfacts.org'],
  ['openpetfoodfacts', 'world.openpetfoodfacts.org', 'images.openpetfoodfacts.org'],
] as const

/** Hosts an item link may point at, with the platform name shown on the link. */
export const ITEM_LINK_HOSTS: Record<string, string> = {
  'store.shopping.yahoo.co.jp': 'Yahoo!ショッピング',
  'shopping.yahoo.co.jp': 'Yahoo!ショッピング',
  'paypaymall.yahoo.co.jp': 'Yahoo!ショッピング',
  'lohaco.yahoo.co.jp': 'Yahoo!ショッピング',
  'ck.jp.ap.valuecommerce.com': 'Yahoo!ショッピング',
  'item.rakuten.co.jp': '楽天市場',
  'hb.afl.rakuten.co.jp': '楽天市場',
  'world.openfoodfacts.org': 'Open Food Facts',
  'world.openbeautyfacts.org': 'Open Beauty Facts',
  'world.openproductsfacts.org': 'Open Products Facts',
  'world.openpetfoodfacts.org': 'Open Pet Food Facts',
}
/** Redirectors used by ValueCommerce (Yahoo!) and 楽天アフィリエイト links. */
export const AFFILIATE_LINK_HOSTS: readonly string[] = ['ck.jp.ap.valuecommerce.com', 'hb.afl.rakuten.co.jp']

/** Platform name and whether the link is an affiliate link, for an allowed item URL. */
export function itemLink(raw: unknown): { url: string; platform: string; affiliate: boolean } | null {
  const url = safeImageUrl(raw, Object.keys(ITEM_LINK_HOSTS))
  if (!url) return null
  const host = new URL(url).hostname
  return { url, platform: ITEM_LINK_HOSTS[host], affiliate: AFFILIATE_LINK_HOSTS.includes(host) }
}

/** Hosts whose images may be copied into R2. */
export const CACHED_IMAGE_HOSTS: readonly string[] = OPEN_FACTS.map(([, , images]) => images)

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160) || null
}

/** Shop listings often prefix names with 【送料無料】-style tags; keep the product name. */
export function cleanShopName(raw: unknown): string | null {
  const name = cleanName(raw)
  if (!name) return null
  const stripped = name.replace(/【[^】]*】|［[^］]*］|\[[^\]]*\]|《[^》]*》|★[^★]*★/g, ' ').replace(/\s+/g, ' ').trim()
  return stripped || name
}

export function safeImageUrl(raw: unknown, hosts: readonly string[]): string | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const url = new URL(raw.startsWith('http://') ? `https://${raw.slice(7)}` : raw)
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !hosts.includes(url.hostname)) return null
    return url.href
  } catch {
    return null
  }
}

/** affiliateId is a ValueCommerce affiliate ID (affiliate_type=vc); item URLs then carry it. */
export async function resolveYahoo(appId: string, code: string, fetchJson: FetchJson, affiliateId?: string): Promise<ResolvedProduct | null> {
  const query = new URLSearchParams({ appid: appId, jan_code: code, results: '1', image_size: '300' })
  if (affiliateId) { query.set('affiliate_type', 'vc'); query.set('affiliate_id', affiliateId) }
  const data = await fetchJson(`https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?${query}`) as {
    hits?: { name?: unknown; url?: unknown; image?: { medium?: unknown; small?: unknown }; exImage?: { url?: unknown } }[]
  }
  const hit = data?.hits?.[0]
  if (!hit) return null
  const name = cleanShopName(hit.name)
  const thumbnailUrl = safeImageUrl(hit.exImage?.url, LINKED_IMAGE_HOSTS.yahoo) ??
    safeImageUrl(hit.image?.medium, LINKED_IMAGE_HOSTS.yahoo) ?? safeImageUrl(hit.image?.small, LINKED_IMAGE_HOSTS.yahoo)
  return name || thumbnailUrl ? { source: 'yahoo', name, thumbnailUrl, itemUrl: itemLink(hit.url)?.url ?? null } : null
}

/**
 * 楽天市場 has no JAN parameter, so the JAN is the keyword; listings usually
 * carry it in their text. formatVersion=2 flattens items; image entries may be
 * strings or { imageUrl } depending on the format version.
 */
export async function resolveRakuten(applicationId: string, accessKey: string, code: string, fetchJson: FetchJson, affiliateId?: string): Promise<ResolvedProduct | null> {
  const query = new URLSearchParams({
    applicationId, accessKey, keyword: code, hits: '1', imageFlag: '1', formatVersion: '2',
    elements: 'itemName,itemUrl,affiliateUrl,mediumImageUrls,smallImageUrls',
  })
  // With affiliateId the API also returns affiliateUrl (and itemUrl matches it).
  if (affiliateId) query.set('affiliateId', affiliateId)
  type Item = { itemName?: unknown; itemUrl?: unknown; affiliateUrl?: unknown; mediumImageUrls?: unknown[]; smallImageUrls?: unknown[] }
  const data = await fetchJson(`https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?${query}`) as {
    items?: (Item & { item?: Item })[]
  }
  const raw = data?.items?.[0]
  const item = raw?.item ?? raw
  if (!item) return null
  const image = (list: unknown[] | undefined) => {
    const first = list?.[0] as unknown
    const url = typeof first === 'string' ? first : (first as { imageUrl?: unknown } | undefined)?.imageUrl
    return safeImageUrl(url, LINKED_IMAGE_HOSTS.rakuten)
  }
  const name = cleanShopName(item.itemName)
  const thumbnailUrl = image(item.mediumImageUrls) ?? image(item.smallImageUrls)
  const itemUrl = itemLink(item.affiliateUrl)?.url ?? itemLink(item.itemUrl)?.url ?? null
  return name || thumbnailUrl ? { source: 'rakuten', name, thumbnailUrl, itemUrl } : null
}

export const isIsbn = (code: string) => /^97[89]\d{10}$/.test(code)

export async function resolveOpenBD(code: string, fetchJson: FetchJson): Promise<ResolvedProduct | null> {
  if (!isIsbn(code)) return null
  const data = await fetchJson(`https://api.openbd.jp/v1/get?isbn=${code}`) as ({ summary?: { title?: unknown; cover?: unknown } } | null)[]
  const summary = Array.isArray(data) ? data[0]?.summary : undefined
  if (!summary) return null
  const name = cleanName(summary.title)
  const thumbnailUrl = safeImageUrl(summary.cover, LINKED_IMAGE_HOSTS.openbd)
  return name || thumbnailUrl ? { source: 'openbd', name, thumbnailUrl } : null
}

type OpenFactsProduct = {
  product_name_ja?: unknown; product_name?: unknown; product_name_en?: unknown
  generic_name?: unknown; brands?: unknown; image_small_url?: unknown; image_front_small_url?: unknown
}

/** Open Food Facts, then Beauty / Products / Pet Food Facts (same API v2). */
export async function resolveOpenFacts(code: string, fetchJson: FetchJson): Promise<ResolvedProduct | null> {
  const fields = 'product_name_ja,product_name,product_name_en,generic_name,brands,image_small_url,image_front_small_url'
  for (const [source, host, imageHost] of OPEN_FACTS) {
    let data: { status?: number; product?: OpenFactsProduct }
    try {
      data = await fetchJson(`https://${host}/api/v2/product/${code}.json?fields=${fields}`) as typeof data
    } catch {
      continue
    }
    const product = data?.status === 1 ? data.product : undefined
    if (!product) continue
    const name = cleanName(product.product_name_ja) ?? cleanName(product.product_name) ?? cleanName(product.product_name_en) ??
      cleanName(product.generic_name) ?? cleanName(product.brands)
    const cacheImageUrl = safeImageUrl(product.image_front_small_url, [imageHost]) ?? safeImageUrl(product.image_small_url, [imageHost])
    // Link the (CC BY-SA) image back to its product page.
    if (name || cacheImageUrl) return { source, name, cacheImageUrl, itemUrl: `https://${host}/product/${code}` }
  }
  return null
}

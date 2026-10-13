const headers = {
  Accept: "application/json",
}

const cache = new Map<string, { expires: number; value: unknown }>()

async function cachedJson<T>(url: string, ttlMs: number): Promise<T> {
  const hit = cache.get(url)
  if (hit && hit.expires > Date.now()) return hit.value as T

  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`Scryfall request failed (${response.status})`)

  const value = (await response.json()) as T
  cache.set(url, { expires: Date.now() + ttlMs, value })
  return value
}

export type ScryfallCard = {
  id: string
  finishes?: string[]
  oracle_id?: string
  name: string
  set: string
  set_name: string
  collector_number: string
  type_line?: string
  colors?: string[]
  color_identity?: string[]
  cmc?: number
  legalities?: Record<string, string>
  image_uris?: { normal?: string }
  card_faces?: Array<{ image_uris?: { normal?: string }; colors?: string[] }>
}

export async function autocompleteCards(query: string): Promise<string[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const params = new URLSearchParams({ q })
  const data = await cachedJson<{ data?: string[] }>(
    `https://api.scryfall.com/cards/autocomplete?${params}`,
    5 * 60 * 1000,
  )
  return data.data ?? []
}

export async function searchPrintings(name: string): Promise<ScryfallCard[]> {
  const params = new URLSearchParams({
    q: `!"${name}"`,
    unique: "prints",
    order: "released",
    dir: "desc",
  })

  return searchPages(`https://api.scryfall.com/cards/search?${params}`)
}

// Search returns real cards so the result list can show artwork immediately.
export async function searchCards(query: string): Promise<ScryfallCard[]> {
  const params = new URLSearchParams({
    q: `name:"${query.trim().replace(/["\\]/g, "")}"`,
    unique: "cards",
    order: "name",
  })
  try {
    const data = await cachedJson<{ data?: ScryfallCard[] }>(
      `https://api.scryfall.com/cards/search?${params}`, 5 * 60 * 1000,
    )
    return (data.data ?? []).slice(0, 8)
  } catch (error) {
    if (error instanceof Error && error.message.includes("(404)")) return []
    throw error
  }
}

async function searchPages(url: string): Promise<ScryfallCard[]> {
  const rows: ScryfallCard[] = []
  const seen = new Set<string>()
  while (url && !seen.has(url)) {
    seen.add(url)
    const page = await cachedJson<{ data?: ScryfallCard[]; has_more?: boolean; next_page?: string }>(
      url, 30 * 60 * 1000,
    )
    rows.push(...(page.data ?? []))
    url = page.has_more ? page.next_page ?? "" : ""
    if (url) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return rows
}

export function cardImage(card: ScryfallCard): string | null {
  if (card.image_uris?.normal) return card.image_uris.normal
  for (const face of card.card_faces ?? []) {
    if (face.image_uris?.normal) return face.image_uris.normal
  }
  return null
}

export function cardColors(card: ScryfallCard): string[] {
  if (card.colors) return card.colors
  return card.card_faces?.[0]?.colors ?? []
}



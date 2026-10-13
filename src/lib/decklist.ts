import type { CardCatalog, CollectionItem, DecklistEntry, DeckProgress } from "./types"

export type ParsedDeckLine = { name: string; quantity: number; line: number }
export type LineError = { line: number; text: string; message: string }

export function parseDecklist(text: string): { lines: ParsedDeckLine[]; errors: LineError[] } {
  const lines = new Map<string, ParsedDeckLine>()
  const errors: LineError[] = []
  text.split(/\r?\n/).forEach((raw, index) => {
    const value = raw.trim()
    if (!value) return
    const match = value.match(/^(\d+)\s*[xX]?\s+(.+)$/)
    const quantity = match ? Number(match[1]) : 1
    const name = match ? match[2].trim() : value
    if ((!match && /^[+-]?\d/.test(value)) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) {
      errors.push({ line: index + 1, text: raw, message: "Use a positive whole-number quantity followed by a card name." })
      return
    }
    const key = name.toLocaleLowerCase()
    const existing = lines.get(key)
    const total = quantity + (existing?.quantity ?? 0)
    if (total > 2147483647) { errors.push({line:index+1,text:raw,message:"Combined quantity is too large."}); return }
    lines.set(key, { name: existing?.name ?? name, quantity: total, line: existing?.line ?? index + 1 })
  })
  return { lines: [...lines.values()], errors }
}

export function cardIdentity(card: Pick<CardCatalog, "id" | "oracle_id">): string {
  return card.oracle_id ? `oracle:${card.oracle_id}` : `printing:${card.id}`
}
export function collectionItemKey(item:CollectionItem):string {
  return `${item.loan_role??"owned"}:${item.id}:${item.loan_transaction_id??0}`
}

export function eligibleFillSources(entry: Pick<DecklistEntry, "identity_key" | "holder_id">, items: CollectionItem[]): CollectionItem[] {
  return items.filter(item => cardIdentity(item.card) === entry.identity_key &&
    item.holder_id !== entry.holder_id && item.holder?.type !== "deck" &&
    (item.loan_role === "borrower" || (!item.lent_quantity && !item.reserved_quantity)))
}

export function calculateDeckProgress(entries: DecklistEntry[], items: CollectionItem[], deckId: number): DeckProgress {
  const remaining = new Map(entries.map(entry => [entry.identity_key, entry.desired_quantity]))
  const counts = new Map<string, { placed: number; borrowed: number }>()
  const extras: DeckProgress["extras"] = []
  for (const item of items.filter(item => item.holder_id === deckId)) {
    const key = cardIdentity(item.card)
    const usable = Math.max(0, item.quantity - (item.loan_role === "lender" ? item.lent_quantity ?? 0 : 0))
    const used = Math.min(usable, remaining.get(key) ?? 0)
    remaining.set(key, Math.max(0, (remaining.get(key) ?? 0) - used))
    const current = counts.get(key) ?? { placed: 0, borrowed: 0 }
    current.placed += used
    if (item.loan_role === "borrower") current.borrowed += used
    counts.set(key, current)
    if (usable > used) extras.push({ item, quantity: usable - used })
  }
  const rows = entries.map(entry => {
    const count = counts.get(entry.identity_key) ?? { placed: 0, borrowed: 0 }
    const missing = entry.desired_quantity - count.placed
    const available = eligibleFillSources(entry, items).reduce((sum,item) => sum + (item.loan_role === "borrower" && item.quantity > missing ? 0 : item.quantity), 0)
    return { entry, ...count, missing, available }
  })
  return {
    planned: entries.reduce((sum,entry) => sum + entry.desired_quantity, 0),
    placed: rows.reduce((sum,row) => sum + row.placed, 0),
    borrowed: rows.reduce((sum,row) => sum + row.borrowed, 0),
    missing: rows.reduce((sum,row) => sum + row.missing, 0), rows, extras,
  }
}

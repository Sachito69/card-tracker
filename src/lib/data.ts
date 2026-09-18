import { supabase } from "./supabase"
import type { CardCatalog, CollectionItem, Contact, Friend, Holder, HolderType, TransactionHistoryItem } from "./types"
import type { ScryfallCard } from "./scryfall"
import { cardColors, cardImage } from "./scryfall"

export async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw error ?? new Error("Not signed in")
  return data.user.id
}

export async function fetchHolders(): Promise<Holder[]> {
  const { data, error } = await supabase
    .from("holders")
    .select("*")
    .order("type")
    .order("name")

  if (error) throw error
  return (data ?? []) as Holder[]
}

export async function createHolder(
  name: string,
  type: HolderType,
  notes = "",
): Promise<Holder> {
  const user_id = await getCurrentUserId()
  const { data, error } = await supabase
    .from("holders")
    .insert({ user_id, name: name.trim(), type, notes: notes.trim() || null })
    .select("*")
    .single()

  if (error) throw error
  return data as Holder
}

export async function fetchCollection(): Promise<CollectionItem[]> {
  const { data, error } = await supabase
    .from("collection_items")
    .select(`
      id,
      user_id,
      card_id,
      holder_id,
      quantity,
      condition,
      foil,
      created_at,
      card:card_catalog (
        id,
        oracle_id,
        name,
        set_code,
        set_name,
        collector_number,
        image_url,
        type_line,
        colors,
        cmc,
        legalities
      ),
      holder:holders (
        id,
        user_id,
        name,
        type,
        notes,
        created_at
      )
    `)
    .order("created_at", { ascending: false })

  if (error) throw error

  return (data ?? []).map((row: any) => ({
    ...row,
    card: Array.isArray(row.card) ? row.card[0] : row.card,
    holder: Array.isArray(row.holder) ? row.holder[0] ?? null : row.holder ?? null,
  })) as CollectionItem[]
}

export async function saveCatalogCard(card: ScryfallCard): Promise<CardCatalog> {
  const payload = {
    id: card.id,
    oracle_id: card.oracle_id ?? null,
    name: card.name,
    set_code: card.set,
    set_name: card.set_name,
    collector_number: card.collector_number,
    image_url: cardImage(card),
    type_line: card.type_line ?? null,
    colors: cardColors(card),
    cmc: card.cmc ?? null,
    legalities: card.legalities ?? {},
  }

  const { data, error } = await supabase
    .from("card_catalog")
    .upsert(payload, { onConflict: "id" })
    .select("*")
    .single()

  if (error) throw error
  return data as CardCatalog
}

export async function addCollectionItem(args: {
  card: ScryfallCard
  quantity: number
  condition: CollectionItem["condition"]
  foil: boolean
  holder_id: number | null
}): Promise<void> {
  const user_id = await getCurrentUserId()
  await saveCatalogCard(args.card)

  let query = supabase
    .from("collection_items")
    .select("id,quantity")
    .eq("user_id", user_id)
    .eq("card_id", args.card.id)
    .eq("condition", args.condition)
    .eq("foil", args.foil)

  query = args.holder_id === null
    ? query.is("holder_id", null)
    : query.eq("holder_id", args.holder_id)

  const { data: existing, error: existingError } = await query.limit(1)
  if (existingError) throw existingError

  if (existing?.length) {
    const row = existing[0]
    const { error } = await supabase
      .from("collection_items")
      .update({ quantity: row.quantity + args.quantity })
      .eq("id", row.id)

    if (error) throw error
    return
  }

  const { error } = await supabase.from("collection_items").insert({
    user_id,
    card_id: args.card.id,
    holder_id: args.holder_id,
    quantity: args.quantity,
    condition: args.condition,
    foil: args.foil,
  })

  if (error) throw error
}

export async function updateCollectionItem(
  id: number,
  patch: Partial<Pick<CollectionItem, "quantity" | "condition" | "foil" | "holder_id">>,
): Promise<void> {
  const { error } = await supabase
    .from("collection_items")
    .update(patch)
    .eq("id", id)

  if (error) throw error
}

export async function deleteCollectionItem(id: number): Promise<void> {
  const { error } = await supabase.from("collection_items").delete().eq("id", id)
  if (error) throw error
}

export async function fetchFriends(): Promise<Friend[]> {
  const userId = await getCurrentUserId()

  const { data: rows, error } = await supabase
    .from("friendships")
    .select("user_a,user_b,status")
    .eq("status", "accepted")
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)

  if (error) throw error

  const ids = (rows ?? []).map((row: any) =>
    row.user_a === userId ? row.user_b : row.user_a
  )
  if (!ids.length) return []

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("user_id,username")
    .in("user_id", ids)

  if (profileError) throw profileError
  return (profiles ?? []) as Friend[]
}

export async function fetchContacts(): Promise<Contact[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .order("name")

  if (error) throw error
  return (data ?? []) as Contact[]
}

export async function createContact(name: string, phone = "", notes = ""): Promise<Contact> {
  const user_id = await getCurrentUserId()
  const { data, error } = await supabase
    .from("contacts")
    .insert({
      user_id,
      name: name.trim(),
      phone: phone.trim() || null,
      notes: notes.trim() || null,
    })
    .select("*")
    .single()

  if (error) throw error
  return data as Contact
}

export async function findUsers(query: string): Promise<Friend[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const current = await getCurrentUserId()
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,username")
    .ilike("username", `%${q}%`)
    .neq("user_id", current)
    .limit(8)

  if (error) throw error
  return (data ?? []) as Friend[]
}

export async function sendFriendRequest(targetUserId: string): Promise<void> {
  const { error } = await supabase.rpc("send_friend_request", { p_target: targetUserId })
  if (error) throw error
}



export async function fetchTransactionHistory(): Promise<TransactionHistoryItem[]> {
  const userId = await getCurrentUserId()
  const { data, error } = await supabase
    .from("card_transactions")
    .select(`
      id,
      owner_id,
      recipient_user_id,
      transaction_type,
      quantity,
      status,
      created_at,
      completed_at,
      card:card_catalog(name)
    `)
    .or(`owner_id.eq.${userId},recipient_user_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(100)

  if (error) throw error

  return (data ?? []).map((row: any) => ({
    id: row.id,
    transaction_type: row.transaction_type,
    quantity: row.quantity,
    status: row.status,
    created_at: row.created_at,
    completed_at: row.completed_at ?? null,
    card_name: Array.isArray(row.card) ? row.card[0]?.name ?? "Unknown card" : row.card?.name ?? "Unknown card",
  })) as TransactionHistoryItem[]
}

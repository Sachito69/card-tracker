import { supabase } from "./supabase"
import type {
  CardCatalog,
  CollectionItem,
  Contact,
  Friend,
  Holder,
  HolderType,
  NotificationItem,
  TransactionHistoryItem,
  TransactionType,
  PendingItem,
} from "./types"
import type { ScryfallCard } from "./scryfall"
import { cardColors, cardImage } from "./scryfall"

export async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw error ?? new Error("Not signed in")
  return data.user.id
}

export async function fetchCurrentProfile() {
  const userId = await getCurrentUserId()
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,username")
    .eq("user_id", userId)
    .single()

  if (error) throw error
  return data as { user_id: string; username: string | null }
}


export async function updateUsername(username: string): Promise<void> {
  const userId = await getCurrentUserId()
  const clean = username.trim()
  if (!/^[A-Za-z0-9_]{3,24}$/.test(clean)) throw new Error("Username must be 3–24 characters using letters, numbers, or _.")
  const { error } = await supabase.from("profiles").update({ username: clean }).eq("user_id", userId)
  if (error) throw error
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
  format: string | null = null,
): Promise<Holder> {
  const user_id = await getCurrentUserId()
  const { data, error } = await supabase
    .from("holders")
    .insert({
      user_id,
      name: name.trim(),
      type,
      format: type === "deck" ? (format?.trim() || null) : null,
      notes: notes.trim() || null,
    })
    .select("*")
    .single()

  if (error) throw error
  return data as Holder
}

function normalizeCardRelation(row: any): CollectionItem {
  return {
    ...row,
    card: Array.isArray(row.card) ? row.card[0] : row.card,
    holder: Array.isArray(row.holder) ? row.holder[0] ?? null : row.holder ?? null,
    loan_role: null,
    loan_transaction_id: null,
    loan_status: null,
    loan_friend_id: null,
    loan_friend_username: null,
    loan_friend_ids: [],
    lent_quantity: 0,
  } as CollectionItem
}

export async function fetchCollection(): Promise<CollectionItem[]> {
  const userId = await getCurrentUserId()

  const [ownedResult, outgoingResult, incomingResult] = await Promise.all([
    supabase
      .from("collection_items")
      .select(`
        id,user_id,card_id,holder_id,quantity,condition,foil,created_at,
        card:card_catalog(id,oracle_id,name,set_code,set_name,collector_number,image_url,type_line,colors,color_identity,cmc,legalities),
        holder:holders(id,user_id,name,type,format,notes,created_at)
      `)
      .order("created_at", { ascending: false }),
    supabase
      .from("card_transactions")
      .select("id,source_item_id,recipient_user_id,quantity,status")
      .eq("owner_id", userId)
      .eq("transaction_type", "loan")
      .in("status", ["active", "return_pending"]),
    supabase
      .from("card_transactions")
      .select(`
        id,owner_id,recipient_user_id,source_item_id,card_id,quantity,condition,foil,status,created_at,
        card:card_catalog(id,oracle_id,name,set_code,set_name,collector_number,image_url,type_line,colors,color_identity,cmc,legalities)
      `)
      .eq("recipient_user_id", userId)
      .eq("transaction_type", "loan")
      .in("status", ["active", "return_pending"]),
  ])

  if (ownedResult.error) throw ownedResult.error
  if (outgoingResult.error) throw outgoingResult.error
  if (incomingResult.error) throw incomingResult.error

  const owned = (ownedResult.data ?? []).map(normalizeCardRelation)
  const outgoing = outgoingResult.data ?? []
  const incoming = incomingResult.data ?? []

  const friendIds = Array.from(new Set([
    ...outgoing.map((row: any) => row.recipient_user_id).filter(Boolean),
    ...incoming.map((row: any) => row.owner_id).filter(Boolean),
  ]))

  let profileMap = new Map<string, string | null>()
  if (friendIds.length) {
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("user_id,username")
      .in("user_id", friendIds)
    if (error) throw error
    profileMap = new Map((profiles ?? []).map((row: any) => [row.user_id, row.username]))
  }

  const outgoingByItem = new Map<number, any[]>()
  for (const tx of outgoing as any[]) {
    if (!tx.source_item_id) continue
    const bucket = outgoingByItem.get(tx.source_item_id) ?? []
    bucket.push(tx)
    outgoingByItem.set(tx.source_item_id, bucket)
  }

  for (const item of owned) {
    const loans = outgoingByItem.get(item.id) ?? []
    if (!loans.length) continue
    item.loan_role = "lender"
    item.lent_quantity = loans.reduce((sum, tx) => sum + Number(tx.quantity || 0), 0)
    item.loan_friend_ids = Array.from(new Set(loans.map((tx) => tx.recipient_user_id).filter(Boolean)))
    item.loan_friend_id = item.loan_friend_ids[0] ?? null
    item.loan_friend_username = item.loan_friend_id ? profileMap.get(item.loan_friend_id) ?? null : null
  }

  const borrowed: CollectionItem[] = (incoming as any[]).map((tx) => {
    const card = Array.isArray(tx.card) ? tx.card[0] : tx.card
    return {
      id: Number(tx.source_item_id ?? -tx.id),
      user_id: tx.owner_id,
      card_id: tx.card_id,
      holder_id: null,
      quantity: Number(tx.quantity),
      condition: tx.condition ?? "NM",
      foil: Boolean(tx.foil),
      created_at: tx.created_at,
      card,
      holder: null,
      loan_role: "borrower",
      loan_transaction_id: tx.id,
      loan_status: tx.status,
      loan_friend_id: tx.owner_id,
      loan_friend_username: profileMap.get(tx.owner_id) ?? null,
      loan_friend_ids: [tx.owner_id],
      lent_quantity: 0,
    }
  })

  return [...borrowed, ...owned]
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
    color_identity: card.color_identity ?? cardColors(card),
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

  query = args.holder_id === null ? query.is("holder_id", null) : query.eq("holder_id", args.holder_id)
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
  const { error } = await supabase.from("collection_items").update(patch).eq("id", id)
  if (error) throw error
}

export async function deleteCollectionItem(id: number): Promise<void> {
  const { error } = await supabase.from("collection_items").delete().eq("id", id)
  if (error) throw error
}

export async function moveCollectionQuantity(itemId: number, quantity: number, holderId: number | null): Promise<void> {
  const { error } = await supabase.rpc("move_collection_quantity", {
    p_item_id: itemId,
    p_quantity: quantity,
    p_holder_id: holderId,
  })
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

  const ids = (rows ?? []).map((row: any) => row.user_a === userId ? row.user_b : row.user_a)
  if (!ids.length) return []

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("user_id,username")
    .in("user_id", ids)
  if (profileError) throw profileError
  return (profiles ?? []) as Friend[]
}

export async function fetchContacts(): Promise<Contact[]> {
  const { data, error } = await supabase.from("contacts").select("*").order("name")
  if (error) throw error
  return (data ?? []) as Contact[]
}

export async function createContact(name: string, phone = "", notes = ""): Promise<Contact> {
  const user_id = await getCurrentUserId()
  const { data, error } = await supabase
    .from("contacts")
    .insert({ user_id, name: name.trim(), phone: phone.trim() || null, notes: notes.trim() || null })
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

export async function respondFriendRequest(friendshipId: number, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc("respond_friend_request", {
    p_friendship_id: friendshipId,
    p_accept: accept,
  })
  if (error) throw error
}

export async function fetchLendableInventory() {
  const userId = await getCurrentUserId()
  const [itemsResult, txResult] = await Promise.all([
    supabase.from("collection_items").select(`
      id,card_id,quantity,condition,foil,holder_id,
      card:card_catalog(name,image_url),
      holder:holders(name,type)
    `).eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("card_transactions")
      .select("source_item_id,quantity,status")
      .eq("owner_id", userId)
      .in("status", ["pending", "active", "return_pending"]),
  ])

  if (itemsResult.error) throw itemsResult.error
  if (txResult.error) throw txResult.error

  const reserved = new Map<number, number>()
  for (const tx of txResult.data ?? []) {
    if (!tx.source_item_id) continue
    reserved.set(tx.source_item_id, (reserved.get(tx.source_item_id) ?? 0) + Number(tx.quantity || 0))
  }

  return (itemsResult.data ?? []).map((row: any) => ({
    ...row,
    card: Array.isArray(row.card) ? row.card[0] : row.card,
    holder: Array.isArray(row.holder) ? row.holder[0] ?? null : row.holder ?? null,
    available_quantity: Math.max(0, Number(row.quantity) - (reserved.get(row.id) ?? 0)),
  })).filter((row: any) => row.available_quantity > 0)
}

export async function createUserTransaction(args: {
  recipientUserId: string
  sourceItemId: number
  transactionType: TransactionType
  quantity: number
  pricePerCard?: number | null
}): Promise<void> {
  const { error } = await supabase.rpc("create_user_transaction", {
    p_recipient_user_id: args.recipientUserId,
    p_source_item_id: args.sourceItemId,
    p_transaction_type: args.transactionType,
    p_quantity: args.quantity,
    p_price_per_card: args.pricePerCard ?? null,
  })
  if (error) throw error
}

export async function createContactTransaction(args: {
  contactId: number
  sourceItemId: number
  transactionType: TransactionType
  quantity: number
  pricePerCard?: number | null
}): Promise<void> {
  const { error } = await supabase.rpc("create_contact_transaction", {
    p_contact_id: args.contactId,
    p_source_item_id: args.sourceItemId,
    p_transaction_type: args.transactionType,
    p_quantity: args.quantity,
    p_price_per_card: args.pricePerCard ?? null,
  })
  if (error) throw error
}

export async function respondUserTransaction(transactionId: number, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc("respond_user_transaction", {
    p_transaction_id: transactionId,
    p_accept: accept,
  })
  if (error) throw error
}

export async function requestLoanReturn(transactionId: number): Promise<void> {
  const { error } = await supabase.rpc("request_loan_return", { p_transaction_id: transactionId })
  if (error) throw error
}

export async function respondLoanReturn(transactionId: number, confirm: boolean): Promise<void> {
  const { error } = await supabase.rpc("respond_loan_return", {
    p_transaction_id: transactionId,
    p_confirm: confirm,
  })
  if (error) throw error
}

export async function fetchNotifications(): Promise<NotificationItem[]> {
  const userId = await getCurrentUserId()

  const [friendResult, incomingTxResult, returnResult] = await Promise.all([
    supabase
      .from("friendships")
      .select("id,user_a,user_b,requested_by,created_at")
      .eq("status", "pending")
      .or(`user_a.eq.${userId},user_b.eq.${userId}`),
    supabase
      .from("card_transactions")
      .select("id,owner_id,recipient_user_id,card_id,transaction_type,quantity,price_per_card,created_at")
      .eq("recipient_user_id", userId)
      .eq("status", "pending"),
    supabase
      .from("card_transactions")
      .select("id,owner_id,recipient_user_id,card_id,quantity,price_per_card,created_at")
      .eq("owner_id", userId)
      .eq("transaction_type", "loan")
      .eq("status", "return_pending"),
  ])

  if (friendResult.error) throw friendResult.error
  if (incomingTxResult.error) throw incomingTxResult.error
  if (returnResult.error) throw returnResult.error

  const friendRows = (friendResult.data ?? []).filter((row: any) => row.requested_by !== userId)
  const txRows = incomingTxResult.data ?? []
  const returnRows = returnResult.data ?? []

  const profileIds = Array.from(new Set([
    ...friendRows.map((row: any) => row.requested_by),
    ...txRows.map((row: any) => row.owner_id),
    ...returnRows.map((row: any) => row.recipient_user_id),
  ].filter(Boolean)))
  const cardIds = Array.from(new Set([
    ...txRows.map((row: any) => row.card_id),
    ...returnRows.map((row: any) => row.card_id),
  ].filter(Boolean)))

  const [profilesResult, cardsResult] = await Promise.all([
    profileIds.length
      ? supabase.from("profiles").select("user_id,username").in("user_id", profileIds)
      : Promise.resolve({ data: [], error: null } as any),
    cardIds.length
      ? supabase.from("card_catalog").select("id,name").in("id", cardIds)
      : Promise.resolve({ data: [], error: null } as any),
  ])

  if (profilesResult.error) throw profilesResult.error
  if (cardsResult.error) throw cardsResult.error

  const profiles = new Map<string, string | null>(
    (profilesResult.data ?? []).map((row: any) => [
      String(row.user_id),
      row.username == null ? null : String(row.username),
    ]),
  )
  const cards = new Map<string, string>(
    (cardsResult.data ?? []).map((row: any) => [
      String(row.id),
      row.name == null ? "Unknown card" : String(row.name),
    ]),
  )

  const notifications: NotificationItem[] = [
    ...friendRows.map((row: any) => ({
      kind: "friend" as const,
      id: row.id,
      from_user_id: row.requested_by,
      from_username: profiles.get(row.requested_by) ?? null,
      created_at: row.created_at,
    })),
    ...txRows.map((row: any) => ({
      kind: row.transaction_type as "loan" | "sale",
      id: row.id,
      owner_id: row.owner_id,
      other_user_id: row.owner_id,
      other_username: profiles.get(row.owner_id) ?? null,
      card_name: cards.get(row.card_id) ?? "Unknown card",
      quantity: Number(row.quantity),
      price_per_card: row.price_per_card == null ? null : Number(row.price_per_card),
      created_at: row.created_at,
    })),
    ...returnRows.map((row: any) => ({
      kind: "return" as const,
      id: row.id,
      owner_id: row.owner_id,
      other_user_id: row.recipient_user_id,
      other_username: profiles.get(row.recipient_user_id) ?? null,
      card_name: cards.get(row.card_id) ?? "Unknown card",
      quantity: Number(row.quantity),
      price_per_card: null,
      created_at: row.created_at,
    })),
  ]

  return notifications.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
}

export async function fetchTransactionHistory(): Promise<TransactionHistoryItem[]> {
  const userId = await getCurrentUserId()
  const { data, error } = await supabase
    .from("card_transactions")
    .select(`
      id,owner_id,recipient_user_id,transaction_type,quantity,status,created_at,completed_at,
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


export async function fetchPendingOutgoing(): Promise<PendingItem[]> {
  const userId = await getCurrentUserId()

  const [friendResult, txResult] = await Promise.all([
    supabase
      .from("friendships")
      .select("id,user_a,user_b,requested_by,created_at")
      .eq("requested_by", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("card_transactions")
      .select(`
        id,recipient_user_id,card_id,transaction_type,quantity,created_at,
        card:card_catalog(name)
      `)
      .eq("owner_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ])

  if (friendResult.error) throw friendResult.error
  if (txResult.error) throw txResult.error

  const targetIds = Array.from(
    new Set(
      (friendResult.data ?? [])
        .map((row: any) => (row.user_a === userId ? row.user_b : row.user_a))
        .concat((txResult.data ?? []).map((row: any) => row.recipient_user_id))
        .filter(Boolean),
    ),
  )

  let profileMap = new Map<string, string | null>()
  if (targetIds.length) {
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("user_id,username")
      .in("user_id", targetIds)
    if (error) throw error
    profileMap = new Map<string, string | null>(
      (profiles ?? []).map((row: any) => [
        String(row.user_id),
        row.username == null ? null : String(row.username),
      ]),
    )
  }

  const friendItems: PendingItem[] = (friendResult.data ?? []).map((row: any) => {
    const targetId = row.user_a === userId ? row.user_b : row.user_a
    return {
      kind: "friend",
      id: Number(row.id),
      label: `Friend request to ${profileMap.get(targetId) ?? "user"}`,
      detail: "Waiting for acceptance",
      created_at: row.created_at,
    }
  })

  const txItems: PendingItem[] = (txResult.data ?? []).map((row: any) => {
    const card = Array.isArray(row.card) ? row.card[0] : row.card
    const recipient = profileMap.get(row.recipient_user_id) ?? "user"
    return {
      kind: "transaction",
      id: Number(row.id),
      label: `${row.transaction_type === "loan" ? "Loan" : "Sale"} · ${card?.name ?? "Unknown card"}`,
      detail: `${Number(row.quantity)} card(s) to ${recipient}`,
      created_at: row.created_at,
    }
  })

  return [...friendItems, ...txItems].sort(
    (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
  )
}

export async function deletePending(item: PendingItem): Promise<void> {
  const { error } = await supabase.rpc("delete_pending_request", {
    p_kind: item.kind,
    p_id: item.id,
  })
  if (error) throw error
}


export async function deleteDeck(deckId: number): Promise<void> {
  const { error } = await supabase.rpc("delete_deck_safe", {
    p_deck_id: deckId,
  })
  if (error) throw error
}


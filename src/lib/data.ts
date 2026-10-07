import { supabase } from "./supabase"
import type {
  BorrowableItem,
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
    loan_recipient_names: [],
    active_loans: [],
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
      .select("id,source_item_id,recipient_user_id,recipient_contact_id,quantity,status")
      .eq("owner_id", userId)
      .eq("transaction_type", "loan")
      .in("status", ["active", "return_pending"]),
    supabase
      .from("card_transactions")
      .select(`
        id,owner_id,recipient_user_id,source_item_id,card_id,quantity,condition,foil,status,borrower_holder_id,created_at,
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

  const contactIds = Array.from(new Set(
    outgoing
      .map((row: any) => row.recipient_contact_id)
      .filter(Boolean),
  ))

  let profileMap = new Map<string, string | null>()
  if (friendIds.length) {
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("user_id,username")
      .in("user_id", friendIds)
    if (error) throw error
    profileMap = new Map(
      (profiles ?? []).map((row: any) => [
        String(row.user_id),
        row.username == null ? null : String(row.username),
      ]),
    )
  }

  let contactMap = new Map<number, string>()
  if (contactIds.length) {
    const { data: contacts, error } = await supabase
      .from("contacts")
      .select("id,name")
      .in("id", contactIds)
    if (error) throw error
    contactMap = new Map(
      (contacts ?? []).map((row: any) => [
        Number(row.id),
        String(row.name ?? "Contact"),
      ]),
    )
  }

  const borrowedHolderIds = Array.from(
    new Set(
      incoming
        .map((row: any) => row.borrower_holder_id)
        .filter(Boolean)
        .map((value: any) => Number(value)),
    ),
  )

  let borrowedHolderMap = new Map<number, Holder>()
  if (borrowedHolderIds.length) {
    const { data: borrowedHolders, error } = await supabase
      .from("holders")
      .select("*")
      .eq("user_id", userId)
      .in("id", borrowedHolderIds)

    if (error) throw error
    borrowedHolderMap = new Map(
      (borrowedHolders ?? []).map((holder: any) => [
        Number(holder.id),
        holder as Holder,
      ]),
    )
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
    item.lent_quantity = loans.reduce(
      (sum, tx) => sum + Number(tx.quantity || 0),
      0,
    )

    item.loan_friend_ids = Array.from(
      new Set(loans.map((tx) => tx.recipient_user_id).filter(Boolean)),
    )

    item.active_loans = loans.map((tx) => {
      const isContact = Boolean(tx.recipient_contact_id)
      const recipientName = isContact
        ? contactMap.get(Number(tx.recipient_contact_id)) ?? "Contact"
        : profileMap.get(String(tx.recipient_user_id)) ?? "User"

      return {
        transaction_id: Number(tx.id),
        recipient_kind: isContact ? "contact" : "user",
        recipient_name: recipientName,
        quantity: Number(tx.quantity || 0),
        status: tx.status,
      }
    })

    item.loan_recipient_names = Array.from(
      new Set(item.active_loans.map((loan) => loan.recipient_name)),
    )

    item.loan_friend_id = item.loan_friend_ids[0] ?? null
    item.loan_friend_username =
      item.loan_recipient_names[0] ?? null
  }

  const borrowed: CollectionItem[] = (incoming as any[]).map((tx) => {
    const card = Array.isArray(tx.card) ? tx.card[0] : tx.card
    const borrowerHolderId = tx.borrower_holder_id == null
      ? null
      : Number(tx.borrower_holder_id)

    return {
      id: Number(tx.source_item_id ?? -tx.id),
      user_id: userId,
      card_id: tx.card_id,
      holder_id: borrowerHolderId,
      quantity: Number(tx.quantity),
      condition: tx.condition ?? "NM",
      foil: Boolean(tx.foil),
      created_at: tx.created_at,
      card,
      holder: borrowerHolderId
        ? borrowedHolderMap.get(borrowerHolderId) ?? null
        : null,
      loan_role: "borrower",
      loan_transaction_id: tx.id,
      loan_status: tx.status,
      loan_friend_id: tx.owner_id,
      loan_friend_username: profileMap.get(tx.owner_id) ?? null,
      loan_friend_ids: [tx.owner_id],
      loan_recipient_names: [],
      active_loans: [],
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

export async function moveBorrowedLoan(transactionId: number, holderId: number | null): Promise<void> {
  const { error } = await supabase.rpc("move_borrowed_loan", {
    p_transaction_id: transactionId,
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

  const [friendResult, pendingTxResult, returnResult, missingBorrowResult] = await Promise.all([
    supabase
      .from("friendships")
      .select("id,user_a,user_b,requested_by,created_at")
      .eq("status", "pending")
      .or(`user_a.eq.${userId},user_b.eq.${userId}`),
    supabase
      .from("card_transactions")
      .select("id,owner_id,recipient_user_id,requested_by,card_id,transaction_type,quantity,price_per_card,created_at")
      .eq("status", "pending")
      .or(`owner_id.eq.${userId},recipient_user_id.eq.${userId}`),
    supabase
      .from("card_transactions")
      .select("id,owner_id,recipient_user_id,card_id,quantity,price_per_card,created_at")
      .eq("owner_id", userId)
      .eq("transaction_type", "loan")
      .eq("status", "return_pending"),
    supabase
      .from("borrow_card_requests")
      .select("id,owner_user_id,requester_user_id,card_id,quantity,created_at")
      .eq("owner_user_id", userId)
      .eq("status", "pending"),
  ])

  if (friendResult.error) throw friendResult.error
  if (pendingTxResult.error) throw pendingTxResult.error
  if (returnResult.error) throw returnResult.error
  if (missingBorrowResult.error) throw missingBorrowResult.error

  const friendRows = (friendResult.data ?? []).filter((row: any) => row.requested_by !== userId)
  const txRows = (pendingTxResult.data ?? []).filter((row: any) => row.requested_by !== userId)
  const returnRows = returnResult.data ?? []
  const missingBorrowRows = missingBorrowResult.data ?? []

  const profileIds = Array.from(new Set([
    ...friendRows.map((row: any) => row.requested_by),
    ...txRows.map((row: any) => row.requested_by),
    ...returnRows.map((row: any) => row.recipient_user_id),
    ...missingBorrowRows.map((row: any) => row.requester_user_id),
  ].filter(Boolean)))

  const cardIds = Array.from(new Set([
    ...txRows.map((row: any) => row.card_id),
    ...returnRows.map((row: any) => row.card_id),
    ...missingBorrowRows.map((row: any) => row.card_id),
  ].filter(Boolean)))

  const [profilesResult, cardsResult] = await Promise.all([
    profileIds.length
      ? supabase.from("profiles").select("user_id,username").in("user_id", profileIds)
      : Promise.resolve({ data: [], error: null } as any),
    cardIds.length
      ? supabase.from("card_catalog").select("id,name,image_url").in("id", cardIds)
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
  const cardImages = new Map<string, string | null>(
    (cardsResult.data ?? []).map((row: any) => [
      String(row.id),
      row.image_url == null ? null : String(row.image_url),
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
      other_user_id: row.requested_by,
      other_username: profiles.get(row.requested_by) ?? null,
      card_name: cards.get(row.card_id) ?? "Unknown card",
      quantity: Number(row.quantity),
      price_per_card: row.price_per_card == null ? null : Number(row.price_per_card),
      created_at: row.created_at,
      request_kind:
        row.transaction_type === "sale"
          ? "sale" as const
          : row.requested_by === row.recipient_user_id
            ? "borrow" as const
            : "lend" as const,
    })),
    ...missingBorrowRows.map((row: any) => ({
      kind: "missing_borrow" as const,
      id: Number(row.id),
      requester_user_id: String(row.requester_user_id),
      requester_username: profiles.get(String(row.requester_user_id)) ?? null,
      card_name: cards.get(String(row.card_id)) ?? "Unknown card",
      image_url: cardImages.get(String(row.card_id)) ?? null,
      quantity: Number(row.quantity),
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

  const [friendResult, txResult, missingResult] = await Promise.all([
    supabase
      .from("friendships")
      .select("id,user_a,user_b,requested_by,created_at")
      .eq("requested_by", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("card_transactions")
      .select(`
        id,owner_id,recipient_user_id,requested_by,card_id,transaction_type,quantity,created_at,
        card:card_catalog(name)
      `)
      .eq("requested_by", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("borrow_card_requests")
      .select(`
        id,owner_user_id,requester_user_id,card_id,quantity,created_at,
        card:card_catalog(name)
      `)
      .eq("requester_user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ])

  if (friendResult.error) throw friendResult.error
  if (txResult.error) throw txResult.error
  if (missingResult.error) throw missingResult.error

  const txTargets = (txResult.data ?? []).map((row: any) =>
    row.owner_id === userId ? row.recipient_user_id : row.owner_id,
  )

  const targetIds = Array.from(
    new Set(
      (friendResult.data ?? [])
        .map((row: any) => (row.user_a === userId ? row.user_b : row.user_a))
        .concat(txTargets)
        .concat((missingResult.data ?? []).map((row: any) => row.owner_user_id))
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
    const targetId = row.owner_id === userId ? row.recipient_user_id : row.owner_id
    const target = profileMap.get(targetId) ?? "user"
    const isBorrowRequest = row.transaction_type === "loan" && row.owner_id !== userId

    return {
      kind: "transaction",
      id: Number(row.id),
      label: `${isBorrowRequest ? "Borrow request" : row.transaction_type === "loan" ? "Loan" : "Sale"} · ${card?.name ?? "Unknown card"}`,
      detail: isBorrowRequest
        ? `${Number(row.quantity)} card(s) requested from ${target}`
        : `${Number(row.quantity)} card(s) to ${target}`,
      created_at: row.created_at,
    }
  })

  const missingItems: PendingItem[] = (missingResult.data ?? []).map((row: any) => {
    const card = Array.isArray(row.card) ? row.card[0] : row.card
    const target = profileMap.get(String(row.owner_user_id)) ?? "user"
    return {
      kind: "missing_borrow" as const,
      id: Number(row.id),
      label: `Missing card request · ${card?.name ?? "Unknown card"}`,
      detail: `${Number(row.quantity)} card(s) requested from ${target}`,
      created_at: row.created_at,
    }
  })

  return [...friendItems, ...txItems, ...missingItems].sort(
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


export async function deleteHolder(holderId: number): Promise<void> {
  const { error } = await supabase.rpc("delete_holder_safe", {
    p_holder_id: holderId,
  })
  if (error) throw error
}

// Backwards-compatible helper for older callers.
export async function deleteDeck(deckId: number): Promise<void> {
  await deleteHolder(deckId)
}



export async function completeContactLoan(transactionId: number): Promise<void> {
  const { error } = await supabase.rpc("complete_contact_loan", {
    p_transaction_id: transactionId,
  })
  if (error) throw error
}


export async function fetchFriendBorrowableInventory(friendUserId: string): Promise<BorrowableItem[]> {
  const { data, error } = await supabase.rpc("fetch_friend_borrowable_inventory", {
    p_friend_user_id: friendUserId,
  })
  if (error) throw error

  return (data ?? []).map((row: any) => ({
    source_item_id: Number(row.source_item_id),
    card_id: String(row.card_id),
    card_name: String(row.card_name ?? "Unknown card"),
    image_url: row.image_url ?? null,
    holder_name: row.holder_name ?? null,
    holder_type: row.holder_type ?? null,
    quantity: Number(row.quantity),
    available_quantity: Number(row.available_quantity),
    condition: row.condition,
    foil: Boolean(row.foil),
  })) as BorrowableItem[]
}

export async function requestBorrowFromFriend(args: {
  ownerUserId: string
  sourceItemId: number
  quantity: number
}): Promise<void> {
  const { error } = await supabase.rpc("request_borrow_from_friend", {
    p_owner_user_id: args.ownerUserId,
    p_source_item_id: args.sourceItemId,
    p_quantity: args.quantity,
  })
  if (error) throw error
}

export async function migrateContactToUser(contactId: number, targetUserId: string): Promise<number> {
  const { data, error } = await supabase.rpc("migrate_contact_to_user", {
    p_contact_id: contactId,
    p_target_user_id: targetUserId,
  })
  if (error) throw error
  return Number(data ?? 0)
}


export async function requestMissingBorrowCard(args: {
  ownerUserId: string
  card: ScryfallCard
  quantity: number
}): Promise<void> {
  const saved = await saveCatalogCard(args.card)
  const { error } = await supabase.rpc("request_missing_borrow_card", {
    p_owner_user_id: args.ownerUserId,
    p_card_id: saved.id,
    p_quantity: Math.max(1, args.quantity),
  })
  if (error) throw error
}

export async function respondMissingBorrowRequest(requestId: number, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc("respond_missing_borrow_request", {
    p_request_id: requestId,
    p_accept: accept,
  })
  if (error) throw error
}

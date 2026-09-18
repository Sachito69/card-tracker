export type HolderType = "deck" | "binder" | "box"
export type FriendshipStatus = "pending" | "accepted"
export type TransactionType = "loan" | "sale"
export type TransactionStatus = "pending" | "active" | "declined" | "completed" | "cancelled"

export type Holder = {
  id: number
  user_id: string
  name: string
  type: HolderType
  notes: string | null
  created_at: string
}

export type Profile = {
  user_id: string
  username: string | null
}

export type Friend = {
  user_id: string
  username: string | null
}

export type Contact = {
  id: number
  user_id: string
  name: string
  phone: string | null
  notes: string | null
  created_at: string
}

export type CardCatalog = {
  id: string
  oracle_id: string | null
  name: string
  set_code: string | null
  set_name: string | null
  collector_number: string | null
  image_url: string | null
  type_line: string | null
  colors: string[]
  cmc: number | null
  legalities: Record<string, string>
}

export type CollectionItem = {
  id: number
  user_id: string
  card_id: string
  holder_id: number | null
  quantity: number
  condition: "NM" | "LP" | "MP" | "HP" | "DMG"
  foil: boolean
  created_at: string
  card: CardCatalog
  holder: Holder | null
}

export type TransactionHistoryItem = {
  id: number
  transaction_type: "loan" | "sale"
  quantity: number
  status: string
  created_at: string
  completed_at: string | null
  card_name: string
}

export type HolderType = "deck" | "binder" | "box"
export type TransactionType = "loan" | "sale"
export type TransactionStatus = "pending" | "active" | "return_pending" | "declined" | "completed" | "cancelled"

export type Holder = {
  id: number
  user_id: string
  name: string
  type: HolderType
  format: string | null
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
  color_identity: string[]
  cmc: number | null
  legalities: Record<string, string>
}


export type ActiveLoanDetail = {
  transaction_id: number
  recipient_kind: "user" | "contact"
  recipient_name: string
  quantity: number
  status: TransactionStatus
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
  loan_role?: "lender" | "borrower" | null
  loan_transaction_id?: number | null
  loan_status?: TransactionStatus | null
  loan_friend_id?: string | null
  loan_friend_username?: string | null
  loan_friend_ids?: string[]
  loan_recipient_names?: string[]
  active_loans?: ActiveLoanDetail[]
  lent_quantity?: number
  reserved_quantity?: number
}

export type DecklistEntry = {
  id: number
  holder_id: number
  card_id: string
  identity_key: string
  desired_quantity: number
  card: CardCatalog
}
export type TargetInput = { card_id: string; desired_quantity: number }
export type FillAllocation = { kind: "owned" | "borrowed"; source_id: number; quantity: number }
export type DeckProgressRow = { entry: DecklistEntry; placed: number; borrowed: number; missing: number; available: number }
export type DeckProgress = { planned: number; placed: number; missing: number; borrowed: number; rows: DeckProgressRow[]; extras: Array<{ item: CollectionItem; quantity: number }> }
export type UndoPlacement = {
  user_id: string
  kind: "owned" | "borrowed"
  source_id: number
  original_holder: number | null
  expected_holder: number | null
  quantity: number
  condition: string
  foil: boolean
  card_id: string
}

export type FriendRequestNotification = {
  kind: "friend"
  id: number
  from_user_id: string
  from_username: string | null
  created_at: string
}

export type TransactionNotification = {
  kind: "loan" | "sale" | "return"
  id: number
  owner_id: string
  other_user_id: string
  other_username: string | null
  card_name: string
  quantity: number
  price_per_card: number | null
  created_at: string
  request_kind?: "borrow" | "lend" | "sale"
}


export type MissingBorrowNotification = {
  kind: "missing_borrow"
  id: number
  requester_user_id: string
  requester_username: string | null
  card_name: string
  image_url: string | null
  quantity: number
  created_at: string
}

export type BorrowableItem = {
  source_item_id: number
  card_id: string
  card_name: string
  image_url: string | null
  holder_name: string | null
  holder_type: HolderType | null
  quantity: number
  available_quantity: number
  condition: CollectionItem["condition"]
  foil: boolean
}

export type NotificationItem = FriendRequestNotification | TransactionNotification | MissingBorrowNotification

export type TransactionHistoryItem = {
  id: number
  transaction_type: TransactionType
  quantity: number
  status: TransactionStatus
  created_at: string
  completed_at: string | null
  card_name: string
  owner_name: string
  recipient_name: string
}

export type PendingItem =
  | {
      kind: "friend"
      id: number
      label: string
      detail: string
      created_at: string
    }
  | {
      kind: "transaction"
      id: number
      label: string
      detail: string
      created_at: string
    }
  | {
      kind: "missing_borrow"
      id: number
      label: string
      detail: string
      created_at: string
    }



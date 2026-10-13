import { supabase } from "./supabase"
import { getCurrentUserId } from "./data"
import type { CollectionItem, UndoPlacement } from "./types"

export async function moveCard(item:CollectionItem,quantity:number,holderId:number|null):Promise<UndoPlacement|null> {
  const borrowed=item.loan_role==="borrower"
  const {data,error}=await supabase.rpc(borrowed?"move_borrowed_with_undo":"move_card_with_undo",borrowed
    ? {p_transaction_id:item.loan_transaction_id,p_holder_id:holderId}
    : {p_item_id:item.id,p_quantity:quantity,p_holder_id:holderId})
  if(error) throw error
  return data as UndoPlacement|null
}
export async function undoPlacement(change:UndoPlacement):Promise<void> {
  if(await getCurrentUserId()!==change.user_id) throw new Error("This move belongs to another account.")
  const {error}=await supabase.rpc("undo_card_placement",{p_change:change})
  if(error) throw error
}

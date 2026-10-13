import { useState } from "react"
import { useMutation,useQueryClient } from "@tanstack/react-query"
import { moveCard,undoPlacement } from "../lib/placement"
import type { CollectionItem,Holder } from "../lib/types"
import { ModalFrame } from "./ModalFrame"
import { useFeedback } from "./Feedback"
export function MoveCardModal({item,holders,items=[],onClose,onDone=onClose}:{item:CollectionItem;holders:Holder[];items?:CollectionItem[];onClose:()=>void;onDone?:()=>void}) {
  const qc=useQueryClient(),{toast,confirm}=useFeedback(),borrowed=item.loan_role==="borrower"
  const [quantity,setQuantity]=useState(item.quantity),[destination,setDestination]=useState("")
  const refresh=()=>Promise.all(["collection","holders","decklist","lendable-inventory","history"].map(key=>qc.invalidateQueries({queryKey:[key]})))
  const move=useMutation({
    mutationFn:()=>moveCard(item,quantity,destination?Number(destination):null),
    onSuccess:async undo=>{
      await refresh()
      toast("Card moved","success",undo?{label:"Undo",run:async()=>{await undoPlacement(undo);await refresh()}}:undefined)
      onDone()
    },
  })
  const target=destination?Number(destination):null
  return <ModalFrame title={`Move · ${item.card.name}`} onClose={onClose} busy={move.isPending}>
    <p className="settingsHint">{borrowed?`All ${item.quantity} borrowed copies move together. Ownership stays with the lender.`:"Choose a destination and how many copies to move."}</p>
    {!borrowed&&<label>Quantity<input type="number" disabled={move.isPending} min={1} max={item.quantity} value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label>}
    <label>Destination<select disabled={move.isPending} value={destination} onChange={e=>setDestination(e.target.value)}>
      {item.holder_id!==null&&<option value="">Unsorted</option>}
      {item.holder_id===null&&<option value="" disabled>Choose a holder</option>}
      {(["deck","binder","box"] as const).map(type=><optgroup key={type} label={type==="deck"?"Decks":type==="binder"?"Binders":"Boxes"}>
        {holders.filter(h=>h.id!==item.holder_id&&h.user_id===item.user_id&&h.type===type).map(h=><option key={h.id} value={h.id}>{h.name}</option>)}
      </optgroup>)}
    </select></label>
    {move.error&&<p className="errorText" role="alert">{move.error.message}</p>}
    <button className="primaryButton" disabled={move.isPending||target===item.holder_id||!Number.isInteger(quantity)||quantity<1||quantity>item.quantity} onClick={async()=>{
      const merging=items.some(row=>row.loan_role!=="borrower"&&row.id!==item.id&&row.holder_id===target&&row.card_id===item.card_id&&row.condition===item.condition&&row.foil===item.foil&&row.is_missing===item.is_missing)
      if(!borrowed&&(quantity!==item.quantity||merging)&&!await confirm({title:"Move these copies?",description:`${quantity}× ${item.card.name} → ${holders.find(h=>h.id===target)?.name??"Unsorted"}. Partial moves and merged stacks cannot be undone.`,confirmLabel:"Move copies"}))return
      move.mutate()
    }}>{move.isPending?"Moving…":"Move cards"}</button>
  </ModalFrame>
}

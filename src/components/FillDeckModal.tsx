import { useState } from "react"
import { useMutation,useQueryClient } from "@tanstack/react-query"
import { calculateDeckProgress,eligibleFillSources } from "../lib/decklist"
import { fillDeckEntry } from "../lib/decklistData"
import type { CollectionItem,DecklistEntry,FillAllocation,Holder } from "../lib/types"
import { ModalFrame } from "./ModalFrame"
import { useFeedback } from "./Feedback"
export function FillDeckModal({deck,entry,items,onClose}:{deck:Holder;entry:DecklistEntry;items:CollectionItem[];holders?:Holder[];onClose:()=>void}) {
  const qc=useQueryClient(),{toast}=useFeedback()
  const missing=calculateDeckProgress([entry],items,deck.id).missing
  const sources=eligibleFillSources(entry,items).filter(item=>item.loan_role!=="borrower"||item.quantity<=missing)
  const key=(item:CollectionItem)=>`${item.loan_role==="borrower"?"borrowed":"owned"}:${item.loan_transaction_id??item.id}`
  const [amounts,setAmounts]=useState<Record<string,number>>(()=>{
    let left=missing; const result:Record<string,number>={}
    for(const item of sources){const n=item.loan_role==="borrower"?(item.quantity<=left?item.quantity:0):Math.min(left,item.quantity);result[key(item)]=n;left-=n}
    return result
  })
  const total=Object.values(amounts).reduce((n,q)=>n+q,0)
  const fill=useMutation({
    mutationFn:()=>fillDeckEntry(entry.id,sources.filter(item=>amounts[key(item)]>0).map(item=>({
      kind:item.loan_role==="borrower"?"borrowed":"owned",source_id:item.loan_role==="borrower"?item.loan_transaction_id!:item.id,quantity:amounts[key(item)],
    } as FillAllocation))),
    onSuccess:async()=>{await Promise.all([qc.invalidateQueries({queryKey:["collection"]}),qc.invalidateQueries({queryKey:["decklist"]}),qc.invalidateQueries({queryKey:["holders"]}),qc.invalidateQueries({queryKey:["lendable-inventory"]})]);toast("Missing copies filled");onClose()},
  })
  return <ModalFrame title={`Fill ${entry.card.name}`} onClose={onClose} busy={fill.isPending}>
    <p className="settingsHint">{missing} copies missing in {deck.name}. Choose copies from your collection.</p>
    {sources.map(item=><label className="fillSource" key={key(item)}>
      {item.card.image_url&&<img src={item.card.image_url} alt="" loading="lazy"/>}
      <span><strong>{item.holder? `${item.holder.type} - ${item.holder.name}`:"Unsorted"}</strong><small>{item.card.set_name} #{item.card.collector_number} · {item.condition}{item.foil?" · Foil":""}</small><small>{item.loan_role==="borrower"?`Borrowed · whole stack of ${item.quantity}`:`${item.quantity} available`}</small></span>
      {item.loan_role==="borrower"?<input type="checkbox" disabled={fill.isPending} checked={amounts[key(item)]>0} onChange={e=>setAmounts({...amounts,[key(item)]:e.target.checked?item.quantity:0})}/>:
        <input aria-label={`Copies from ${item.holder?.name??"Unsorted"}`} disabled={fill.isPending} type="number" min={0} max={Math.min(item.quantity,missing)} value={amounts[key(item)]??0} onChange={e=>setAmounts({...amounts,[key(item)]:Math.max(0,Number(e.target.value))})}/>}
    </label>)}
    {!sources.length&&<p>No available copies outside other decks.</p>}
    {fill.error&&<p className="errorText" role="alert">{fill.error.message}</p>}
    <button className="primaryButton" disabled={fill.isPending||total<1||total>missing||!Object.values(amounts).every(Number.isInteger)} onClick={()=>fill.mutate()}>{fill.isPending?"Filling…":`Move ${total} copies into deck`}</button>
  </ModalFrame>
}

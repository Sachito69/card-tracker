import { useState } from "react"
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query"
import { createContactTransaction,createUserTransaction,fetchContacts,fetchFriends,fetchLendableInventory } from "../lib/data"
import type { CollectionItem } from "../lib/types"
import { ModalFrame } from "./ModalFrame"
import { useFeedback } from "./Feedback"
export function LendCardModal({item,onClose,onDone=onClose}:{item:CollectionItem;onClose:()=>void;onDone?:()=>void}) {
  const qc=useQueryClient(),{toast,confirm}=useFeedback()
  const friends=useQuery({queryKey:["friends",item.user_id],queryFn:fetchFriends})
  const contacts=useQuery({queryKey:["contacts",item.user_id],queryFn:fetchContacts})
  const inventory=useQuery({queryKey:["lendable-inventory",item.user_id],queryFn:fetchLendableInventory})
  const row=inventory.data?.find(r=>r.id===item.id),available=Number(row?.available_quantity??0)
  const [recipient,setRecipient]=useState(""),[quantity,setQuantity]=useState(1)
  const lend=useMutation({
    mutationFn:()=>recipient.startsWith("contact:")?createContactTransaction({contactId:Number(recipient.slice(8)),sourceItemId:item.id,transactionType:"loan",quantity}):
      createUserTransaction({recipientUserId:recipient.slice(7),sourceItemId:item.id,transactionType:"loan",quantity}),
    onSuccess:async()=>{await Promise.all(["collection","holders","notifications","pending","lendable-inventory","history","decklist"].map(key=>qc.invalidateQueries({queryKey:[key]})));toast("Loan sent");onDone()},
  })
  const error=friends.error||contacts.error||inventory.error||lend.error
  return <ModalFrame title={`Lend · ${item.card.name}`} onClose={onClose} busy={lend.isPending}>
    {item.card.image_url&&<img className="actionCardPreview" src={item.card.image_url} alt={item.card.name}/>}
    <p className="settingsHint">{inventory.isLoading?"Checking available copies…":`${available} copies available · ${item.condition}${item.foil?" · Foil":""}`}</p>
    <label>Recipient<select value={recipient} disabled={lend.isPending} onChange={e=>setRecipient(e.target.value)}><option value="">Choose a person</option>
      <optgroup label="Friends">{friends.data?.map(f=><option key={f.user_id} value={`friend:${f.user_id}`}>{f.username??"Unnamed account"}</option>)}</optgroup>
      <optgroup label="Contacts">{contacts.data?.map(c=><option key={c.id} value={`contact:${c.id}`}>{c.name}</option>)}</optgroup>
    </select></label>
    <label>Quantity<input disabled={lend.isPending} type="number" min={1} max={available} value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label>
    {error&&<p className="errorText" role="alert">{error.message}</p>}
    <button className="primaryButton" disabled={lend.isPending||!recipient||!!friends.error||!!contacts.error||!!inventory.error||quantity<1||quantity>available||!Number.isInteger(quantity)} onClick={async()=>{
      if(!await confirm({title:"Lend these cards?",description:`${quantity}× ${item.card.name}. Friends accept the request; contact loans start immediately.`,confirmLabel:"Lend cards"}))return
      lend.mutate()
    }}>{lend.isPending?"Sending…":"Lend cards"}</button>
  </ModalFrame>
}

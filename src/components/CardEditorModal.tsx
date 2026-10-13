import { useState } from "react"
import { X } from "lucide-react"
import { useMutation,useQueryClient } from "@tanstack/react-query"
import { completeContactLoan,deleteCollectionItem,moveCollectionQuantity,requestLoanReturn,updateCollectionItem } from "../lib/data"
import type { CollectionItem,Holder } from "../lib/types"
import { useFeedback } from "./Feedback"
import { ModalFrame } from "./ModalFrame"
import { MoveCardModal } from "./MoveCardModal"
import { AcquireCardModal } from "./AcquireCardModal"
import { LendCardModal } from "./LendCardModal"

export function CardEditorModal({item,holders,items=[],onClose,panel=false}:{item:CollectionItem;holders:Holder[];items?:CollectionItem[];onClose:()=>void;panel?:boolean}) {
  const qc=useQueryClient(),{toast,confirm}=useFeedback()
  const [quantity,setQuantity]=useState(item.quantity),[condition,setCondition]=useState(item.condition),[foil,setFoil]=useState(item.foil)
  const [action,setAction]=useState<"move"|"lend"|"acquire"|null>(null)
  const borrowed=item.loan_role==="borrower",lent=(item.lent_quantity??0)>0
  const reserved=item.reserved_quantity??item.lent_quantity??0
  const placement=item.holder?`${item.holder.type} - ${item.holder.name}`:"Unsorted"
  const refresh=()=>Promise.all(["collection","holders","decklist","history","notifications","pending","lendable-inventory"].map(key=>qc.invalidateQueries({queryKey:[key]})))
  const save=useMutation({mutationFn:()=>updateCollectionItem(item.id,lent?{condition}:{quantity,condition,foil}),onSuccess:async()=>{await refresh();toast("Card details saved");onClose()}})
  const remove=useMutation({mutationFn:()=>item.holder_id!==null?moveCollectionQuantity(item.id,item.quantity,null):deleteCollectionItem(item.id),onSuccess:async()=>{await refresh();toast(item.holder_id!==null?"Card moved to Unsorted":"Card removed");onClose()}})
  const requestReturn=useMutation({mutationFn:()=>requestLoanReturn(item.loan_transaction_id!),onSuccess:async()=>{await refresh();toast("Return request sent");onClose()}})
  const contactReturn=useMutation({mutationFn:(id:number)=>completeContactLoan(id),onSuccess:async()=>{await refresh();toast("Card marked returned");onClose()}})
  if(action==="acquire")return <AcquireCardModal item={items.find(row=>row.id===item.id&&row.is_missing)??item} available={items.some(row=>row.id===item.id&&row.is_missing)} onClose={()=>setAction(null)} onDone={onClose}/>
  if(action==="move")return <MoveCardModal item={item} holders={holders} items={items} onClose={()=>setAction(null)} onDone={onClose}/>
  if(action==="lend")return <LendCardModal item={item} onClose={()=>setAction(null)} onDone={onClose}/>
  const body=<>
    <div className="editorSummary">{item.card.image_url&&<img src={item.card.image_url} alt={item.card.name}/>}<div><strong>{item.quantity}× {item.card.name}</strong><small>{item.card.set_name} #{item.card.collector_number}</small><span className="placementTag">{placement}</span><small>{borrowed?`Borrowed from ${item.loan_friend_username??"Unnamed account"}`:lent?`${item.lent_quantity}× lent`:item.is_missing?"Missing":"Owned by you"}</small></div></div>
    <div className="uxActionRow"><button className="secondaryButton" disabled={!borrowed&&reserved>0} onClick={()=>setAction("move")}>Move</button>
      {item.is_missing?<button className="primaryButton" onClick={()=>setAction("acquire")}>Mark acquired</button>:borrowed?<button className="primaryButton" disabled={item.loan_status==="return_pending"||requestReturn.isPending} onClick={()=>requestReturn.mutate()}>{item.loan_status==="return_pending"?"Waiting for confirmation":requestReturn.isPending?"Requesting…":"Request return"}</button>:<button className="secondaryButton" disabled={item.quantity-reserved<1} onClick={()=>setAction("lend")}>Lend</button>}
    </div>
    {!borrowed&&reserved>0&&<p className="settingsHint">Move is unavailable while this stack has pending or active transactions.</p>}
    {borrowed?<p className="settingsHint">{item.condition}{item.foil?" · Foil":""}. Quantity and printing stay with the lender.</p>:<>
      <div className="formGrid"><label>Quantity<input type="number" min={1} disabled={lent||save.isPending} value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label><label>Condition<select disabled={save.isPending} value={condition} onChange={e=>setCondition(e.target.value as CollectionItem["condition"])}>{["NM","LP","MP","HP","DMG"].map(c=><option key={c}>{c}</option>)}</select></label></div>
      <label className="checkRow"><input type="checkbox" checked={foil} disabled={lent||save.isPending} onChange={e=>setFoil(e.target.checked)}/> Foil</label>
      {lent&&<p className="settingsHint">Quantity, printing, and finish are locked until all loans are returned.</p>}
      {(item.active_loans??[]).map(loan=><div className="loanRecipientRow" key={loan.transaction_id}><div><span>{loan.recipient_name}</span><small>{loan.quantity}× on loan{loan.status==="return_pending"?" · Return pending":""}</small></div>{loan.recipient_kind==="contact"&&<button className="secondaryButton" disabled={contactReturn.isPending} onClick={async()=>{if(await confirm({title:"Mark loan returned?",description:`${loan.quantity}× ${item.card.name} from ${loan.recipient_name}.`,confirmLabel:"Mark returned"}))contactReturn.mutate(loan.transaction_id)}}>Mark returned</button>}</div>)}
      <div className="editorActions"><button className="dangerButton" disabled={reserved>0||remove.isPending||save.isPending} onClick={async()=>{if(await confirm({title:item.holder_id!==null?"Move to Unsorted?":"Remove card?",description:`${item.quantity}× ${item.card.name}.`,confirmLabel:item.holder_id!==null?"Move to Unsorted":"Remove card",tone:"danger"}))remove.mutate()}}>{remove.isPending?"Working…":item.holder_id!==null?"Remove from holder":"Remove"}</button><button className="primaryButton" disabled={save.isPending||remove.isPending||!Number.isInteger(quantity)||quantity<1} onClick={()=>save.mutate()}>{save.isPending?"Saving…":"Save details"}</button></div>
    </>}
    {[save.error,remove.error,requestReturn.error,contactReturn.error].filter(Boolean).map((error,i)=><p className="errorText" role="alert" key={i}>{error!.message}</p>)}
  </>
  if(panel)return <aside className="detailPanel" aria-label="Card details"><header className="modalHeader"><h2>{item.card.name}</h2><button className="iconButton" aria-label="Close card details" onClick={onClose}><X size={18}/></button></header><div className="modalBody">{body}</div></aside>
  return <ModalFrame title={item.card.name} onClose={onClose} busy={save.isPending||remove.isPending||requestReturn.isPending||contactReturn.isPending}>{body}</ModalFrame>
}

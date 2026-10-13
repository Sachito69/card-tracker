import {useState} from 'react'
import {useMutation,useQueryClient} from '@tanstack/react-query'
import {acquireMissingStack} from '../lib/data'
import type {CollectionItem} from '../lib/types'
import {ModalFrame} from './ModalFrame'
import {useFeedback} from './Feedback'
export function AcquireCardModal({item,onClose,onDone=onClose,available=true}:{item:CollectionItem;onClose:()=>void;onDone?:()=>void;available?:boolean}) {
 const [quantity,setQuantity]=useState(item.quantity),qc=useQueryClient(),{toast}=useFeedback()
 const acquire=useMutation({mutationFn:()=>{if(!available)throw new Error("This card is no longer missing.");return acquireMissingStack(item.id,quantity)},onSuccess:async()=>{await qc.invalidateQueries({queryKey:['collection']});toast(`${quantity} ${quantity===1?'copy':'copies'} marked acquired`);onDone()},onError:()=>{void qc.invalidateQueries({queryKey:['collection']})}})
 return <ModalFrame title={`Mark acquired · ${item.card.name}`} onClose={onClose} busy={acquire.isPending}>
  {available?<>
  <p>{item.quantity} missing · {item.card.set_name} #{item.card.collector_number}{item.foil?' · Foil':''}</p>
  <label>Copies acquired<input autoFocus type="number" min={1} max={item.quantity} value={quantity} disabled={acquire.isPending} onChange={e=>setQuantity(Number(e.target.value))}/></label>
  <p className="settingsHint">{Math.max(0,item.quantity-quantity)} will remain missing. Acquired copies stay in {item.holder?.name??'Unsorted'}.</p>
  </>:<p role="status">This card is no longer missing. Close this dialog to see your updated collection.</p>}
  {acquire.error&&<p className="errorText" role="alert">{acquire.error.message}</p>}
  <button className="primaryButton" disabled={!available||acquire.isPending||!Number.isInteger(quantity)||quantity<1||quantity>item.quantity} onClick={()=>acquire.mutate()}>{acquire.isPending?'Saving…':'Mark acquired'}</button>
 </ModalFrame>
}

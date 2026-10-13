import type {CollectionItem} from '../lib/types'
export function CardTextRow({item,onSelect,onAcquire}:{item:CollectionItem;onSelect:(item:CollectionItem)=>void;onAcquire:(item:CollectionItem)=>void}) {
 const placement=item.holder?`${item.holder.type[0].toUpperCase()+item.holder.type.slice(1)} - ${item.holder.name}`:'Unsorted'
 const status=item.is_missing?'Missing':item.loan_role==='borrower'?`Borrowed · ${item.loan_friend_username??'Unnamed account'}`:item.loan_role==='lender'?`${item.lent_quantity}× lent · ${(item.loan_recipient_names??[]).join(', ')}`:'Owned'
 return <div className={`inventoryTextRow ${item.is_missing?'missingCard':''}`}>
  <button className="inventoryTextDetails" onClick={()=>onSelect(item)} aria-label={`Edit ${item.card.name}`}>
   <span className="inventoryTextTitle"><strong className="inventoryQuantity">×{item.quantity}</strong><strong>{item.card.name}</strong></span>
   <span className="inventoryVersion">{item.card.set_name??'Unknown set'} · {(item.card.set_code??'').toUpperCase()} #{item.card.collector_number??'—'}{item.foil?' · Foil':''}</span>
   <span className="inventoryMetadata"><span>{item.condition}</span><span>{placement}</span><span className={item.is_missing?'missingStatus':''}>{status}</span></span>
  </button>
  {item.is_missing&&<button className="secondaryButton acquireButton" onClick={()=>onAcquire(item)}>Mark acquired</button>}
 </div>
}

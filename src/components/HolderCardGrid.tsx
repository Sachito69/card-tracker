import type { CollectionItem } from '../lib/types'
import {collectionItemKey} from '../lib/inventory'
export function HolderCardGrid({items,onSelect,onAcquire}:{items:CollectionItem[];onSelect:(item:CollectionItem)=>void;onAcquire:(item:CollectionItem)=>void}) {
 return <div className="cardGrid">{items.map(item=><div className={`cardTile ${item.is_missing?'missingCard':item.loan_role==='borrower'?'borrowedCard':item.loan_role==='lender'?'lentCard':''}`} key={collectionItemKey(item)}>
  <button className="cardTileMain" aria-label={`${item.quantity} copies of ${item.card.name}`} onClick={()=>onSelect(item)}>
   <div className="imageShell">{item.card.image_url?<img src={item.card.image_url} alt={item.card.name} loading="lazy"/>:<div className="noImage">{item.card.name}</div>}</div>
   <div className="cardInfo"><strong className="tileCardName">{item.card.name}</strong><div className="tileFacts"><span className="tileQuantity">×{item.quantity}</span><span className="tileCondition">{item.condition}{item.foil?' · Foil':''}</span></div>
    <span className="tilePlacement" title={item.holder?.name}>{item.holder?`${item.holder.type[0].toUpperCase()+item.holder.type.slice(1)} - ${item.holder.name}`:'Unsorted'}</span>
    <small className={`tileOwnership ${item.is_missing?'missingStatus':item.loan_role??'owned'}`}>{item.is_missing?'Missing':item.loan_role==='borrower'?`Borrowed · ${item.loan_friend_username??'Unnamed account'}`:item.loan_role==='lender'?`${item.lent_quantity}× lent · ${(item.loan_recipient_names??[]).join(', ')}`:'Owned'}</small></div>
  </button>{item.is_missing&&<button className="secondaryButton tileAcquire" onClick={()=>onAcquire(item)}>Mark acquired</button>}
 </div>)}</div>
}

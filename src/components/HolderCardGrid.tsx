import type { CollectionItem } from "../lib/types"
export function HolderCardGrid({items,onSelect}:{items:CollectionItem[];onSelect:(item:CollectionItem)=>void}) {
  return <div className="cardGrid">{items.map(item=><button className={`cardTile ${item.loan_role==="borrower"?"borrowedCard":item.loan_role==="lender"?"lentCard":""}`} key={`${item.loan_role}-${item.id}-${item.loan_transaction_id}`} aria-label={`${item.quantity} copies of ${item.card.name}`} onClick={()=>onSelect(item)}>
    <div className="imageShell">{item.card.image_url?<img src={item.card.image_url} alt={item.card.name} loading="lazy"/>:<div className="noImage">{item.card.name}</div>}</div>
    <div className="cardInfo"><strong className="tileCardName">{item.card.name}</strong><div className="tileFacts"><span className="tileQuantity">×{item.quantity}</span><span className="tileCondition">{item.condition}{item.foil?" · Foil":""}</span></div>
      <span className="tilePlacement" title={item.holder?.name}>{item.holder?`${item.holder.type} - ${item.holder.name}`:"Unsorted"}</span>
      <small className={`tileOwnership ${item.loan_role??"owned"}`}>{item.loan_role==="borrower"?`Borrowed · ${item.loan_friend_username??"Unnamed account"}`:item.loan_role==="lender"?`${item.lent_quantity}× lent`:"Owned"}</small></div>
  </button>)}</div>
}

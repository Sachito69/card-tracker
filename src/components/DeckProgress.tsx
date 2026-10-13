import { calculateDeckProgress,collectionItemKey } from "../lib/decklist"
import type { CollectionItem,DecklistEntry,Holder } from "../lib/types"
export function DeckProgress({deck,entries,items,onEdit,onFill,search="",matchesEntry=()=>true}:{deck:Holder;entries:DecklistEntry[];items:CollectionItem[];onEdit:()=>void;onFill:(row:DecklistEntry)=>void;search?:string;matchesEntry?:(entry:DecklistEntry)=>boolean}) {
  const progress=calculateDeckProgress(entries,items,deck.id)
  const rows=progress.rows.filter(row=>row.entry.card.name.toLowerCase().includes(search.trim().toLowerCase())&&matchesEntry(row.entry))
  return <section className="deckProgress">
    <div className="deckProgressHeading"><div><h2>Saved decklist</h2><p>{progress.planned ? `${progress.placed} / ${progress.planned} placed · ${progress.missing} missing`:"Set your target cards to track this deck."}{progress.borrowed>0&&` · ${progress.borrowed} borrowed`}</p></div>
      <button className="secondaryButton" onClick={onEdit}>{entries.length?"Edit decklist":"Set up decklist"}</button></div>
    {progress.planned>0&&<><progress value={progress.placed} max={progress.planned} aria-label="Deck assembly progress"/><div className="deckTargetList">
      {rows.map(({entry,placed,borrowed,missing,available})=><article className="deckTargetRow" key={entry.id}>
        {entry.card.image_url&&<img src={entry.card.image_url} alt="" loading="lazy"/>}
        <div><strong>{entry.card.name}</strong><small>{placed} / {entry.desired_quantity} placed{borrowed>0&&` · ${borrowed} borrowed`}</small><small>{missing? `${missing} missing · ${available} available elsewhere`:"Complete"}</small></div>
        {missing>0&&<button className="secondaryButton" disabled={available===0} onClick={()=>onFill(entry)}>Fill missing</button>}
      </article>)}
    </div></>}
    {progress.extras.length>0&&<details className="deckExtras"><summary>Extras · {progress.extras.reduce((sum,row)=>sum+row.quantity,0)} copies</summary>
      {progress.extras.map(({item,quantity})=><p key={collectionItemKey(item)}>{quantity}× {item.card.name}{item.loan_role==="borrower"?" · Borrowed":""}</p>)}</details>}
  </section>
}

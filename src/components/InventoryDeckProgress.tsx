import type {CollectionItem} from '../lib/types'
import {inventoryDeckProgress} from '../lib/inventory'
export function InventoryDeckProgress({items,holderId}:{items:CollectionItem[];holderId:number}) {
 const {present,missing,total,borrowed}=inventoryDeckProgress(items,holderId)
 return <section className="inventoryDeckProgress" aria-label="Deck progress"><div><strong>{present} / {total} present</strong><span>{missing} missing{borrowed?` · ${borrowed} borrowed`:''}</span></div><progress value={present} max={total||1} aria-label="Deck completion"/></section>
}

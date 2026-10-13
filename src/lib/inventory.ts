import type {CollectionItem} from './types'
export function isOwnedInventory(item:CollectionItem):boolean{return !item.is_missing&&item.loan_role!=='borrower'}
export function inventoryDeckProgress(items:CollectionItem[],holderId:number):{present:number;missing:number;total:number;borrowed:number} {
 let present=0,missing=0,borrowed=0
 for(const item of items.filter(row=>row.holder_id===holderId)){
  if(item.is_missing){missing+=item.quantity;continue}
  const available=Math.max(0,item.quantity-(item.lent_quantity??0));present+=available
  if(item.loan_role==='borrower')borrowed+=available
 }
 return {present,missing,total:present+missing,borrowed}
}
export function collectionItemKey(item:CollectionItem):string{return `${item.loan_role??'owned'}:${item.id}:${item.loan_transaction_id??0}`}

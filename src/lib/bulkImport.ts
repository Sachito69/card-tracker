import type { ScryfallCard } from './scryfall'
export type BulkInput={raw:string;quantity:number;name:string;setCode?:string;collectorNumber?:string;foil:boolean}
export function parseBulkInput(raw:string):{input:BulkInput|null;error:string|null} {
 const fail=(error:string)=>({input:null,error})
 const match=raw.trim().match(/^(\d+)\s*[xX]?\s+(.+)$/)
 if(!match||!Number.isSafeInteger(Number(match[1]))||Number(match[1])<1||Number(match[1])>2147483647)return fail('Use a positive whole-number quantity followed by a card name.')
 let name=match[2].trim(),foil=false,setCode:string|undefined,collectorNumber:string|undefined
 if(/\s+\*F\*$/i.test(name)){foil=true;name=name.replace(/\s+\*F\*$/i,'').trim()}
 if(/\*[^*]*\*/.test(name))return fail('Use *F* for foil; other finish markers are unsupported.')
 const metadata=name.match(/\s+\(([A-Za-z0-9]{2,8})\)(?:\s+([0-9][A-Za-z0-9★†-]*))?$/)
 if(metadata){setCode=metadata[1].toLowerCase();collectorNumber=metadata[2];name=name.slice(0,metadata.index).trim()}
 else if(/\s+\d+[A-Za-z★†-]*$/.test(name))return fail('A collector number requires a set code in parentheses.')
 if(!name)return fail('Card name is required.')
 return {input:{raw,quantity:Number(match[1]),name,...(setCode?{setCode}:{}),...(collectorNumber?{collectorNumber}:{}),foil},error:null}
}
export function selectBulkPrinting(input:BulkInput,printings:ScryfallCard[]):ScryfallCard {
 const normalize=(name:string)=>name.trim().replace(/\s*\/\/\s*/g,' // ').toLowerCase()
 const names=printings.filter(card=>normalize(card.name)===normalize(input.name)||card.name.split(' // ').some(face=>normalize(face)===normalize(input.name)))
 if(!names.length)throw new Error('Exact card name not found.')
 const versions=names.filter(card=>(!input.setCode||card.set.toLowerCase()===input.setCode)&&(!input.collectorNumber||card.collector_number.toLowerCase()===input.collectorNumber.toLowerCase()))
 if(!versions.length)throw new Error('Requested printing not found. Check the set code and collector number.')
 const finish=input.foil?'foil':'nonfoil'
 // Scryfall always supplies finishes. Missing metadata is not evidence of availability.
 const compatible=versions.filter(card=>card.finishes?.includes(finish))
 if(!compatible.length)throw new Error(`Requested ${finish} finish is unavailable for this printing.`)
 return compatible[0]
}

// Match successful occurrences independently of line position. Extra identical
// occurrences remain new requests, so deliberate repeated input still works.
export function retainAddedBulkRows<T extends {raw:string;id:number;status:string}>(rows:T[],added:T[]):T[] {
 const key=(raw:string)=>raw.trim().replace(/\s+/g,' ').toLowerCase()
 const successes=new Map<string,T[]>()
 for(const row of added.filter(row=>row.status==='added')){
  const bucket=successes.get(key(row.raw))??[];bucket.push(row);successes.set(key(row.raw),bucket)
 }
 return rows.map(row=>{
  const prior=successes.get(key(row.raw))?.shift()
  return prior?{...prior,id:row.id,raw:row.raw}:row
 })
}

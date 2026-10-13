import { useEffect,useRef,useState } from "react"
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query"
import { cardIdentity,parseDecklist } from "../lib/decklist"
import { fetchDecklist,replaceDecklist } from "../lib/decklistData"
import { saveCatalogCard } from "../lib/data"
import { cardColors,cardImage,searchCards,searchPrintings,type ScryfallCard } from "../lib/scryfall"
import type { CardCatalog,CollectionItem,Holder } from "../lib/types"
import { ModalFrame } from "./ModalFrame"
import { useFeedback } from "./Feedback"
type Draft={name:string;quantity:number;card:CardCatalog|null;printing?:ScryfallCard;error?:string}
function asCatalog(c:ScryfallCard):CardCatalog {
  return {id:c.id,oracle_id:c.oracle_id??null,name:c.name,set_code:c.set,set_name:c.set_name,
    collector_number:c.collector_number,image_url:cardImage(c),type_line:c.type_line??null,
    colors:cardColors(c),color_identity:c.color_identity??cardColors(c),cmc:c.cmc??null,legalities:c.legalities??{}}
}
export function DecklistEditorModal({deck,items,onClose}:{deck:Holder;items:CollectionItem[];onClose:()=>void}) {
  const qc=useQueryClient(),{toast,confirm}=useFeedback()
  const list=useQuery({queryKey:["decklist",deck.user_id,deck.id],queryFn:()=>fetchDecklist(deck.id)})
  const [draft,setDraft]=useState<Draft[]>([]),[paste,setPaste]=useState(""),[query,setQuery]=useState("")
  const [results,setResults]=useState<ScryfallCard[]>([]),[working,setWorking]=useState(false),[error,setError]=useState("")
  const initialized=useRef(false)
  useEffect(()=>{if(list.data&&!initialized.current){initialized.current=true;setDraft(list.data.map(entry=>({name:entry.card.name,quantity:entry.desired_quantity,card:entry.card}))) }},[list.data])
  useEffect(()=>{
    let stale=false
    if(query.trim().length<2){setResults([]);return}
    const timer=setTimeout(async()=>{try{const rows=await searchCards(query);if(!stale)setResults(rows)}catch(e){if(!stale)setError(e instanceof Error?e.message:"Search failed")}},300)
    return ()=>{stale=true;clearTimeout(timer)}
  },[query])
  const add=(row:Draft)=>setDraft(current=>{
    const index=row.card?current.findIndex(r=>r.card&&cardIdentity(r.card)===cardIdentity(row.card!)):-1
    return index<0?[...current,row]:current.map((r,i)=>i===index?{...r,quantity:r.quantity+row.quantity}:r)
  })
  async function importList(){
    setError("");const parsed=parseDecklist(paste)
    if(parsed.errors.length){setError(parsed.errors.map(e=>`Line ${e.line}: ${e.message}`).join(" "));return}
    setWorking(true)
    const rows:Draft[]=[]
    try {
      for(const line of parsed.lines){
        try{const card=(await searchPrintings(line.name))[0];if(!card)throw Error("Card not found")
          rows.push({name:card.name,quantity:line.quantity,card:asCatalog(card),printing:card})
        }catch(e){rows.push({name:line.name,quantity:line.quantity,card:null,error:e instanceof Error?e.message:"Card not found"})}
        await new Promise(resolve=>setTimeout(resolve,100))
      }
      setDraft(rows)
    }finally{setWorking(false)}
  }
  async function resolveRow(index:number){
    setWorking(true);setError("")
    try{const card=(await searchPrintings(draft[index].name))[0];if(!card)throw Error("Card not found")
      setDraft(rows=>rows.map((row,i)=>i===index?{...row,name:card.name,card:asCatalog(card),printing:card,error:undefined}:row))
    }catch(e){setError(e instanceof Error?e.message:"Could not resolve name")}finally{setWorking(false)}
  }
  function snapshot(){
    const rows=new Map<string,Draft>()
    for(const item of items.filter(item=>item.holder_id===deck.id)){
      const quantity=Math.max(0,item.quantity-(item.lent_quantity??0));if(!quantity)continue
      const key=cardIdentity(item.card),prev=rows.get(key)
      rows.set(key,{name:item.card.name,card:item.card,quantity:(prev?.quantity??0)+quantity})
    }
    setDraft([...rows.values()]);setError("")
  }
  const save=useMutation({
    mutationFn:async()=>{
      if(draft.some(row=>!row.card||!Number.isInteger(row.quantity)||row.quantity<1))throw Error("Resolve all names and use positive whole-number quantities.")
      for(const row of draft)if(row.printing)await saveCatalogCard(row.printing)
      await replaceDecklist(deck.id,draft.map(row=>({card_id:row.card!.id,desired_quantity:row.quantity})))
    },
    onSuccess:async()=>{await qc.invalidateQueries({queryKey:["decklist"]});toast("Saved target decklist");onClose()},
  })
  const busy=working||save.isPending
  return <ModalFrame title={`Decklist · ${deck.name}`} onClose={onClose} busy={busy} wide>
    <p className="settingsHint">Plan copies here, then fill them from your collection. Editing the plan does not change physical cards.</p>
    {list.isLoading&&<p>Loading decklist…</p>}{list.error&&<p className="errorText">{list.error.message}</p>}
    <label>Paste decklist<textarea className="bulkTextarea" disabled={busy||list.isLoading} value={paste} onChange={e=>setPaste(e.target.value)} placeholder={"4 Counterspell\n1 Sol Ring"}/></label>
    <div className="uxActionRow"><button className="secondaryButton" disabled={busy||list.isLoading||!paste.trim()} onClick={()=>void importList()}>{working?"Resolving…":"Review pasted list"}</button>
      <button className="secondaryButton" disabled={busy||list.isLoading} onClick={snapshot}>Use current deck cards</button></div>
    <label>Find a planned card<input disabled={busy||list.isLoading} value={query} onChange={e=>{setQuery(e.target.value);setResults([])}} placeholder="Search card names…"/></label>
    <div className="decklistSearchResults">{results.map(c=><button className="cardSearchResult" key={c.id} disabled={busy} onClick={()=>{add({name:c.name,quantity:1,card:asCatalog(c),printing:c});setQuery("");setResults([])}}>
      {cardImage(c)&&<img src={cardImage(c)!} alt="" width={36}/>}<strong>{c.name}</strong><span>Add to plan</span></button>)}</div>
    <div className="decklistDraft">{draft.map((row,index)=><div className="decklistDraftRow" key={index}>
      {row.card?.image_url&&<img src={row.card.image_url} alt="" loading="lazy"/>}
      <div>{row.card?<strong>{row.name}</strong>:<><input aria-label={`Correct card name ${index+1}`} disabled={busy} value={row.name} onChange={e=>setDraft(rows=>rows.map((r,i)=>i===index?{...r,name:e.target.value}:r))}/><small className="errorText">Unresolved name</small><button className="textButton" disabled={busy} onClick={()=>void resolveRow(index)}>Resolve name</button></>}</div>
      <input aria-label={`Target copies of ${row.name}`} disabled={busy} type="number" min={1} value={row.quantity} onChange={e=>setDraft(rows=>rows.map((r,i)=>i===index?{...r,quantity:Number(e.target.value)}:r))}/>
      <button className="textButton" disabled={busy} aria-label={`Remove ${row.name} from plan`} onClick={()=>setDraft(rows=>rows.filter((_,i)=>i!==index))}>Remove</button>
    </div>)}</div>
    {(error||save.error)&&<p className="errorText" role="alert">{error||save.error?.message}</p>}
    <button className="primaryButton" disabled={busy||list.isLoading||!!list.error||draft.some(r=>!r.card||!Number.isInteger(r.quantity)||r.quantity<1)} onClick={async()=>{
      if(!draft.length&&list.data?.length&&!await confirm({title:"Clear saved decklist?",description:"Physical cards stay in this deck.",confirmLabel:"Clear plan"}))return
      save.mutate()
    }}>{save.isPending?"Saving…":`Save plan · ${draft.reduce((n,r)=>n+(r.quantity||0),0)} copies`}</button>
  </ModalFrame>
}

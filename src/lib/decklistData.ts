import { supabase } from "./supabase"
import type { DecklistEntry, FillAllocation, TargetInput } from "./types"

export async function fetchDecklist(deckId: number): Promise<DecklistEntry[]> {
  const {data,error}=await supabase.from("decklist_entries")
    .select("*,card:card_catalog(*)").eq("holder_id",deckId).order("id")
  if(error) throw error
  return (data??[]).map(row=>({...row,card:Array.isArray(row.card)?row.card[0]:row.card})) as DecklistEntry[]
}
export async function replaceDecklist(deckId:number,entries:TargetInput[]):Promise<void> {
  const {error}=await supabase.rpc("replace_decklist",{p_deck_id:deckId,p_entries:entries})
  if(error) throw error
}
export async function fillDeckEntry(entryId:number,allocations:FillAllocation[]):Promise<void> {
  const {error}=await supabase.rpc("fill_deck_entry",{p_entry_id:entryId,p_allocations:allocations})
  if(error) throw error
}

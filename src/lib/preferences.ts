import type { TrackerFilters } from "../components/FilterModal"
export type Ownership = "all" | "owned" | "borrowed" | "lent" | "unsorted"
export type TrackerPreferences = { ownership: Ownership; view: "images" | "text"; sort: "name" | "newest" | "quantity"; filters: TrackerFilters; desktopPanel: boolean }
const defaults = ():TrackerPreferences=>({ownership:"all",view:"images",sort:"name",filters:{colors:[],commanderColors:[],cardType:"",manaValue:"",deckFormat:""},desktopPanel:false})
export function loadPreferences(userId:string,context:string):TrackerPreferences {
  const fallback=defaults()
  if(context.includes(":")) fallback.view="text"
  try {
    const p=JSON.parse(localStorage.getItem(`tracker-preferences:${userId}:${context}`)??"{}")
    if(!p||typeof p!=="object") return fallback
    const colors=(v:unknown)=>Array.isArray(v)?v.filter((c):c is string=>typeof c==="string"&&["W","U","B","R","G","C"].includes(c)):[]
    return {
      ownership:["all","owned","borrowed","lent","unsorted"].includes(p.ownership)?p.ownership:"all",
      view:p.view==="text"?"text":p.view==="images"?"images":fallback.view,
      sort:["name","newest","quantity"].includes(p.sort)?p.sort:"name",
      desktopPanel:p.desktopPanel===true,
      filters:{...fallback.filters,
        colors:colors(p.filters?.colors),commanderColors:colors(p.filters?.commanderColors),
        cardType:typeof p.filters?.cardType==="string"?p.filters.cardType:"",
        manaValue:typeof p.filters?.manaValue==="string"?p.filters.manaValue:"",
        deckFormat:typeof p.filters?.deckFormat==="string"?p.filters.deckFormat:"",
      },
    }
  } catch { return fallback }
}
export function savePreferences(userId:string,context:string,value:TrackerPreferences):void {
  try { localStorage.setItem(`tracker-preferences:${userId}:${context}`,JSON.stringify(value)) } catch { /* Storage can be disabled. */ }
}

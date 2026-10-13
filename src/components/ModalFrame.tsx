import { useEffect, useRef, type ReactNode } from "react"
import { X } from "lucide-react"
export function ModalFrame({title,onClose,busy=false,children,wide=false}:{title:string;onClose:()=>void;busy?:boolean;children:ReactNode;wide?:boolean}) {
  const ref=useRef<HTMLElement>(null)
  const current=useRef({onClose,busy}); current.current={onClose,busy}
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null
    const node=ref.current
    node?.querySelector<HTMLElement>('input,select,button')?.focus()
    const key=(event:KeyboardEvent)=>{
      if(document.querySelector(".confirmDialog"))return
      if(event.key==="Escape"&&!current.current.busy) {event.preventDefault();current.current.onClose()}
      if(event.key!=="Tab"||!node) return
      const controls=[...node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')]
        .filter(el=>el.getClientRects().length>0)
      const first=controls[0],last=controls.at(-1)
      if(event.shiftKey&&document.activeElement===first) {event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&document.activeElement===last) {event.preventDefault();first?.focus()}
    }
    document.addEventListener("keydown",key)
    return ()=>{document.removeEventListener("keydown",key);previous?.focus()}
  },[])
  return <div className="modalBackdrop" onMouseDown={()=>{if(!busy)onClose()}}>
    <section ref={ref} className={`modal ${wide?"uxWideModal":"smallModal"}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={e=>e.stopPropagation()}>
      <header className="modalHeader"><h2>{title}</h2><button className="iconButton" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={18}/></button></header>
      <div className="modalBody">{children}</div>
    </section>
  </div>
}

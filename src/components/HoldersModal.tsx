import { useState } from "react"
import { Plus, X } from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createHolder } from "../lib/data"
import type { Holder, HolderType } from "../lib/types"

type Props = {
  holders: Holder[]
  onClose: () => void
}

export function HoldersModal({ holders, onClose }: Props) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [type, setType] = useState<HolderType>("deck")
  const [notes, setNotes] = useState("")

  const create = useMutation({
    mutationFn: () => createHolder(name, type, notes),
    onSuccess: async () => {
      setName("")
      setNotes("")
      await queryClient.invalidateQueries({ queryKey: ["holders"] })
    },
  })

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2>Holders</h2>
            <p>Decks and people are both places your cards can be.</p>
          </div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modalBody">
          <div className="holderCreate">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Holder name" />
            <select value={type} onChange={(e) => setType(e.target.value as HolderType)}>
              <option value="deck">Deck</option>
              <option value="binder">Binder</option>
              <option value="box">Box</option>
            </select>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
            <button className="primaryButton" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
              <Plus size={15} /> Add
            </button>
          </div>

          <div className="holderSections">
            <div>
              <h3>Decks</h3>
              {holders.filter((h) => h.type === "deck").map((holder) => (
                <div className="holderRow" key={holder.id}>
                  <strong>{holder.name}</strong>
                  <small>{holder.notes || "Deck"}</small>
                </div>
              ))}
            </div>

            <div>
              <h3>Binders & Boxes</h3>
              {holders.filter((h) => h.type === "binder" || h.type === "box").map((holder) => (
                <div className="holderRow" key={holder.id}>
                  <strong>{holder.name}</strong>
                  <small>{holder.notes || holder.type}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

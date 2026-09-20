import { useState } from "react"
import { X } from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createHolder } from "../lib/data"
import { DECK_FORMATS } from "../lib/formats"
import type { HolderType } from "../lib/types"

type Props = {
  type: HolderType
  onClose: () => void
}

const labels: Record<HolderType, string> = {
  deck: "Deck",
  binder: "Binder",
  box: "Box",
}

export function HolderCreateModal({ type, onClose }: Props) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [notes, setNotes] = useState("")
  const [format, setFormat] = useState("Commander")

  const create = useMutation({
    mutationFn: () => createHolder(name, type, notes, type === "deck" ? format : null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["holders"] })
      onClose()
    },
  })

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal smallModal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2>Add {labels[type]}</h2>
            <p>{labels[type]}s are local holders. Cards can move in and out freely.</p>
          </div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modalBody">
          <label>
            Name
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={`${labels[type]} name`}
            />
          </label>

          {type === "deck" && (
            <label>
              Format
              <select value={format} onChange={(event) => setFormat(event.target.value)}>
                {DECK_FORMATS.map((value) => (
                  <option value={value} key={value}>{value}</option>
                ))}
              </select>
            </label>
          )}

          <label>
            Notes <span className="mutedInline">optional</span>
            <input value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>

          {create.error && <p className="errorText">{create.error.message}</p>}

          <button
            className="primaryButton"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Creating..." : `Create ${labels[type].toLowerCase()}`}
          </button>
        </div>
      </section>
    </div>
  )
}

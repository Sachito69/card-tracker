import { useState } from "react"
import { X } from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createContact } from "../lib/data"

export function CreateContactModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [notes, setNotes] = useState("")

  const create = useMutation({
    mutationFn: () => createContact(name, phone, notes),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["contacts"] })
      onClose()
    },
  })

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal smallModal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div><h2>Create non-user</h2><p>Local contact for someone without an account.</p></div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="modalBody">
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label>
          <label>Phone / contact<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          <label>Notes<textarea className="bulkTextarea contactNotes" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          {create.error && <p className="errorText">{create.error.message}</p>}
          <button className="primaryButton" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating..." : "Create contact"}</button>
        </div>
      </section>
    </div>
  )
}

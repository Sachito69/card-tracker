import { useMemo, useState } from "react"
import { X } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createContactTransaction, createUserTransaction, fetchLendableInventory } from "../lib/data"
import type { Contact, Friend, TransactionType } from "../lib/types"

type Recipient = { kind: "friend"; value: Friend } | { kind: "contact"; value: Contact }

export function TransactionModal({ recipient, type, onClose }: { recipient: Recipient; type: TransactionType; onClose: () => void }) {
  const qc = useQueryClient()
  const inventory = useQuery({ queryKey: ["lendable-inventory"], queryFn: fetchLendableInventory })
  const [itemId, setItemId] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [price, setPrice] = useState("")
  const selected = useMemo(() => inventory.data?.find((item: any) => item.id === Number(itemId)), [inventory.data, itemId])

  const send = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Choose a card.")
      const qty = Math.max(1, Math.min(quantity, selected.available_quantity))
      const pricePerCard = type === "sale" && price !== "" ? Number(price) : null
      if (recipient.kind === "friend") {
        await createUserTransaction({ recipientUserId: recipient.value.user_id, sourceItemId: selected.id, transactionType: type, quantity: qty, pricePerCard })
      } else {
        await createContactTransaction({ contactId: recipient.value.id, sourceItemId: selected.id, transactionType: type, quantity: qty, pricePerCard })
      }
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["collection"] }),
        qc.invalidateQueries({ queryKey: ["history"] }),
        qc.invalidateQueries({ queryKey: ["notifications"] }),
      ])
      onClose()
    },
  })

  const name = recipient.kind === "friend" ? `@${recipient.value.username ?? "user"}` : recipient.value.name

  return (
    <div className="modalBackdrop nestedModal" onMouseDown={onClose}>
      <section className="modal smallModal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div><h2>{type === "loan" ? "Lend" : "Sell"} to {name}</h2><p>{recipient.kind === "friend" ? "They must accept the request first." : "Non-user transactions are confirmed locally."}</p></div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="modalBody">
          <label>Card<select value={itemId} onChange={(event) => { setItemId(event.target.value); setQuantity(1) }}><option value="">Choose card...</option>{(inventory.data ?? []).map((item: any) => <option key={item.id} value={item.id}>{item.card?.name} · {item.available_quantity} available · {item.holder?.name ?? "My Collection"}</option>)}</select></label>
          <label>Quantity<input type="number" min="1" max={selected?.available_quantity ?? 1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
          {type === "sale" && <label>Price per card<input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="0.00" /></label>}
          {send.error && <p className="errorText">{send.error.message}</p>}
          <button className="primaryButton" disabled={!selected || send.isPending} onClick={() => send.mutate()}>{send.isPending ? "Sending..." : recipient.kind === "friend" ? "Send request" : type === "loan" ? "Record loan" : "Record sale"}</button>
        </div>
      </section>
    </div>
  )
}

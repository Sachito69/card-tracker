import { useMemo, useState } from "react"
import { CornerUpLeft, MoveRight, Trash2, X } from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { deleteCollectionItem, moveCollectionQuantity, requestLoanReturn, updateCollectionItem } from "../lib/data"
import type { CollectionItem, Holder } from "../lib/types"

export function CardEditorModal({ item, holders, onClose }: { item: CollectionItem; holders: Holder[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [quantity, setQuantity] = useState(item.quantity)
  const [condition, setCondition] = useState(item.condition)
  const [foil, setFoil] = useState(item.foil)
  const [moveQty, setMoveQty] = useState(1)
  const [moveHolderId, setMoveHolderId] = useState("")

  const isBorrowed = item.loan_role === "borrower"
  const isLent = item.loan_role === "lender" && (item.lent_quantity ?? 0) > 0
  const holderGroups = useMemo(() => ({
    deck: holders.filter((holder) => holder.type === "deck"),
    binder: holders.filter((holder) => holder.type === "binder"),
    box: holders.filter((holder) => holder.type === "box"),
  }), [holders])

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["collection"] }),
      qc.invalidateQueries({ queryKey: ["history"] }),
      qc.invalidateQueries({ queryKey: ["notifications"] }),
      qc.invalidateQueries({ queryKey: ["lendable-inventory"] }),
    ])
  }

  const save = useMutation({
    mutationFn: () => updateCollectionItem(item.id, { quantity: Math.max(isLent ? (item.lent_quantity ?? 1) : 1, quantity), condition, foil }),
    onSuccess: async () => { await refresh(); onClose() },
  })

  const remove = useMutation({
    mutationFn: () => deleteCollectionItem(item.id),
    onSuccess: async () => { await refresh(); onClose() },
  })

  const move = useMutation({
    mutationFn: () => moveCollectionQuantity(item.id, Math.max(1, Math.min(moveQty, item.quantity)), moveHolderId ? Number(moveHolderId) : null),
    onSuccess: async () => { await refresh(); onClose() },
  })

  const requestReturn = useMutation({
    mutationFn: () => requestLoanReturn(item.loan_transaction_id!),
    onSuccess: async () => { await refresh(); onClose() },
  })

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal smallModal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2>{item.card.name}</h2>
            <p>{isBorrowed ? `Borrowed from @${item.loan_friend_username ?? "user"}` : isLent ? `Lent ${item.lent_quantity}× to @${item.loan_friend_username ?? "friend"}` : item.card.set_name}</p>
          </div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modalBody">
          {isBorrowed ? (
            <>
              <div className="borrowedSummary">
                <strong>{item.quantity}× {item.card.name}</strong>
                <small>{item.condition}{item.foil ? " · Foil" : ""}</small>
                <small>Status: {item.loan_status === "return_pending" ? "Return waiting for lender confirmation" : "On loan to you"}</small>
              </div>
              <button className="primaryButton" disabled={item.loan_status === "return_pending" || requestReturn.isPending} onClick={() => requestReturn.mutate()}>
                <CornerUpLeft size={15} /> {item.loan_status === "return_pending" ? "Return requested" : "Return card"}
              </button>
            </>
          ) : (
            <>
              <div className="formGrid">
                <label>Quantity<input type="number" min={isLent ? Math.max(1, item.lent_quantity ?? 1) : 1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
                <label>Condition<select value={condition} onChange={(event) => setCondition(event.target.value as CollectionItem["condition"])}><option>NM</option><option>LP</option><option>MP</option><option>HP</option><option>DMG</option></select></label>
              </div>
              <label className="checkRow"><input type="checkbox" checked={foil} onChange={(event) => setFoil(event.target.checked)} /> Foil</label>

              {isLent ? (
                <div className="lockedMove"><strong>Move unavailable</strong><small>This stack currently has lent cards. Return them before moving the stack.</small></div>
              ) : (
                <div className="movePanel">
                  <strong>Move cards</strong>
                  <div className="moveGrid">
                    <label>Quantity<input type="number" min="1" max={item.quantity} value={moveQty} onChange={(event) => setMoveQty(Number(event.target.value))} /></label>
                    <label>Destination<select value={moveHolderId} onChange={(event) => setMoveHolderId(event.target.value)}>
                      <option value="">My Collection</option>
                      <optgroup label="Decks">{holderGroups.deck.map((holder) => <option value={holder.id} key={holder.id}>{holder.name}</option>)}</optgroup>
                      <optgroup label="Binders">{holderGroups.binder.map((holder) => <option value={holder.id} key={holder.id}>{holder.name}</option>)}</optgroup>
                      <optgroup label="Boxes">{holderGroups.box.map((holder) => <option value={holder.id} key={holder.id}>{holder.name}</option>)}</optgroup>
                    </select></label>
                  </div>
                  <button className="secondaryButton" disabled={move.isPending} onClick={() => move.mutate()}><MoveRight size={15} /> {move.isPending ? "Moving..." : "Move"}</button>
                </div>
              )}

              {(save.error || remove.error || move.error) && <p className="errorText">{save.error?.message ?? remove.error?.message ?? move.error?.message}</p>}
              <div className="editorActions">
                <button className="dangerButton" disabled={isLent || remove.isPending} onClick={() => { if (confirm(`Remove ${item.card.name} from your tracker?`)) remove.mutate() }}><Trash2 size={15} /> Remove</button>
                <button className="primaryButton" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving..." : "Save details"}</button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

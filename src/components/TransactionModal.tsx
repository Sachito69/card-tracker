import { useMemo, useState } from "react"
import { Check, Minus, Plus, ShoppingCart, X } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createContactTransaction,
  createUserTransaction,
  fetchLendableInventory,
} from "../lib/data"
import type { Contact, Friend, TransactionType } from "../lib/types"

type Recipient =
  | { kind: "friend"; value: Friend }
  | { kind: "contact"; value: Contact }

type Cart = Record<number, number>

export function TransactionModal({
  recipient,
  type,
  onClose,
}: {
  recipient: Recipient
  type: TransactionType
  onClose: () => void
}) {
  const qc = useQueryClient()
  const inventory = useQuery({
    queryKey: ["lendable-inventory"],
    queryFn: fetchLendableInventory,
  })
  const [cart, setCart] = useState<Cart>({})
  const [price, setPrice] = useState("")

  const rows = inventory.data ?? []
  const selectedRows = useMemo(
    () => rows.filter((item: any) => cart[item.id]),
    [rows, cart],
  )
  const selectedCount = selectedRows.reduce(
    (sum: number, item: any) => sum + (cart[item.id] ?? 0),
    0,
  )

  function toggle(item: any) {
    setCart((current) => {
      const next = { ...current }
      if (next[item.id]) delete next[item.id]
      else next[item.id] = 1
      return next
    })
  }

  function setQuantity(item: any, quantity: number) {
    const nextQty = Math.max(1, Math.min(quantity, item.available_quantity))
    setCart((current) => ({ ...current, [item.id]: nextQty }))
  }

  const send = useMutation({
    mutationFn: async () => {
      if (!selectedRows.length) throw new Error("Choose at least one card.")

      const pricePerCard =
        type === "sale" && price !== "" ? Number(price) : null

      for (const item of selectedRows as any[]) {
        const quantity = cart[item.id] ?? 1

        if (recipient.kind === "friend") {
          await createUserTransaction({
            recipientUserId: recipient.value.user_id,
            sourceItemId: item.id,
            transactionType: type,
            quantity,
            pricePerCard,
          })
        } else {
          await createContactTransaction({
            contactId: recipient.value.id,
            sourceItemId: item.id,
            transactionType: type,
            quantity,
            pricePerCard,
          })
        }
      }
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["collection"] }),
        qc.invalidateQueries({ queryKey: ["holders"] }),
        qc.invalidateQueries({ queryKey: ["history"] }),
        qc.invalidateQueries({ queryKey: ["notifications"] }),
        qc.invalidateQueries({ queryKey: ["pending"] }),
        qc.invalidateQueries({ queryKey: ["lendable-inventory"] }),
      ])
      onClose()
    },
  })

  const name =
    recipient.kind === "friend"
      ? `${recipient.value.username ?? "user"}`
      : recipient.value.name

  return (
    <div className="modalBackdrop nestedModal" onMouseDown={onClose}>
      <section className="modal transactionModal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2>{type === "loan" ? "Lend" : "Sell"} to {name}</h2>
            <p>
              {recipient.kind === "friend"
                ? "Select cards like a cart. They must accept the request first."
                : "Select cards like a cart. Non-user transactions are recorded locally."}
            </p>
          </div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modalBody transactionBody">
          {inventory.isLoading ? (
            <p className="settingsHint">Loading available cards...</p>
          ) : !rows.length ? (
            <p className="settingsHint">No cards are currently available to {type === "loan" ? "lend" : "sell"}.</p>
          ) : (
            <div className="transactionCardGrid">
              {rows.map((item: any) => {
                const selected = Boolean(cart[item.id])
                return (
                  <button
                    className={`transactionCard ${selected ? "selected" : ""}`}
                    key={item.id}
                    onClick={() => toggle(item)}
                  >
                    <div className="transactionImageShell">
                      {item.card?.image_url ? (
                        <img src={item.card.image_url} alt={item.card?.name ?? ""} loading="lazy" decoding="async" />
                      ) : (
                        <div className="noImage">No image</div>
                      )}
                      {selected && <span className="cartCheck"><Check size={15} /></span>}
                    </div>
                    <strong>{item.card?.name ?? "Unknown card"}</strong>
                    <small>{item.available_quantity} available</small>
                    <small>{item.holder?.name ?? "My Collection"}</small>
                  </button>
                )
              })}
            </div>
          )}

          {selectedRows.length > 0 && (
            <section className="cartPanel">
              <div className="cartTitle">
                <ShoppingCart size={17} />
                <strong>Cart</strong>
                <span>{selectedCount} card(s)</span>
              </div>

              {selectedRows.map((item: any) => (
                <div className="cartRow" key={item.id}>
                  <span>{item.card?.name ?? "Unknown card"}</span>
                  <div className="qtyStepper">
                    <button onClick={() => setQuantity(item, (cart[item.id] ?? 1) - 1)}><Minus size={13} /></button>
                    <input
                      type="number"
                      min="1"
                      max={item.available_quantity}
                      value={cart[item.id] ?? 1}
                      onChange={(event) => setQuantity(item, Number(event.target.value))}
                    />
                    <button onClick={() => setQuantity(item, (cart[item.id] ?? 1) + 1)}><Plus size={13} /></button>
                  </div>
                  <button className="iconButton" onClick={() => toggle(item)}><X size={14} /></button>
                </div>
              ))}
            </section>
          )}

          {type === "sale" && (
            <label>
              Price per card <span className="mutedInline">applies to selected cards</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="0.00"
              />
            </label>
          )}

          <p className="settingsHint">
            Cards chosen from a deck, binder, or box are removed from that local holder when the request is created.
          </p>

          {send.error && <p className="errorText">{send.error.message}</p>}

          <button
            className="primaryButton"
            disabled={!selectedRows.length || send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending
              ? "Sending..."
              : recipient.kind === "friend"
                ? `Send ${selectedRows.length} request${selectedRows.length === 1 ? "" : "s"}`
                : type === "loan"
                  ? "Record loan"
                  : "Record sale"}
          </button>
        </div>
      </section>
    </div>
  )
}

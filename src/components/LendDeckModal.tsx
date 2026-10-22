import { useMemo, useState } from "react"
import { HandCoins, X } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchContacts, fetchFriends, fetchLendableInventory, lendDeck } from "../lib/data"
import type { Holder } from "../lib/types"
import { useFeedback } from "./Feedback"

export function LendDeckModal({ deck, onClose }: { deck: Holder; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useFeedback()
  const friends = useQuery({ queryKey: ["friends"], queryFn: fetchFriends })
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: fetchContacts })
  const inventory = useQuery({ queryKey: ["lendable-inventory"], queryFn: fetchLendableInventory })
  const [recipient, setRecipient] = useState("")
  const cards = useMemo(
    () => (inventory.data ?? []).filter((card) => Number(card.holder_id) === deck.id),
    [inventory.data, deck.id],
  )
  const total = cards.reduce((sum, row) => sum + Number(row.available_quantity), 0)
  const send = useMutation({
    mutationFn: async () => {
      if (!recipient) throw new Error("Choose a recipient")
      const [kind, id] = recipient.split(":")
      await lendDeck(deck.id, kind === "friend" ? id : null, kind === "contact" ? Number(id) : null)
    },
    onSuccess: async () => {
      toast("Deck lending requests created")
      await Promise.all(["collection", "holders", "notifications", "pending", "history", "lendable-inventory"].map(
        key => qc.invalidateQueries({ queryKey: [key] }),
      ))
      onClose()
    },
  })
  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal transactionModal" onMouseDown={e => e.stopPropagation()}>
        <header className="modalHeader">
          <div><h2>Lend deck · {deck.name}</h2><p>All available physical cards in this deck will be included.</p></div>
          <button className="iconButton" aria-label="Close" onClick={onClose}><X size={18}/></button>
        </header>
        <div className="modalBody transactionBody">
          <label>Recipient
            <select value={recipient} onChange={e => setRecipient(e.target.value)}>
              <option value="">Choose a friend or contact</option>
              <optgroup label="Registered friends">
                {(friends.data ?? []).map(f => <option key={f.user_id} value={`friend:${f.user_id}`}>{f.username ?? "User"}</option>)}
              </optgroup>
              <optgroup label="Non-user contacts">
                {(contacts.data ?? []).map(c => <option key={c.id} value={`contact:${c.id}`}>{c.name}</option>)}
              </optgroup>
            </select>
          </label>
          <strong>{cards.length} card entries · {total} cards available</strong>
          <div className="deckLoanPreview">
            {cards.map(card => <div key={card.id} className="deckLoanPreviewRow">
              {card.card?.image_url && <img src={card.card.image_url} alt="" loading="lazy"/>}
              <span>{card.card?.name ?? "Card"}</span><strong>×{card.available_quantity}</strong>
            </div>)}
          </div>
          <p className="settingsHint">Missing cards are excluded. Registered friends receive individual card requests to accept; non-user loans become active immediately. The deck itself remains yours.</p>
          {send.error && <p className="errorText">{send.error.message}</p>}
          <button className="primaryButton" disabled={!recipient || !cards.length || send.isPending || inventory.isLoading}
            onClick={() => send.mutate()}>
            <HandCoins size={16}/> {send.isPending ? "Sending..." : "Lend entire deck"}
          </button>
        </div>
      </section>
    </div>
  )
}

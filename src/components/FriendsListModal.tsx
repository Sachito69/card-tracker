import { useState } from "react"
import { HandCoins, ShoppingCart, X } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { fetchContacts, fetchFriends } from "../lib/data"
import type { Contact, Friend, TransactionType } from "../lib/types"
import { TransactionModal } from "./TransactionModal"

type Selected =
  | { recipient: { kind: "friend"; value: Friend }; type: TransactionType }
  | { recipient: { kind: "contact"; value: Contact }; type: TransactionType }
  | null

export function FriendsListModal({ onClose }: { onClose: () => void }) {
  const friends = useQuery({ queryKey: ["friends"], queryFn: fetchFriends, staleTime: 60_000 })
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: fetchContacts, staleTime: 60_000 })
  const [selected, setSelected] = useState<Selected>(null)

  return (
    <>
      <div className="modalBackdrop" onMouseDown={onClose}>
        <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
          <header className="modalHeader">
            <div><h2>Friends list</h2><p>Lend or sell cards to registered friends and local contacts.</p></div>
            <button className="iconButton" onClick={onClose}><X size={18} /></button>
          </header>
          <div className="modalBody">
            <h3>Registered friends</h3>
            {!friends.isLoading && !(friends.data ?? []).length && <p className="settingsHint">No accepted friends yet.</p>}
            {(friends.data ?? []).map((friend) => (
              <div className="personActionRow" key={friend.user_id}>
                <div><strong>@{friend.username ?? "user"}</strong><small>Requests require their approval</small></div>
                <div className="rowActions">
                  <button className="secondaryButton" onClick={() => setSelected({ recipient: { kind: "friend", value: friend }, type: "loan" })}><HandCoins size={14} /> Lend</button>
                  <button className="secondaryButton" onClick={() => setSelected({ recipient: { kind: "friend", value: friend }, type: "sale" })}><ShoppingCart size={14} /> Sell</button>
                </div>
              </div>
            ))}

            <h3>Non-users</h3>
            {!contacts.isLoading && !(contacts.data ?? []).length && <p className="settingsHint">No non-user contacts yet.</p>}
            {(contacts.data ?? []).map((contact) => (
              <div className="personActionRow" key={contact.id}>
                <div><strong>{contact.name}</strong><small>{contact.phone || "Local contact"}</small></div>
                <div className="rowActions">
                  <button className="secondaryButton" onClick={() => setSelected({ recipient: { kind: "contact", value: contact }, type: "loan" })}><HandCoins size={14} /> Lend</button>
                  <button className="secondaryButton" onClick={() => setSelected({ recipient: { kind: "contact", value: contact }, type: "sale" })}><ShoppingCart size={14} /> Sell</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      {selected && <TransactionModal recipient={selected.recipient} type={selected.type} onClose={() => setSelected(null)} />}
    </>
  )
}

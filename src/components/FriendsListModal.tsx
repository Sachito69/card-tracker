import { useState } from "react"
import { ArrowDownToLine, HandCoins, RefreshCw, ShoppingCart, UserRound, UsersRound, X } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { fetchContacts, fetchFriends } from "../lib/data"
import type { Contact, Friend, TransactionType } from "../lib/types"
import { BorrowModal } from "./BorrowModal"
import { MigrateContactModal } from "./MigrateContactModal"
import { TransactionModal } from "./TransactionModal"

type SelectedTransaction =
  | { recipient: { kind: "friend"; value: Friend }; type: TransactionType }
  | { recipient: { kind: "contact"; value: Contact }; type: TransactionType }
  | null

export function FriendsListModal({ onClose }: { onClose: () => void }) {
  const friends = useQuery({ queryKey: ["friends"], queryFn: fetchFriends, staleTime: 60_000 })
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: fetchContacts, staleTime: 60_000 })
  const [selected, setSelected] = useState<SelectedTransaction>(null)
  const [borrowingFrom, setBorrowingFrom] = useState<Friend | null>(null)
  const [migrating, setMigrating] = useState<Contact | null>(null)

  const friendRows = friends.data ?? []
  const contactRows = contacts.data ?? []

  return (
    <>
      <div className="modalBackdrop" onMouseDown={onClose}>
        <section className="modal friendsModal" onMouseDown={(event) => event.stopPropagation()}>
          <header className="modalHeader friendsHeader">
            <div>
              <h2>Friends</h2>
              <p>Borrow, lend, sell, and manage people you trade cards with.</p>
            </div>
            <button className="iconButton" onClick={onClose}><X size={18} /></button>
          </header>

          <div className="modalBody friendsBody">
            <section className="peopleSection">
              <div className="peopleSectionHeader">
                <div><UsersRound size={18} /><strong>Registered friends</strong></div>
                <span>{friendRows.length}</span>
              </div>

              {friends.isLoading ? (
                <p className="settingsHint">Loading friends...</p>
              ) : !friendRows.length ? (
                <div className="friendEmptyState">
                  <UserRound size={26} />
                  <strong>No accepted friends yet</strong>
                  <small>Add a friend from the Community menu first.</small>
                </div>
              ) : (
                <div className="friendCardList">
                  {friendRows.map((friend) => (
                    <article className="friendCard" key={friend.user_id}>
                      <div className="friendIdentity">
                        <span className="friendAvatar">{(friend.username ?? "U").slice(0, 1).toUpperCase()}</span>
                        <div>
                          <strong>{friend.username ?? "user"}</strong>
                          <small>Registered friend · requests require approval</small>
                        </div>
                      </div>

                      <div className="friendActions">
                        <button className="secondaryButton borrowButton" onClick={() => setBorrowingFrom(friend)}>
                          <ArrowDownToLine size={14} /> Borrow
                        </button>
                        <button className="secondaryButton" onClick={() => setSelected({ recipient: { kind: "friend", value: friend }, type: "loan" })}>
                          <HandCoins size={14} /> Lend
                        </button>
                        <button className="secondaryButton" onClick={() => setSelected({ recipient: { kind: "friend", value: friend }, type: "sale" })}>
                          <ShoppingCart size={14} /> Sell
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="peopleSection">
              <div className="peopleSectionHeader">
                <div><UserRound size={18} /><strong>Non-user contacts</strong></div>
                <span>{contactRows.length}</span>
              </div>

              {contacts.isLoading ? (
                <p className="settingsHint">Loading contacts...</p>
              ) : !contactRows.length ? (
                <div className="friendEmptyState">
                  <UserRound size={26} />
                  <strong>No local contacts yet</strong>
                  <small>Create a non-user from the Community menu.</small>
                </div>
              ) : (
                <div className="friendCardList">
                  {contactRows.map((contact) => (
                    <article className="friendCard localFriendCard" key={contact.id}>
                      <div className="friendIdentity">
                        <span className="friendAvatar localAvatar">{contact.name.slice(0, 1).toUpperCase()}</span>
                        <div>
                          <strong>{contact.name}</strong>
                          <small>{contact.phone || "Local contact"}</small>
                        </div>
                      </div>

                      <div className="friendActions">
                        <button className="secondaryButton" onClick={() => setSelected({ recipient: { kind: "contact", value: contact }, type: "loan" })}>
                          <HandCoins size={14} /> Lend
                        </button>
                        <button className="secondaryButton" onClick={() => setSelected({ recipient: { kind: "contact", value: contact }, type: "sale" })}>
                          <ShoppingCart size={14} /> Sell
                        </button>
                        <button
                          className="secondaryButton migrateButton"
                          disabled={!friendRows.length}
                          title={friendRows.length ? "Transfer this contact to a registered friend" : "Add the registered user as a friend first"}
                          onClick={() => setMigrating(contact)}
                        >
                          <RefreshCw size={14} /> Migrate
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>
      </div>

      {selected && (
        <TransactionModal
          recipient={selected.recipient}
          type={selected.type}
          onClose={() => setSelected(null)}
        />
      )}

      {borrowingFrom && (
        <BorrowModal friend={borrowingFrom} onClose={() => setBorrowingFrom(null)} />
      )}

      {migrating && (
        <MigrateContactModal
          contact={migrating}
          friends={friendRows}
          onClose={() => setMigrating(null)}
        />
      )}
    </>
  )
}

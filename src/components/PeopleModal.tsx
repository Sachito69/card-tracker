import { useState } from "react"
import { Plus, Search, X } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createContact, fetchContacts, fetchFriends, findUsers, sendFriendRequest } from "../lib/data"
import type { Friend } from "../lib/types"

export function PeopleModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const friends = useQuery({ queryKey: ["friends"], queryFn: fetchFriends, staleTime: 60_000 })
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: fetchContacts, staleTime: 60_000 })

  const [contactName, setContactName] = useState("")
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<Friend[]>([])

  const addContact = useMutation({
    mutationFn: () => createContact(contactName),
    onSuccess: async () => {
      setContactName("")
      await qc.invalidateQueries({ queryKey: ["contacts"] })
    },
  })

  const addFriend = useMutation({
    mutationFn: sendFriendRequest,
    onSuccess: () => {
      setSearch("")
      setResults([])
    },
  })

  async function runSearch() {
    setResults(await findUsers(search))
  }

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2>People</h2>
            <p>Registered friends can accept/decline loans and sales. Non-users are local contacts.</p>
          </div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modalBody">
          <h3>Registered friends</h3>
          <div className="peopleSearch">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search username..." />
            <button className="secondaryButton" onClick={runSearch}><Search size={15}/> Search</button>
          </div>
          {results.map((user) => (
            <div className="holderRow" key={user.user_id}>
              <strong>@{user.username ?? "user"}</strong>
              <button className="secondaryButton" onClick={() => addFriend.mutate(user.user_id)}>Add friend</button>
            </div>
          ))}
          {(friends.data ?? []).map((friend) => (
            <div className="holderRow" key={friend.user_id}>
              <strong>@{friend.username ?? "user"}</strong>
              <small>Registered friend</small>
            </div>
          ))}

          <h3>Non-user contacts</h3>
          <div className="peopleSearch">
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Name..." />
            <button className="primaryButton" disabled={!contactName.trim()} onClick={() => addContact.mutate()}>
              <Plus size={15}/> Add contact
            </button>
          </div>
          {(contacts.data ?? []).map((contact) => (
            <div className="holderRow" key={contact.id}>
              <strong>{contact.name}</strong>
              <small>Local non-user contact</small>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

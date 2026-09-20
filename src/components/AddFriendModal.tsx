import { useState } from "react"
import { Search, UserPlus, X } from "lucide-react"
import { useMutation } from "@tanstack/react-query"
import { findUsers, sendFriendRequest } from "../lib/data"
import type { Friend } from "../lib/types"

export function AddFriendModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Friend[]>([])
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState("")

  async function search() {
    if (query.trim().length < 2) return
    setSearching(true)
    setMessage("")
    try {
      setResults(await findUsers(query))
    } catch (error: any) {
      setMessage(error.message)
    } finally {
      setSearching(false)
    }
  }

  const add = useMutation({
    mutationFn: sendFriendRequest,
    onSuccess: () => setMessage("Friend request sent."),
  })

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal smallModal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div><h2>Add friend</h2><p>Search by username.</p></div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="modalBody">
          <div className="peopleSearch">
            <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && search()} placeholder="Username..." autoFocus />
            <button className="secondaryButton" onClick={search} disabled={searching}><Search size={15} /> {searching ? "Searching" : "Search"}</button>
          </div>
          {message && <p className="settingsHint">{message}</p>}
          <div className="peopleList">
            {results.map((user) => (
              <div className="personActionRow" key={user.user_id}>
                <div><strong>{user.username ?? "user"}</strong><small>Registered user</small></div>
                <button className="primaryButton" onClick={() => add.mutate(user.user_id)} disabled={add.isPending}><UserPlus size={14} /> Add</button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

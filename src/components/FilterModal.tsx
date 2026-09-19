import { X } from "lucide-react"
import type { Friend, Holder } from "../lib/types"

export type TrackerFilters = {
  colors: string[]
  deckId: string
  binderId: string
  boxId: string
  friendId: string
}

export const EMPTY_FILTERS: TrackerFilters = {
  colors: [],
  deckId: "",
  binderId: "",
  boxId: "",
  friendId: "",
}

export function FilterModal({
  filters,
  onChange,
  holders,
  friends,
  onClose,
}: {
  filters: TrackerFilters
  onChange: (next: TrackerFilters) => void
  holders: Holder[]
  friends: Friend[]
  onClose: () => void
}) {
  const toggleColor = (color: string) => {
    const colors = filters.colors.includes(color)
      ? filters.colors.filter((value) => value !== color)
      : [...filters.colors, color]
    onChange({ ...filters, colors })
  }

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal smallModal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2>Filter cards</h2>
            <p>Filter locally without reloading the tracker.</p>
          </div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modalBody">
          <div className="filterSection">
            <strong>Colors</strong>
            <div className="colorChecks">
              {["W", "U", "B", "R", "G", "C", "M"].map((color) => (
                <label className="colorCheck" key={color}>
                  <input type="checkbox" checked={filters.colors.includes(color)} onChange={() => toggleColor(color)} />
                  <span>{color}</span>
                </label>
              ))}
            </div>
          </div>

          <label>
            Deck
            <select value={filters.deckId} onChange={(event) => onChange({ ...filters, deckId: event.target.value })}>
              <option value="">Any deck</option>
              {holders.filter((holder) => holder.type === "deck").map((holder) => <option key={holder.id} value={holder.id}>{holder.name}</option>)}
            </select>
          </label>

          <label>
            Binder
            <select value={filters.binderId} onChange={(event) => onChange({ ...filters, binderId: event.target.value })}>
              <option value="">Any binder</option>
              {holders.filter((holder) => holder.type === "binder").map((holder) => <option key={holder.id} value={holder.id}>{holder.name}</option>)}
            </select>
          </label>

          <label>
            Box
            <select value={filters.boxId} onChange={(event) => onChange({ ...filters, boxId: event.target.value })}>
              <option value="">Any box</option>
              {holders.filter((holder) => holder.type === "box").map((holder) => <option key={holder.id} value={holder.id}>{holder.name}</option>)}
            </select>
          </label>

          <label>
            Friend
            <select value={filters.friendId} onChange={(event) => onChange({ ...filters, friendId: event.target.value })}>
              <option value="">Any friend</option>
              {friends.map((friend) => <option key={friend.user_id} value={friend.user_id}>@{friend.username ?? "user"}</option>)}
            </select>
          </label>

          <div className="modalFooterButtons">
            <button className="secondaryButton" onClick={() => onChange(EMPTY_FILTERS)}>Clear filters</button>
            <button className="primaryButton" onClick={onClose}>Done</button>
          </div>
        </div>
      </section>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from "react"
import { Archive, Box, ChevronDown, History, Layers3, LogOut, Menu, Plus, Search, Settings, UsersRound } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { supabase } from "../lib/supabase"
import { fetchCollection, fetchHolders } from "../lib/data"
import type { CollectionItem, HolderType } from "../lib/types"
import { AddCardModal } from "./AddCardModal"
import { CardEditorModal } from "./CardEditorModal"
import { HolderCreateModal } from "./HolderCreateModal"
import { HistoryModal } from "./HistoryModal"
import { PeopleModal } from "./PeopleModal"
import { applySavedDensity, SettingsModal } from "./SettingsModal"

const PAGE_SIZE = 120

type Popup = null | "card" | "settings" | "history" | HolderType

export function Tracker() {
  const [search, setSearch] = useState("")
  const [scope, setScope] = useState<"all" | "collection" | "deck" | "binder" | "box">("all")
  const [holderFilter, setHolderFilter] = useState<string>("all")
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [popup, setPopup] = useState<Popup>(null)
  const [showPeople, setShowPeople] = useState(false)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showMainMenu, setShowMainMenu] = useState(false)
  const [editing, setEditing] = useState<CollectionItem | null>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const mainMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => applySavedDensity(), [])

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      const target = event.target as Node
      if (addMenuRef.current && !addMenuRef.current.contains(target)) setShowAddMenu(false)
      if (mainMenuRef.current && !mainMenuRef.current.contains(target)) setShowMainMenu(false)
    }
    document.addEventListener("mousedown", closeMenus)
    return () => document.removeEventListener("mousedown", closeMenus)
  }, [])

  const collectionQuery = useQuery({
    queryKey: ["collection"],
    queryFn: fetchCollection,
    staleTime: 5 * 60 * 1000,
  })

  const holdersQuery = useQuery({
    queryKey: ["holders"],
    queryFn: fetchHolders,
    staleTime: 5 * 60 * 1000,
  })

  const items = collectionQuery.data ?? []
  const holders = holdersQuery.data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (q && !item.card.name.toLowerCase().includes(q)) return false
      if (scope === "collection" && item.holder_id !== null) return false
      if (scope === "deck" && item.holder?.type !== "deck") return false
      if (scope === "binder" && item.holder?.type !== "binder") return false
      if (scope === "box" && item.holder?.type !== "box") return false
      if (holderFilter !== "all" && item.holder_id !== Number(holderFilter)) return false
      return true
    })
  }, [items, search, scope, holderFilter])

  const totalCards = useMemo(
    () => filtered.reduce((sum, item) => sum + item.quantity, 0),
    [filtered],
  )

  const shown = filtered.slice(0, visible)

  function openAdd(type: "card" | HolderType) {
    setShowAddMenu(false)
    setPopup(type)
  }

  async function logout() {
    setShowMainMenu(false)
    await supabase.auth.signOut()
  }

  return (
    <div className="trackerPage">
      <header className="topbar">
        <div>
          <h1>Card Tracker</h1>
          <p>{totalCards.toLocaleString()} cards · {filtered.length.toLocaleString()} entries</p>
        </div>

        <div className="topActions">
          <button className="secondaryButton" onClick={() => setShowPeople(true)}>
            <UsersRound size={16} /> People
          </button>

          <div className="menuWrap" ref={addMenuRef}>
            <button
              className="primaryButton"
              onClick={() => {
                setShowAddMenu((value) => !value)
                setShowMainMenu(false)
              }}
            >
              <Plus size={16} /> Add <ChevronDown size={14} />
            </button>
            {showAddMenu && (
              <div className="dropdownMenu addDropdown">
                <button onClick={() => openAdd("card")}><Plus size={15} /> Card</button>
                <button onClick={() => openAdd("deck")}><Layers3 size={15} /> Deck</button>
                <button onClick={() => openAdd("binder")}><Archive size={15} /> Binder</button>
                <button onClick={() => openAdd("box")}><Box size={15} /> Box</button>
              </div>
            )}
          </div>

          <div className="menuWrap" ref={mainMenuRef}>
            <button
              className="secondaryButton"
              onClick={() => {
                setShowMainMenu((value) => !value)
                setShowAddMenu(false)
              }}
            >
              <Menu size={16} /> Menu <ChevronDown size={14} />
            </button>
            {showMainMenu && (
              <div className="dropdownMenu mainDropdown">
                <button onClick={() => { setPopup("settings"); setShowMainMenu(false) }}>
                  <Settings size={15} /> Settings
                </button>
                <button onClick={() => { setPopup("history"); setShowMainMenu(false) }}>
                  <History size={15} /> History
                </button>
                <button className="dropdownDanger" onClick={logout}>
                  <LogOut size={15} /> Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="controls">
        <div className="searchBox">
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setVisible(PAGE_SIZE)
            }}
            placeholder="Search your cards..."
          />
        </div>

        <div className="scopeButtons">
          {[
            ["all", "All"],
            ["collection", "My Collection"],
            ["deck", "Decks"],
            ["binder", "Binders"],
            ["box", "Boxes"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={scope === value ? "active" : ""}
              onClick={() => {
                setScope(value as typeof scope)
                setHolderFilter("all")
                setVisible(PAGE_SIZE)
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={holderFilter}
          onChange={(event) => {
            setHolderFilter(event.target.value)
            setVisible(PAGE_SIZE)
          }}
        >
          <option value="all">All holders</option>
          {holders.map((holder) => (
            <option key={holder.id} value={holder.id}>
              {holder.type[0].toUpperCase() + holder.type.slice(1)} · {holder.name}
            </option>
          ))}
        </select>
      </section>

      {collectionQuery.isLoading ? (
        <div className="emptyState">Loading cards...</div>
      ) : collectionQuery.error ? (
        <div className="emptyState errorText">{collectionQuery.error.message}</div>
      ) : shown.length === 0 ? (
        <div className="emptyState">
          <h2>No cards here yet</h2>
          <p>Add your first card or change your filters.</p>
        </div>
      ) : (
        <>
          <div className="cardGrid">
            {shown.map((item) => (
              <button className="cardTile" key={item.id} onClick={() => setEditing(item)}>
                <div className="imageShell">
                  {item.card.image_url ? (
                    <img
                      src={item.card.image_url}
                      alt={item.card.name}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="noImage">No image</div>
                  )}
                  <span className="qtyBadge">×{item.quantity}</span>
                </div>
                <div className="cardInfo">
                  <strong>{item.card.name}</strong>
                  <small>{item.holder?.name ?? "My Collection"}</small>
                  <small>{item.condition}{item.foil ? " · Foil" : ""}</small>
                </div>
              </button>
            ))}
          </div>

          {visible < filtered.length && (
            <div className="loadMore">
              <button className="secondaryButton" onClick={() => setVisible((number) => number + PAGE_SIZE)}>
                Show more
              </button>
              <small>Showing {shown.length} of {filtered.length}</small>
            </div>
          )}
        </>
      )}

      {popup === "card" && <AddCardModal holders={holders} onClose={() => setPopup(null)} />}
      {(popup === "deck" || popup === "binder" || popup === "box") && (
        <HolderCreateModal type={popup} onClose={() => setPopup(null)} />
      )}
      {popup === "settings" && <SettingsModal onClose={() => setPopup(null)} />}
      {popup === "history" && <HistoryModal onClose={() => setPopup(null)} />}
      {showPeople && <PeopleModal onClose={() => setShowPeople(false)} />}
      {editing && <CardEditorModal item={editing} holders={holders} onClose={() => setEditing(null)} />}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Archive,
  Bell,
  Box,
  ChevronDown,
  Filter,
  History,
  Layers3,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  UserPlus,
  UsersRound,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { supabase } from "../lib/supabase"
import { fetchCollection, fetchFriends, fetchHolders, fetchNotifications } from "../lib/data"
import type { CollectionItem, HolderType } from "../lib/types"
import { AddCardModal } from "./AddCardModal"
import { AddFriendModal } from "./AddFriendModal"
import { CardEditorModal } from "./CardEditorModal"
import { CreateContactModal } from "./CreateContactModal"
import { FilterModal, EMPTY_FILTERS, type TrackerFilters } from "./FilterModal"
import { FriendsListModal } from "./FriendsListModal"
import { HolderCreateModal } from "./HolderCreateModal"
import { HistoryModal } from "./HistoryModal"
import { NotificationsModal } from "./NotificationsModal"
import { applySavedDensity, SettingsModal } from "./SettingsModal"

const PAGE_SIZE = 120

type Popup = null | "card" | "settings" | "history" | "notifications" | "filter" | "add-friend" | "friends" | "contact" | HolderType

function matchesColor(item: CollectionItem, selected: string[]) {
  if (!selected.length) return true
  const colors = item.card.colors ?? []
  return selected.some((filter) => {
    if (filter === "C") return colors.length === 0
    if (filter === "M") return colors.length > 1
    return colors.includes(filter)
  })
}

export function Tracker() {
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState<TrackerFilters>(EMPTY_FILTERS)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [popup, setPopup] = useState<Popup>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showCommunityMenu, setShowCommunityMenu] = useState(false)
  const [showMainMenu, setShowMainMenu] = useState(false)
  const [editing, setEditing] = useState<CollectionItem | null>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const communityMenuRef = useRef<HTMLDivElement>(null)
  const mainMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => applySavedDensity(), [])

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      const target = event.target as Node
      if (addMenuRef.current && !addMenuRef.current.contains(target)) setShowAddMenu(false)
      if (communityMenuRef.current && !communityMenuRef.current.contains(target)) setShowCommunityMenu(false)
      if (mainMenuRef.current && !mainMenuRef.current.contains(target)) setShowMainMenu(false)
    }
    document.addEventListener("mousedown", closeMenus)
    return () => document.removeEventListener("mousedown", closeMenus)
  }, [])

  const collectionQuery = useQuery({ queryKey: ["collection"], queryFn: fetchCollection, staleTime: 60_000 })
  const holdersQuery = useQuery({ queryKey: ["holders"], queryFn: fetchHolders, staleTime: 5 * 60_000 })
  const friendsQuery = useQuery({ queryKey: ["friends"], queryFn: fetchFriends, staleTime: 60_000 })
  const notificationsQuery = useQuery({ queryKey: ["notifications"], queryFn: fetchNotifications, refetchInterval: 30_000, staleTime: 15_000 })

  const items = collectionQuery.data ?? []
  const holders = holdersQuery.data ?? []
  const friends = friendsQuery.data ?? []
  const notificationCount = notificationsQuery.data?.length ?? 0

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const selectedHolderIds = [filters.deckId, filters.binderId, filters.boxId].filter(Boolean).map(Number)

    return items.filter((item) => {
      if (q && !item.card.name.toLowerCase().includes(q)) return false
      if (!matchesColor(item, filters.colors)) return false
      if (selectedHolderIds.length && !selectedHolderIds.includes(item.holder_id ?? -1)) return false
      if (filters.friendId && !(item.loan_friend_ids ?? []).includes(filters.friendId) && item.loan_friend_id !== filters.friendId) return false
      return true
    })
  }, [items, search, filters])

  const totalCards = useMemo(() => filtered.reduce((sum, item) => sum + item.quantity, 0), [filtered])
  const shown = filtered.slice(0, visible)
  const activeFilterCount = filters.colors.length + [filters.deckId, filters.binderId, filters.boxId, filters.friendId].filter(Boolean).length

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
          <div className="menuWrap" ref={communityMenuRef}>
            <button className="secondaryButton" onClick={() => { setShowCommunityMenu((value) => !value); setShowAddMenu(false); setShowMainMenu(false) }}>
              <UsersRound size={16} /> Community <ChevronDown size={14} />
            </button>
            {showCommunityMenu && (
              <div className="dropdownMenu">
                <button onClick={() => { setPopup("add-friend"); setShowCommunityMenu(false) }}><UserPlus size={15} /> Add friend</button>
                <button onClick={() => { setPopup("friends"); setShowCommunityMenu(false) }}><UsersRound size={15} /> Friends list</button>
                <button onClick={() => { setPopup("contact"); setShowCommunityMenu(false) }}><Plus size={15} /> Create non-user</button>
              </div>
            )}
          </div>

          <div className="menuWrap" ref={addMenuRef}>
            <button className="primaryButton" onClick={() => { setShowAddMenu((value) => !value); setShowCommunityMenu(false); setShowMainMenu(false) }}>
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
            <button className="secondaryButton" onClick={() => { setShowMainMenu((value) => !value); setShowAddMenu(false); setShowCommunityMenu(false) }}>
              <Menu size={16} /> Menu <ChevronDown size={14} />
              {notificationCount > 0 && <span className="notificationBadge">{notificationCount > 9 ? "9+" : notificationCount}</span>}
            </button>
            {showMainMenu && (
              <div className="dropdownMenu mainDropdown">
                <button onClick={() => { setPopup("notifications"); setShowMainMenu(false) }}>
                  <Bell size={15} /> Notifications {notificationCount > 0 && <span className="menuCount">{notificationCount}</span>}
                </button>
                <button onClick={() => { setPopup("settings"); setShowMainMenu(false) }}><Settings size={15} /> Settings</button>
                <button onClick={() => { setPopup("history"); setShowMainMenu(false) }}><History size={15} /> History</button>
                <button className="dropdownDanger" onClick={logout}><LogOut size={15} /> Log out</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="controls simpleControls">
        <div className="searchBox">
          <Search size={18} />
          <input value={search} onChange={(event) => { setSearch(event.target.value); setVisible(PAGE_SIZE) }} placeholder="Search your cards..." />
        </div>
        <button className={`secondaryButton filterButton ${activeFilterCount ? "activeFilter" : ""}`} onClick={() => setPopup("filter")}>
          <Filter size={16} /> Filter {activeFilterCount > 0 && <span className="filterCount">{activeFilterCount}</span>}
        </button>
      </section>

      {collectionQuery.isLoading ? (
        <div className="emptyState">Loading cards...</div>
      ) : collectionQuery.error ? (
        <div className="emptyState errorText">{collectionQuery.error.message}</div>
      ) : shown.length === 0 ? (
        <div className="emptyState"><h2>No cards here yet</h2><p>Add your first card or change your filters.</p></div>
      ) : (
        <>
          <div className="cardGrid">
            {shown.map((item) => (
              <button className={`cardTile ${item.loan_role === "borrower" ? "borrowedCard" : item.loan_role === "lender" ? "lentCard" : ""}`} key={`${item.loan_role ?? "owned"}-${item.id}-${item.loan_transaction_id ?? 0}`} onClick={() => setEditing(item)}>
                <div className="imageShell">
                  {item.card.image_url ? <img src={item.card.image_url} alt={item.card.name} loading="lazy" decoding="async" /> : <div className="noImage">No image</div>}
                  <span className="qtyBadge">×{item.quantity}</span>
                  {item.loan_role === "borrower" && <span className="loanBadge borrowed">Borrowed</span>}
                  {item.loan_role === "lender" && <span className="loanBadge lent">Lent ×{item.lent_quantity}</span>}
                </div>
                <div className="cardInfo">
                  <strong>{item.card.name}</strong>
                  <small>{item.loan_role === "borrower" ? `From @${item.loan_friend_username ?? "user"}` : item.holder?.name ?? "My Collection"}</small>
                  <small>{item.condition}{item.foil ? " · Foil" : ""}</small>
                </div>
              </button>
            ))}
          </div>

          {visible < filtered.length && (
            <div className="loadMore">
              <button className="secondaryButton" onClick={() => setVisible((number) => number + PAGE_SIZE)}>Show more</button>
              <small>Showing {shown.length} of {filtered.length}</small>
            </div>
          )}
        </>
      )}

      {popup === "card" && <AddCardModal holders={holders} onClose={() => setPopup(null)} />}
      {(popup === "deck" || popup === "binder" || popup === "box") && <HolderCreateModal type={popup} onClose={() => setPopup(null)} />}
      {popup === "settings" && <SettingsModal onClose={() => setPopup(null)} />}
      {popup === "history" && <HistoryModal onClose={() => setPopup(null)} />}
      {popup === "notifications" && <NotificationsModal onClose={() => setPopup(null)} />}
      {popup === "filter" && <FilterModal filters={filters} onChange={(next) => { setFilters(next); setVisible(PAGE_SIZE) }} holders={holders} friends={friends} onClose={() => setPopup(null)} />}
      {popup === "add-friend" && <AddFriendModal onClose={() => setPopup(null)} />}
      {popup === "friends" && <FriendsListModal onClose={() => setPopup(null)} />}
      {popup === "contact" && <CreateContactModal onClose={() => setPopup(null)} />}
      {editing && <CardEditorModal item={editing} holders={holders} onClose={() => setEditing(null)} />}
    </div>
  )
}

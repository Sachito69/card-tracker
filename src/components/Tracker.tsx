import { useEffect, useMemo, useRef, useState } from "react"
import {
  Archive,
  ArrowLeft,
  Bell,
  Box,
  ChevronDown,
  Filter,
  History,
  Layers3,
  Clock3,
  Library,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  Trash2,
  UserPlus,
  UsersRound,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "../lib/supabase"
import {
  fetchCollection,
  fetchCurrentProfile,
  fetchHolders,
  fetchNotifications,
  fetchPendingOutgoing,
  deleteDeck,
} from "../lib/data"
import type { CollectionItem, Holder, HolderType } from "../lib/types"
import { AddCardModal } from "./AddCardModal"
import { AddFriendModal } from "./AddFriendModal"
import { CardEditorModal } from "./CardEditorModal"
import { CreateContactModal } from "./CreateContactModal"
import { FilterModal, EMPTY_FILTERS, type TrackerFilters } from "./FilterModal"
import { FriendsListModal } from "./FriendsListModal"
import { HolderCreateModal } from "./HolderCreateModal"
import { HistoryModal } from "./HistoryModal"
import { NotificationsModal } from "./NotificationsModal"
import { PendingModal } from "./PendingModal"
import { applySavedDensity, SettingsModal } from "./SettingsModal"

const PAGE_SIZE = 120

type CollectionView = "cards" | HolderType
type Popup = null | "card" | "settings" | "history" | "notifications" | "pending" | "filter" | "add-friend" | "friends" | "contact" | HolderType

const viewLabels: Record<CollectionView, string> = {
  cards: "Cards",
  deck: "Decks",
  binder: "Binders",
  box: "Boxes",
}

const singularLabels: Record<CollectionView, string> = {
  cards: "Card",
  deck: "Deck",
  binder: "Binder",
  box: "Box",
}

function matchesColors(item: CollectionItem, selected: string[]) {
  if (!selected.length) return true
  const colors = item.card.colors ?? []
  return selected.some((filter) => {
    if (filter === "C") return colors.length === 0
    return colors.includes(filter)
  })
}

function matchesCommander(item: CollectionItem, selected: string[]) {
  if (!selected.length) return true
  const identity = item.card.color_identity ?? item.card.colors ?? []

  if (selected.length === 1 && selected[0] === "C") {
    return identity.length === 0
  }

  const allowed = new Set(selected.filter((value) => value !== "C"))
  return identity.every((color) => allowed.has(color))
}

function primaryType(typeLine: string | null | undefined) {
  const text = typeLine ?? ""

  // Classify by the card's main functional type:
  // Artifact Creature / Legendary Creature -> Creature
  // Artifact Land -> Land
  if (text.includes("Creature")) return "Creature"
  if (text.includes("Planeswalker")) return "Planeswalker"
  if (text.includes("Instant")) return "Instant"
  if (text.includes("Sorcery")) return "Sorcery"
  if (text.includes("Land")) return "Land"
  if (text.includes("Battle")) return "Battle"
  if (text.includes("Artifact")) return "Artifact"
  if (text.includes("Enchantment")) return "Enchantment"

  return text.split(" — ")[0] || "Other"
}

function matchesManaValue(item: CollectionItem, value: string) {
  if (!value) return true
  const cmc = Number(item.card.cmc ?? 0)
  if (value === "7+") return cmc >= 7
  return cmc === Number(value)
}

export function Tracker({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const [view, setView] = useState<CollectionView>("cards")
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState<TrackerFilters>(EMPTY_FILTERS)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [popup, setPopup] = useState<Popup>(null)
  const [showCollectionMenu, setShowCollectionMenu] = useState(false)
  const [showCommunityMenu, setShowCommunityMenu] = useState(false)
  const [showMainMenu, setShowMainMenu] = useState(false)
  const [editing, setEditing] = useState<CollectionItem | null>(null)
  const [selectedHolder, setSelectedHolder] = useState<Holder | null>(null)
  const collectionMenuRef = useRef<HTMLDivElement>(null)
  const communityMenuRef = useRef<HTMLDivElement>(null)
  const mainMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => applySavedDensity(), [])

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      const target = event.target as Node
      if (collectionMenuRef.current && !collectionMenuRef.current.contains(target)) setShowCollectionMenu(false)
      if (communityMenuRef.current && !communityMenuRef.current.contains(target)) setShowCommunityMenu(false)
      if (mainMenuRef.current && !mainMenuRef.current.contains(target)) setShowMainMenu(false)
    }
    document.addEventListener("mousedown", closeMenus)
    return () => document.removeEventListener("mousedown", closeMenus)
  }, [])

  const collectionQuery = useQuery({ queryKey: ["collection", userId], queryFn: fetchCollection, staleTime: 60_000 })
  const holdersQuery = useQuery({ queryKey: ["holders", userId], queryFn: fetchHolders, staleTime: 5 * 60_000 })
  const notificationsQuery = useQuery({ queryKey: ["notifications", userId], queryFn: fetchNotifications, refetchInterval: 30_000, staleTime: 15_000 })
  const profileQuery = useQuery({ queryKey: ["profile", userId], queryFn: fetchCurrentProfile, staleTime: 5 * 60_000 })
  const pendingQuery = useQuery({ queryKey: ["pending", userId], queryFn: fetchPendingOutgoing, refetchInterval: 30_000, staleTime: 15_000 })

  const items = collectionQuery.data ?? []
  const holders = holdersQuery.data ?? []
  const notificationCount = notificationsQuery.data?.length ?? 0
  const pendingCount = pendingQuery.data?.length ?? 0
  const currentUsername = profileQuery.data?.username ?? null

  const cardTypes = useMemo(
    () => Array.from(new Set(items.map((item) => primaryType(item.card.type_line)))).sort(),
    [items],
  )

  const filtered = useMemo(() => {
    const q = view === "cards" ? search.trim().toLowerCase() : ""

    return items.filter((item) => {
      if (q && !item.card.name.toLowerCase().includes(q)) return false
      if (view !== "cards") return true
      if (!matchesColors(item, filters.colors)) return false
      if (!matchesCommander(item, filters.commanderColors)) return false
      if (filters.cardType && primaryType(item.card.type_line) !== filters.cardType) return false
      if (!matchesManaValue(item, filters.manaValue)) return false
      return true
    })
  }, [items, search, filters, view])

  const holderRows = useMemo(() => {
    if (view === "cards") return []

    const q = search.trim().toLowerCase()

    return holders
      .filter((holder) => holder.type === view)
      .filter((holder) => !q || holder.name.toLowerCase().includes(q))
      .filter((holder) => {
        if (view !== "deck" || !filters.deckFormat) return true
        if (filters.deckFormat === "__none__") return !holder.format
        return holder.format === filters.deckFormat
      })
      .map((holder) => {
        const holderItems = items.filter((item) => item.holder_id === holder.id)
        return {
          holder,
          entries: holderItems.length,
          cards: holderItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        }
      })
      .sort((a, b) => a.holder.name.localeCompare(b.holder.name))
  }, [view, search, holders, items, filters.deckFormat])

  const selectedHolderItems = useMemo(() => {
    if (!selectedHolder) return []
    const q = search.trim().toLowerCase()

    return items
      .filter((item) => item.holder_id === selectedHolder.id)
      .filter((item) => !q || item.card.name.toLowerCase().includes(q))
      .filter((item) => matchesColors(item, filters.colors))
      .filter((item) => matchesCommander(item, filters.commanderColors))
      .filter((item) => !filters.cardType || primaryType(item.card.type_line) === filters.cardType)
      .filter((item) => matchesManaValue(item, filters.manaValue))
      .sort((a, b) => a.card.name.localeCompare(b.card.name))
  }, [
    selectedHolder,
    items,
    search,
    filters.colors,
    filters.commanderColors,
    filters.cardType,
    filters.manaValue,
  ])

  const selectedHolderCardCount = useMemo(
    () => selectedHolderItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    [selectedHolderItems],
  )


  const deckGroups = useMemo(() => {
    if (selectedHolder?.type !== "deck") return []

    const order = [
      "Creature",
      "Planeswalker",
      "Instant",
      "Sorcery",
      "Artifact",
      "Enchantment",
      "Land",
      "Battle",
      "Other",
    ]

    const grouped = new Map<string, CollectionItem[]>()

    for (const item of selectedHolderItems) {
      const type = primaryType(item.card.type_line)
      if (!grouped.has(type)) grouped.set(type, [])
      grouped.get(type)!.push(item)
    }

    return Array.from(grouped.entries())
      .map(([type, rows]) => ({
        type,
        rows,
        count: rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
      }))
      .sort((a, b) => {
        const ai = order.indexOf(a.type)
        const bi = order.indexOf(b.type)
        const av = ai === -1 ? order.length : ai
        const bv = bi === -1 ? order.length : bi
        return av - bv || a.type.localeCompare(b.type)
      })
  }, [selectedHolder, selectedHolderItems])

  const totalCards = useMemo(() => filtered.reduce((sum, item) => sum + item.quantity, 0), [filtered])
  const shown = filtered.slice(0, visible)
  const filterContext = (selectedHolder ? "cards" : view) as "cards" | HolderType
  const activeFilterCount =
    filterContext === "cards"
      ? filters.colors.length +
        filters.commanderColors.length +
        [filters.cardType, filters.manaValue].filter(Boolean).length
      : filterContext === "deck"
        ? (filters.deckFormat ? 1 : 0)
        : 0

  function changeView(next: CollectionView) {
    setView(next)
    setSelectedHolder(null)
    setSearch("")
    setVisible(PAGE_SIZE)
    setShowCollectionMenu(false)
  }

  function openAddForCurrentView() {
    if (selectedHolder) {
      setPopup("card")
      return
    }
    setPopup(view === "cards" ? "card" : view)
  }

  function openHolder(holder: Holder) {
    setSelectedHolder(holder)
    setSearch("")
    setVisible(PAGE_SIZE)
  }

  function leaveHolder() {
    setSelectedHolder(null)
    setSearch("")
    setVisible(PAGE_SIZE)
  }

  const deleteDeckMutation = useMutation({
    mutationFn: (deckId: number) => deleteDeck(deckId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["holders"] }),
        queryClient.invalidateQueries({ queryKey: ["collection"] }),
      ])
    },
  })


  async function logout() {
    setShowMainMenu(false)
    await supabase.auth.signOut()
    queryClient.clear()
  }

  const addLabel = selectedHolder ? "Add Card" : `Add ${singularLabels[view]}`
  const searchPlaceholder = selectedHolder
    ? `Search ${selectedHolder.name}...`
    : view === "cards"
      ? "Search your cards..."
      : `Search ${viewLabels[view].toLowerCase()}...`

  return (
    <div className="trackerPage">
      <header className="topbar navOnlyTopbar">
        <div className="topActions">
          <div className="menuWrap" ref={collectionMenuRef}>
            <button
              className="secondaryButton collectionMenuButton"
              onClick={() => {
                setShowCollectionMenu((value) => !value)
                setShowCommunityMenu(false)
                setShowMainMenu(false)
              }}
            >
              <Library size={16} /> Collection
              <span className="currentCollectionView">{viewLabels[view]}</span>
              <ChevronDown size={14} />
            </button>

            {showCollectionMenu && (
              <div className="dropdownMenu collectionDropdown">
                <button className={view === "cards" ? "selectedDropdownItem" : ""} onClick={() => changeView("cards")}>
                  <Library size={15} /> Cards
                </button>
                <button className={view === "deck" ? "selectedDropdownItem" : ""} onClick={() => changeView("deck")}>
                  <Layers3 size={15} /> Decks
                </button>
                <button className={view === "binder" ? "selectedDropdownItem" : ""} onClick={() => changeView("binder")}>
                  <Archive size={15} /> Binders
                </button>
                <button className={view === "box" ? "selectedDropdownItem" : ""} onClick={() => changeView("box")}>
                  <Box size={15} /> Boxes
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="topActions">
          <div className="menuWrap" ref={communityMenuRef}>
            <button
              className="secondaryButton"
              onClick={() => {
                setShowCommunityMenu((value) => !value)
                setShowCollectionMenu(false)
                setShowMainMenu(false)
              }}
            >
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

          <div className="menuWrap" ref={mainMenuRef}>
            <button
              className="secondaryButton"
              onClick={() => {
                setShowMainMenu((value) => !value)
                setShowCollectionMenu(false)
                setShowCommunityMenu(false)
              }}
            >
              <Menu size={16} /> Menu <ChevronDown size={14} />
              {notificationCount > 0 && <span className="notificationBadge">{notificationCount > 9 ? "9+" : notificationCount}</span>}
            </button>
            {showMainMenu && (
              <div className="dropdownMenu mainDropdown">
                <div className="loggedInAs">
                  <small>Logged in as</small>
                  <strong>{currentUsername || "Account"}</strong>
                </div>
                <button onClick={() => { setPopup("notifications"); setShowMainMenu(false) }}>
                  <Bell size={15} /> Notifications {notificationCount > 0 && <span className="menuCount">{notificationCount}</span>}
                </button>
                <button onClick={() => { setPopup("pending"); setShowMainMenu(false) }}>
                  <Clock3 size={15} /> Pending {pendingCount > 0 && <span className="menuCount">{pendingCount}</span>}
                </button>
                <button onClick={() => { setPopup("settings"); setShowMainMenu(false) }}><Settings size={15} /> Settings</button>
                <button onClick={() => { setPopup("history"); setShowMainMenu(false) }}><History size={15} /> History</button>
                <button className="dropdownDanger" onClick={logout}><LogOut size={15} /> Log out</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {selectedHolder ? (
        <section className="holderOpenHeading">
          <button className="backButton" onClick={leaveHolder}>
            <ArrowLeft size={17} /> Back
          </button>
          <div>
            <h1>{selectedHolder.name}</h1>
            <p>
              {selectedHolder.type[0].toUpperCase() + selectedHolder.type.slice(1)}
              {selectedHolder.type === "deck" && selectedHolder.format ? ` · ${selectedHolder.format}` : ""}
              {" · "}
              {selectedHolderCardCount.toLocaleString()} cards
              {" · "}
              {selectedHolderItems.length.toLocaleString()} entries
            </p>
          </div>
        </section>
      ) : (
        <section className="collectionHeading">
          <div>
            <h1>{viewLabels[view]}</h1>
            {view === "cards" ? (
              <p>{totalCards.toLocaleString()} cards · {filtered.length.toLocaleString()} entries</p>
            ) : (
              <p>{holderRows.length.toLocaleString()} {viewLabels[view].toLowerCase()}</p>
            )}
          </div>
        </section>
      )}

      <section className="controls collectionControls">
        <button className="primaryButton addContextButton" onClick={openAddForCurrentView}>
          <Plus size={16} /> {addLabel}
        </button>

        <div className="searchBox">
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setVisible(PAGE_SIZE) }}
            placeholder={searchPlaceholder}
          />
        </div>

        <button
          className={`secondaryButton filterButton ${activeFilterCount ? "activeFilter" : ""}`}
          onClick={() => setPopup("filter")}
        >
          <Filter size={16} /> Filter
          {activeFilterCount > 0 && <span className="filterCount">{activeFilterCount}</span>}
        </button>
      </section>

      {selectedHolder ? (
        collectionQuery.isLoading ? (
          <div className="emptyState">Loading {selectedHolder.name}...</div>
        ) : selectedHolderItems.length === 0 ? (
          <div className="emptyState">
            <h2>No cards here yet</h2>
            <p>Add a card to {selectedHolder.name} or change your filters.</p>
          </div>
        ) : selectedHolder.type === "deck" ? (
          <div className="deckGroupedContents">
            {deckGroups.map((group) => (
              <section className="deckTypeGroup" key={group.type}>
                <div className="deckTypeHeading">
                  <strong>{group.type}</strong>
                  <span>{group.count} card{group.count === 1 ? "" : "s"}</span>
                </div>

                <div className="holderContentsList deckContentsList">
                  <div className="holderContentsHeader deckContentsHeader">
                    <span>Card</span>
                    <span>Qty</span>
                    <span>Condition</span>
                    <span>Set</span>
                  </div>

                  {group.rows.map((item) => (
                    <button
                      className="holderContentsRow deckContentsRow"
                      key={`${item.loan_role ?? "owned"}-${item.id}-${item.loan_transaction_id ?? 0}`}
                      onClick={() => setEditing(item)}
                    >
                      <div className="holderCardName">
                        {item.card.image_url ? (
                          <img src={item.card.image_url} alt="" loading="lazy" decoding="async" />
                        ) : (
                          <div className="holderCardThumbPlaceholder" />
                        )}
                        <div>
                          <strong>{item.card.name}</strong>
                          <small>{item.card.type_line || "Card"}</small>
                        </div>
                      </div>
                      <span>{item.quantity}</span>
                      <span>{item.condition}{item.foil ? " · Foil" : ""}</span>
                      <span>{item.card.set_name || item.card.set_code || "—"}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="holderContentsList">
            <div className="holderContentsHeader">
              <span>Card</span>
              <span>Qty</span>
              <span>Condition</span>
              <span>Set</span>
              <span>Status</span>
            </div>

            {selectedHolderItems.map((item) => (
              <button
                className="holderContentsRow"
                key={`${item.loan_role ?? "owned"}-${item.id}-${item.loan_transaction_id ?? 0}`}
                onClick={() => setEditing(item)}
              >
                <div className="holderCardName">
                  {item.card.image_url ? (
                    <img src={item.card.image_url} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <div className="holderCardThumbPlaceholder" />
                  )}
                  <div>
                    <strong>{item.card.name}</strong>
                    <small>{item.card.type_line || "Card"}</small>
                  </div>
                </div>
                <span>{item.quantity}</span>
                <span>{item.condition}{item.foil ? " · Foil" : ""}</span>
                <span>{item.card.set_name || item.card.set_code || "—"}</span>
                <span>
                  {item.loan_role === "borrower"
                    ? `Borrowed from ${item.loan_friend_username ?? "user"}`
                    : item.loan_role === "lender"
                      ? `Lent to ${(item.loan_recipient_names ?? [item.loan_friend_username ?? "recipient"]).join(", ")}`
                      : "Available"}
                </span>
              </button>
            ))}
          </div>
        )
      ) : view === "cards" ? (
        collectionQuery.isLoading ? (
          <div className="emptyState">Loading cards...</div>
        ) : collectionQuery.error ? (
          <div className="emptyState errorText">{collectionQuery.error.message}</div>
        ) : shown.length === 0 ? (
          <div className="emptyState"><h2>No cards here yet</h2><p>Add your first card or change your filters.</p></div>
        ) : (
          <>
            <div className="cardGrid">
              {shown.map((item) => (
                <button
                  className={`cardTile ${item.loan_role === "borrower" ? "borrowedCard" : item.loan_role === "lender" ? "lentCard" : ""}`}
                  key={`${item.loan_role ?? "owned"}-${item.id}-${item.loan_transaction_id ?? 0}`}
                  onClick={() => setEditing(item)}
                >
                  <div className="imageShell">
                    {item.card.image_url ? <img src={item.card.image_url} alt={item.card.name} loading="lazy" decoding="async" /> : <div className="noImage">No image</div>}
                    <span className="qtyBadge">×{item.quantity}</span>
                    {item.loan_role === "borrower" && <span className="loanBadge borrowed">Borrowed</span>}
                    {item.loan_role === "lender" && (
                      <span className="loanBadge lent">
                        Lent to {(item.loan_recipient_names ?? [item.loan_friend_username ?? "recipient"]).join(", ")}
                      </span>
                    )}
                  </div>
                  <div className="cardInfo">
                    <strong>{item.card.name}</strong>
                    <small>
                      {item.loan_role === "borrower"
                        ? `From ${item.loan_friend_username ?? "user"}`
                        : item.loan_role === "lender"
                          ? `Lent to ${(item.loan_recipient_names ?? [item.loan_friend_username ?? "recipient"]).join(", ")}`
                          : item.holder?.name ?? "My Collection"}
                    </small>
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
        )
      ) : holdersQuery.isLoading || collectionQuery.isLoading ? (
        <div className="emptyState">Loading {viewLabels[view].toLowerCase()}...</div>
      ) : holderRows.length === 0 ? (
        <div className="emptyState">
          <h2>No {viewLabels[view].toLowerCase()} found</h2>
          <p>Add your first {singularLabels[view].toLowerCase()} or change your search/filters.</p>
        </div>
      ) : (
        <div className={`holderDetailList ${view === "deck" ? "deckCollectionList" : ""}`}>
          <div className={`holderDetailHeader ${view === "deck" ? "deckCollectionHeader" : ""}`}>
            <span>Name</span>
            <span>Cards</span>
            {view !== "deck" && <span>Entries</span>}
            <span>{view === "deck" ? "Format" : "Notes"}</span>
            {view === "deck" && <span>Options</span>}
          </div>

          {holderRows.map(({ holder, cards, entries }) => (
            <div
              className={`holderDetailRow ${view === "deck" ? "deckCollectionRow" : ""}`}
              key={holder.id}
            >
              <button
                className="holderRowMain"
                onClick={() => openHolder(holder)}
              >
                <div className="holderNameCell">
                  {holder.type === "deck" ? <Layers3 size={18} /> : holder.type === "binder" ? <Archive size={18} /> : <Box size={18} />}
                  <strong>{holder.name}</strong>
                </div>
                <span>{cards.toLocaleString()}</span>
                {view !== "deck" && <span>{entries.toLocaleString()}</span>}
                <span className="holderNotes">{view === "deck" ? (holder.format || "Unspecified") : (holder.notes || "—")}</span>
              </button>

              {view === "deck" && (
                <div className="deckOptionsWrap">
                  <button
                    className="iconButton deckDeleteButton"
                    aria-label={`Delete ${holder.name}`}
                    title="Delete deck"
                    disabled={deleteDeckMutation.isPending}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (window.confirm(`Delete "${holder.name}"? Its cards will be moved to My Collection.`)) {
                        deleteDeckMutation.mutate(holder.id)
                      }
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              )}
            </div>
          ))}

          {deleteDeckMutation.error && (
            <p className="holderListError errorText">
              {deleteDeckMutation.error?.message}
            </p>
          )}
        </div>
      )}

      {popup === "card" && <AddCardModal holders={holders} defaultHolderId={selectedHolder?.id ?? null} onClose={() => setPopup(null)} />}
      {(popup === "deck" || popup === "binder" || popup === "box") && <HolderCreateModal type={popup} onClose={() => setPopup(null)} />}
      {popup === "settings" && <SettingsModal onClose={() => setPopup(null)} />}
      {popup === "history" && <HistoryModal onClose={() => setPopup(null)} />}
      {popup === "notifications" && <NotificationsModal onClose={() => setPopup(null)} />}
      {popup === "pending" && <PendingModal onClose={() => setPopup(null)} />}
      {popup === "filter" && (
        <FilterModal
          context={filterContext}
          filters={filters}
          onChange={(next) => { setFilters(next); setVisible(PAGE_SIZE) }}
          cardTypes={cardTypes}
          onClose={() => setPopup(null)}
        />
      )}
      {popup === "add-friend" && <AddFriendModal onClose={() => setPopup(null)} />}
      {popup === "friends" && <FriendsListModal onClose={() => setPopup(null)} />}
      {popup === "contact" && <CreateContactModal onClose={() => setPopup(null)} />}
      {editing && <CardEditorModal item={editing} holders={holders} onClose={() => setEditing(null)} />}
    </div>
  )
}

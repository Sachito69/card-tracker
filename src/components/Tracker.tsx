import { useEffect, useMemo, useRef, useState } from "react"
import {
  Archive,
  ArrowLeft,
  Bell,
  Box,
  ChevronDown,
  ChevronRight,
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
  HandCoins,
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
  deleteHolder,
} from "../lib/data"
import type { CollectionItem, Holder, HolderType } from "../lib/types"
import { AddCardModal } from "./AddCardModal"
import { AddFriendModal } from "./AddFriendModal"
import { CardEditorModal } from "./CardEditorModal"
import { CreateContactModal } from "./CreateContactModal"
import { FilterModal, type TrackerFilters } from "./FilterModal"
import { loadPreferences,savePreferences,type TrackerPreferences,type Ownership } from "../lib/preferences"
import { CardTextRow } from "./CardTextRow"
import { AcquireCardModal } from "./AcquireCardModal"
import { InventoryDeckProgress } from "./InventoryDeckProgress"
import { collectionItemKey,isOwnedInventory } from "../lib/inventory"
import { HolderCardGrid } from "./HolderCardGrid"
import { FriendsListModal } from "./FriendsListModal"
import { LendDeckModal } from "./LendDeckModal"
import { HolderCreateModal } from "./HolderCreateModal"
import { HistoryModal } from "./HistoryModal"
import { NotificationsModal } from "./NotificationsModal"
import { PendingModal } from "./PendingModal"
import { applySavedDensity, SettingsModal } from "./SettingsModal"
import { CardGridSkeleton, ListSkeleton } from "./Skeletons"
import { useFeedback } from "./Feedback"

const PAGE_SIZE = 120

type CollectionView = "cards" | "deck" | "containers" | "wishlist"
type Popup = null | "card" | "settings" | "history" | "notifications" | "pending" | "filter" | "add-friend" | "friends" | "contact" | "deck" | "container"

const viewLabels: Record<CollectionView, string> = {
  cards: "Cards",
  deck: "Decks",
  containers: "Containers",
  wishlist: "Wishlist",
}

const singularLabels: Record<CollectionView, string> = {
  cards: "Card",
  deck: "Deck",
  containers: "Container",
  wishlist: "Card",
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
  const { confirm, toast } = useFeedback()
  const [view, setView] = useState<CollectionView>("cards")
  const [search, setSearch] = useState("")
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [popup, setPopup] = useState<Popup>(null)
  const [showCollectionMenu, setShowCollectionMenu] = useState(false)
  const [showCommunityMenu, setShowCommunityMenu] = useState(false)
  const [showMainMenu, setShowMainMenu] = useState(false)
  const [editing, setEditing] = useState<CollectionItem | null>(null)
  const [selectedHolder, setSelectedHolder] = useState<Holder | null>(null)
  const [lendingDeck, setLendingDeck] = useState<Holder | null>(null)
  const preferenceContext=selectedHolder?`${selectedHolder.type}:${selectedHolder.id}`:view
  const preferenceKey=`${userId}:${preferenceContext}`
  const [savedPreferences,setSavedPreferences]=useState({key:`${userId}:cards`,value:loadPreferences(userId,"cards")})
  const preferences=savedPreferences.key===preferenceKey?savedPreferences.value:loadPreferences(userId,preferenceContext)
  function updatePreferences(patch:Partial<TrackerPreferences>){
    const value={...preferences,...patch}
    setSavedPreferences({key:preferenceKey,value});savePreferences(userId,preferenceContext,value)
  }
  const filters=preferences.filters
  const setFilters=(value:TrackerFilters)=>updatePreferences({filters:value})
  const [desktopPanel,setDesktopPanel]=useState(()=>loadPreferences(userId,"display").desktopPanel)
  const [desktop,setDesktop]=useState(()=>window.matchMedia("(min-width:1024px)").matches)
  const [acquiring,setAcquiring]=useState<CollectionItem|null>(null)
  useEffect(()=>{setDesktopPanel(loadPreferences(userId,"display").desktopPanel)},[userId])
  useEffect(()=>{
    const media=window.matchMedia("(min-width:1024px)"),change=()=>setDesktop(media.matches)
    media.addEventListener("change",change);return()=>media.removeEventListener("change",change)
  },[])
  const matchesOwnership=(item:CollectionItem)=>preferences.ownership==="all"||
    (preferences.ownership==="owned"&&isOwnedInventory(item))||
    (preferences.ownership==="borrowed"&&item.loan_role==="borrower")||
    (preferences.ownership==="lent"&&(item.lent_quantity??0)>0)||
    (preferences.ownership==="unsorted"&&item.holder_id===null)
  const sortItems=(a:CollectionItem,b:CollectionItem)=>preferences.sort==="quantity"?b.quantity-a.quantity||a.card.name.localeCompare(b.card.name):
    preferences.sort==="newest"?Date.parse(b.created_at)-Date.parse(a.created_at)||a.card.name.localeCompare(b.card.name):a.card.name.localeCompare(b.card.name)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
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
    const q = search.trim().toLowerCase()

    return items.filter((item) => {
      if(view==="wishlist"?!item.is_missing:item.is_missing)return false
      if (!matchesOwnership(item)||(q && !item.card.name.toLowerCase().includes(q))) return false
      if (view !== "cards"&&view!=="wishlist") return true
      if (!matchesColors(item, filters.colors)) return false
      if (!matchesCommander(item, filters.commanderColors)) return false
      if (filters.cardType && primaryType(item.card.type_line) !== filters.cardType) return false
      if (!matchesManaValue(item, filters.manaValue)) return false
      return true
    }).sort(sortItems)
  }, [items, search, filters, view,preferences.ownership,preferences.sort])

  const holderRows = useMemo(() => {
    if (view === "cards"||view==="wishlist") return []

    const q = search.trim().toLowerCase()

    return holders
      .filter((holder) => view==="containers"?holder.type!=="deck":holder.type===view)
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
          cards: holderItems.filter(item=>!item.is_missing).reduce((sum, item) => sum + Math.max(0,item.quantity-(item.lent_quantity??0)), 0),
        }
      })
      .sort((a, b) => a.holder.name.localeCompare(b.holder.name))
  }, [view, search, holders, items, filters.deckFormat])

  const selectedHolderItems = useMemo(() => {
    if (!selectedHolder) return []
    const q = search.trim().toLowerCase()

    return items
      .filter((item) => item.holder_id === selectedHolder.id)
      .filter(matchesOwnership)
      .filter((item) => !q || item.card.name.toLowerCase().includes(q))
      .filter((item) => matchesColors(item, filters.colors))
      .filter((item) => matchesCommander(item, filters.commanderColors))
      .filter((item) => !filters.cardType || primaryType(item.card.type_line) === filters.cardType)
      .filter((item) => matchesManaValue(item, filters.manaValue))
      .sort(sortItems)
  }, [
    selectedHolder,
    items,
    search,
    filters.colors,
    filters.commanderColors,
    filters.cardType,
    filters.manaValue,
    preferences.ownership,preferences.sort,
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
  const filterContext: "cards"|HolderType = selectedHolder||view==="wishlist"?"cards":view==="containers"?"binder":view
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
    setPopup(view === "cards"||view==="wishlist" ? "card" : view==="containers"?"container":"deck")
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

  const deleteHolderMutation = useMutation({
    mutationFn: (holder: Holder) => deleteHolder(holder.id),
    onSuccess: async (_data, holder) => {
      toast(`${holder.type[0].toUpperCase() + holder.type.slice(1)} deleted`)
      if (selectedHolder?.id === holder.id) setSelectedHolder(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["holders"] }),
        queryClient.invalidateQueries({ queryKey: ["collection"] }),
      ])
    },
  })


  function toggleDeckGroup(group: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

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
    <div className={`trackerPage ${editing&&desktopPanel&&desktop?"hasDetailPanel":""}`}>
      <header className="topbar navOnlyTopbar desktopTopbar">
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
                <button className={view === "containers" ? "selectedDropdownItem" : ""} onClick={() => changeView("containers")}>
                  <Archive size={15} /> Containers
                </button>
                <button className={view === "wishlist" ? "selectedDropdownItem" : ""} onClick={() => changeView("wishlist")}>
                  <Box size={15} /> Wishlist
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
          {selectedHolder.type === "deck" && (
            <button className="secondaryButton lendDeckAction" onClick={() => setLendingDeck(selectedHolder)}>
              <HandCoins size={16} /> Lend Deck
            </button>
          )}
        </section>
      ) : (
        <section className="collectionHeading">
          <div>
            <h1>{viewLabels[view]}</h1>
            {view === "cards"||view==="wishlist" ? (
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

      {(view==="cards"||view==="wishlist"||selectedHolder)&&<section className="uxBrowseControls">
        <div className="ownershipChips" role="group" aria-label="Ownership filters">
          {(["all","owned","borrowed","lent","unsorted"] as Ownership[]).map(value=><button key={value} className={preferences.ownership===value?"active":""} aria-pressed={preferences.ownership===value} onClick={()=>{updatePreferences({ownership:value});setVisible(PAGE_SIZE)}}>{value[0].toUpperCase()+value.slice(1)}</button>)}
        </div>
        <div className="uxViewControls"><label>View<select aria-label="Collection view" value={preferences.view} onChange={e=>updatePreferences({view:e.target.value as TrackerPreferences["view"]})}><option value="images">Images</option><option value="text">Text</option></select></label>
          <label>Sort<select aria-label="Sort cards" value={preferences.sort} onChange={e=>updatePreferences({sort:e.target.value as TrackerPreferences["sort"]})}><option value="name">Name</option><option value="newest">Newest added</option><option value="quantity">Quantity</option></select></label></div>
      </section>}
      {selectedHolder?.type==="deck"&&<InventoryDeckProgress items={items} holderId={selectedHolder.id}/>}
      {selectedHolder ? (
        collectionQuery.isLoading ? (
          <ListSkeleton rows={5} />
        ) : selectedHolderItems.length === 0 ? (
          <div className="emptyState">
            <h2>No cards here yet</h2>
            <p>Add a card to {selectedHolder.name} or change your filters.</p>
          </div>
        ) : preferences.view==="images" ? <HolderCardGrid items={selectedHolderItems} onSelect={setEditing} onAcquire={setAcquiring}/> : selectedHolder.type === "deck" ? (
          <div className="deckGroupedContents">
            {deckGroups.map((group) => (
              <section className="deckTypeGroup" key={group.type}>
                <button
                  className="deckTypeHeading"
                  onClick={() => toggleDeckGroup(group.type)}
                  aria-expanded={!collapsedGroups.has(group.type)}
                >
                  <div>
                    <ChevronRight
                      size={16}
                      className={collapsedGroups.has(group.type) ? "" : "deckGroupChevronOpen"}
                    />
                    <strong>{group.type}</strong>
                  </div>
                  <span>{group.count} card{group.count === 1 ? "" : "s"}</span>
                </button>

                {!collapsedGroups.has(group.type) && (
                  <div className="holderContentsList deckContentsList">

                    {group.rows.map(item=><CardTextRow key={collectionItemKey(item)} item={item} onSelect={setEditing} onAcquire={setAcquiring}/>)}
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="cardTextList">{selectedHolderItems.map(item=><CardTextRow key={collectionItemKey(item)} item={item} onSelect={setEditing} onAcquire={setAcquiring}/>)}</div>
        )
      ) : view === "cards"||view==="wishlist" ? (
        collectionQuery.isLoading ? (
          <CardGridSkeleton />
        ) : collectionQuery.error ? (
          <div className="emptyState errorText">{collectionQuery.error.message}</div>
        ) : shown.length === 0 ? (
          <div className="emptyState"><h2>No cards here yet</h2><p>Add your first card or change your filters.</p></div>
        ) : (
          <>
            {preferences.view==="images"?<HolderCardGrid items={shown} onSelect={setEditing} onAcquire={setAcquiring}/>:<div className="cardTextList">{shown.map(item=><CardTextRow key={collectionItemKey(item)} item={item} onSelect={setEditing} onAcquire={setAcquiring}/>)}</div>}

            {visible < filtered.length && (
              <div className="loadMore">
                <button className="secondaryButton" onClick={() => setVisible((number) => number + PAGE_SIZE)}>Show more</button>
                <small>Showing {shown.length} of {filtered.length}</small>
              </div>
            )}
          </>
        )
      ) : holdersQuery.isLoading || collectionQuery.isLoading ? (
        <ListSkeleton rows={5} />
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
            <span>Options</span>
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

              <div className="deckOptionsWrap">
                <button
                  className="iconButton deckDeleteButton"
                  aria-label={`Delete ${holder.name}`}
                  title={`Delete ${holder.type}`}
                  disabled={deleteHolderMutation.isPending}
                  onClick={async (event) => {
                    event.stopPropagation()
                    const label = holder.type[0].toUpperCase() + holder.type.slice(1)
                    const approved = await confirm({
                      title: `Delete ${holder.name}?`,
                      description: `The ${holder.type} will be removed. Owned cards inside it will move to Unsorted, and borrowed cards placed there will also become Unsorted.`,
                      confirmLabel: `Delete ${label.toLowerCase()}`,
                      tone: "danger",
                    })
                    if (approved) deleteHolderMutation.mutate(holder)
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          ))}

          {deleteHolderMutation.error && (
            <p className="holderListError errorText">
              {deleteHolderMutation.error?.message}
            </p>
          )}
        </div>
      )}


      {/* Mobile navigation uses bottom sheets instead of squeezing the desktop hotbar. */}
      {showCollectionMenu && (
        <div className="mobileNavSheetBackdrop mobileOnly" onMouseDown={() => setShowCollectionMenu(false)}>
          <section className="mobileNavSheet" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheetHandle" />
            <div className="mobileSheetHeader">
              <div>
                <strong>Collection</strong>
                <small>Choose what you want to manage</small>
              </div>
            </div>
            <div className="mobileSheetGrid">
              <button className={view === "cards" ? "active" : ""} onClick={() => changeView("cards")}><Library size={20} /><span>Cards</span></button>
              <button className={view === "deck" ? "active" : ""} onClick={() => changeView("deck")}><Layers3 size={20} /><span>Decks</span></button>
              <button className={view === "containers" ? "active" : ""} onClick={() => changeView("containers")}><Archive size={20} /><span>Containers</span></button>
              <button className={view === "wishlist" ? "active" : ""} onClick={() => changeView("wishlist")}><Box size={20} /><span>Wishlist</span></button>
            </div>
          </section>
        </div>
      )}

      {showCommunityMenu && (
        <div className="mobileNavSheetBackdrop mobileOnly" onMouseDown={() => setShowCommunityMenu(false)}>
          <section className="mobileNavSheet" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheetHandle" />
            <div className="mobileSheetHeader">
              <div>
                <strong>Community</strong>
                <small>Friends, borrowing, lending and local contacts</small>
              </div>
            </div>
            <div className="mobileActionList">
              <button onClick={() => { setPopup("friends"); setShowCommunityMenu(false) }}><UsersRound size={19} /><div><strong>Friends</strong><small>Borrow, lend, sell and manage friends</small></div><ChevronRight size={17} /></button>
              <button onClick={() => { setPopup("add-friend"); setShowCommunityMenu(false) }}><UserPlus size={19} /><div><strong>Add friend</strong><small>Find another Card Tracker user</small></div><ChevronRight size={17} /></button>
              <button onClick={() => { setPopup("contact"); setShowCommunityMenu(false) }}><Plus size={19} /><div><strong>Create non-user</strong><small>Track someone who does not use the app</small></div><ChevronRight size={17} /></button>
            </div>
          </section>
        </div>
      )}

      {showMainMenu && (
        <div className="mobileNavSheetBackdrop mobileOnly" onMouseDown={() => setShowMainMenu(false)}>
          <section className="mobileNavSheet" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheetHandle" />
            <div className="mobileAccountCard">
              <small>Logged in as</small>
              <strong>{currentUsername || "Account"}</strong>
            </div>
            <div className="mobileActionList">
              <button onClick={() => { setPopup("pending"); setShowMainMenu(false) }}><Clock3 size={19} /><div><strong>Pending</strong><small>Requests waiting for a response</small></div>{pendingCount > 0 && <span className="menuCount">{pendingCount}</span>}</button>
              <button onClick={() => { setPopup("settings"); setShowMainMenu(false) }}><Settings size={19} /><div><strong>Settings</strong><small>Account and display preferences</small></div><ChevronRight size={17} /></button>
              <button onClick={() => { setPopup("history"); setShowMainMenu(false) }}><History size={19} /><div><strong>History</strong><small>Loans, sales and completed activity</small></div><ChevronRight size={17} /></button>
              <button className="mobileDangerAction" onClick={logout}><LogOut size={19} /><div><strong>Log out</strong><small>Sign out of this device</small></div></button>
            </div>
          </section>
        </div>
      )}

      <nav className="mobileBottomNav mobileOnly" aria-label="Primary navigation">
        <button
          className={showCollectionMenu ? "active" : ""}
          onClick={() => {
            setShowCollectionMenu((value) => !value)
            setShowCommunityMenu(false)
            setShowMainMenu(false)
          }}
        >
          <Library size={21} />
          <span>Collection</span>
        </button>

        <button
          className={showCommunityMenu ? "active" : ""}
          onClick={() => {
            setShowCommunityMenu((value) => !value)
            setShowCollectionMenu(false)
            setShowMainMenu(false)
          }}
        >
          <UsersRound size={21} />
          <span>Community</span>
        </button>

        <button className="mobileAddButton" onClick={openAddForCurrentView} aria-label={addLabel}>
          <span><Plus size={24} /></span>
          <small>Add</small>
        </button>

        <button onClick={() => setPopup("notifications")} className="mobileAlertButton">
          <span className="mobileNavIcon">
            <Bell size={21} />
            {notificationCount > 0 && <i>{notificationCount > 9 ? "9+" : notificationCount}</i>}
          </span>
          <span>Alerts</span>
        </button>

        <button
          className={showMainMenu ? "active" : ""}
          onClick={() => {
            setShowMainMenu((value) => !value)
            setShowCollectionMenu(false)
            setShowCommunityMenu(false)
          }}
        >
          <Menu size={21} />
          <span>Menu</span>
        </button>
      </nav>

      {lendingDeck && <LendDeckModal deck={lendingDeck} onClose={() => setLendingDeck(null)} />}
      {popup === "card" && <AddCardModal holders={holders} defaultHolderId={selectedHolder?.id ?? null} defaultMissing={selectedHolder?.type==="deck"||view==="wishlist"} onClose={() => setPopup(null)} />}
      {(popup === "deck" || popup === "container") && <HolderCreateModal type={popup} onClose={() => setPopup(null)} />}
      {popup === "settings" && <SettingsModal onClose={() => setPopup(null)} desktopPanel={desktopPanel} onDesktopPanelChange={value=>{setDesktopPanel(value);savePreferences(userId,"display",{...loadPreferences(userId,"display"),desktopPanel:value})}} />}
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
      {editing && <CardEditorModal key={`${editing.loan_role}-${editing.id}-${editing.loan_transaction_id}`} item={editing} holders={holders} items={items} panel={desktopPanel&&desktop} onClose={() => setEditing(null)} />}
      {acquiring&&<AcquireCardModal key={acquiring.id} available={items.some(item=>item.id===acquiring.id&&item.is_missing&&item.loan_role!=="borrower")} item={items.find(item=>item.id===acquiring.id&&item.is_missing&&item.loan_role!=="borrower")??acquiring} onClose={()=>setAcquiring(null)}/>}
    </div>
  )
}



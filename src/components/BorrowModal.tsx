import { useEffect, useMemo, useState } from "react"
import { Check, HandCoins, Minus, Plus, Search, ShoppingCart, X } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  fetchFriendBorrowableInventory,
  requestBorrowFromFriend,
  requestMissingBorrowCard,
} from "../lib/data"
import { autocompleteCards, cardImage, searchPrintings, type ScryfallCard } from "../lib/scryfall"
import type { Friend } from "../lib/types"
import { CardGridSkeleton } from "./Skeletons"
import { useFeedback } from "./Feedback"

type Cart = Record<number, number>

export function BorrowModal({ friend, onClose }: { friend: Friend; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useFeedback()
  const [cart, setCart] = useState<Cart>({})
  const [missingQuery, setMissingQuery] = useState("")
  const [missingSuggestions, setMissingSuggestions] = useState<string[]>([])
  const [missingPrintings, setMissingPrintings] = useState<ScryfallCard[]>([])
  const [missingSelectedId, setMissingSelectedId] = useState("")
  const [missingQuantity, setMissingQuantity] = useState(1)

  const inventory = useQuery({
    queryKey: ["friend-borrowable", friend.user_id],
    queryFn: () => fetchFriendBorrowableInventory(friend.user_id),
    staleTime: 20_000,
  })

  const rows = inventory.data ?? []
  const selectedRows = useMemo(
    () => rows.filter((item) => cart[item.source_item_id]),
    [rows, cart],
  )

  const missingSelected = useMemo(
    () => missingPrintings.find((card) => card.id === missingSelectedId) ?? null,
    [missingPrintings, missingSelectedId],
  )

  const alreadyAvailable = useMemo(() => {
    if (!missingSelected) return false
    return rows.some(
      (item) => item.card_name.trim().toLowerCase() === missingSelected.name.trim().toLowerCase(),
    )
  }, [missingSelected, rows])

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (missingQuery.trim().length < 2) {
        setMissingSuggestions([])
        return
      }
      try {
        setMissingSuggestions((await autocompleteCards(missingQuery)).slice(0, 8))
      } catch {
        setMissingSuggestions([])
      }
    }, 180)

    return () => window.clearTimeout(timer)
  }, [missingQuery])

  async function chooseMissingName(name: string) {
    setMissingQuery(name)
    setMissingSuggestions([])
    const printings = await searchPrintings(name)
    setMissingPrintings(printings)
    setMissingSelectedId(printings[0]?.id ?? "")
  }

  function toggle(item: (typeof rows)[number]) {
    setCart((current) => {
      const next = { ...current }
      if (next[item.source_item_id]) delete next[item.source_item_id]
      else next[item.source_item_id] = 1
      return next
    })
  }

  function setQuantity(item: (typeof rows)[number], quantity: number) {
    const nextQty = Math.max(1, Math.min(quantity || 1, item.available_quantity))
    setCart((current) => ({ ...current, [item.source_item_id]: nextQty }))
  }

  const send = useMutation({
    mutationFn: async () => {
      if (!selectedRows.length) throw new Error("Choose at least one card.")

      for (const item of selectedRows) {
        await requestBorrowFromFriend({
          ownerUserId: friend.user_id,
          sourceItemId: item.source_item_id,
          quantity: cart[item.source_item_id] ?? 1,
        })
      }
    },
    onSuccess: async () => {
      toast("Borrow request sent")
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["pending"] }),
        qc.invalidateQueries({ queryKey: ["notifications"] }),
        qc.invalidateQueries({ queryKey: ["friend-borrowable", friend.user_id] }),
      ])
      onClose()
    },
  })

  const requestMissing = useMutation({
    mutationFn: async () => {
      if (!missingSelected) throw new Error("Choose a card first.")
      if (alreadyAvailable) throw new Error("That card is already available in this friend's collection.")
      await requestMissingBorrowCard({
        ownerUserId: friend.user_id,
        card: missingSelected,
        quantity: Math.max(1, missingQuantity),
      })
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["pending"] }),
        qc.invalidateQueries({ queryKey: ["notifications"] }),
      ])
      setMissingQuery("")
      setMissingSuggestions([])
      setMissingPrintings([])
      setMissingSelectedId("")
      setMissingQuantity(1)
    },
  })

  const selectedCount = selectedRows.reduce(
    (sum, item) => sum + (cart[item.source_item_id] ?? 0),
    0,
  )

  return (
    <div className="modalBackdrop nestedModal" onMouseDown={onClose}>
      <section className="modal transactionModal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2>Borrow from {friend.username ?? "friend"}</h2>
            <p>Select available cards and send a borrow request. Your friend must approve it.</p>
          </div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modalBody transactionBody">
          {inventory.isLoading ? (
            <CardGridSkeleton count={6} />
          ) : inventory.error ? (
            <p className="errorText">{inventory.error.message}</p>
          ) : !rows.length ? (
            <div className="emptyMini">
              <HandCoins size={28} />
              <strong>No cards available</strong>
              <small>You can request a missing card below.</small>
            </div>
          ) : (
            <div className="transactionCardGrid">
              {rows.map((item) => {
                const selected = Boolean(cart[item.source_item_id])
                return (
                  <button
                    className={`transactionCard ${selected ? "selected" : ""}`}
                    key={item.source_item_id}
                    onClick={() => toggle(item)}
                  >
                    <div className="transactionImageShell">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.card_name} loading="lazy" decoding="async" />
                      ) : (
                        <div className="noImage">No image</div>
                      )}
                      {selected && <span className="cartCheck"><Check size={15} /></span>}
                    </div>
                    <strong>{item.card_name}</strong>
                    <small>{item.available_quantity} available</small>
                    <small>{item.holder_name ?? "Unsorted"}</small>
                  </button>
                )
              })}
            </div>
          )}

          {selectedRows.length > 0 && (
            <section className="cartPanel">
              <div className="cartTitle">
                <ShoppingCart size={17} />
                <strong>Borrow request</strong>
                <span>{selectedCount} card(s)</span>
              </div>

              {selectedRows.map((item) => (
                <div className="cartRow" key={item.source_item_id}>
                  <span>{item.card_name}</span>
                  <div className="qtyStepper">
                    <button onClick={() => setQuantity(item, (cart[item.source_item_id] ?? 1) - 1)}><Minus size={13} /></button>
                    <input
                      type="number"
                      min="1"
                      max={item.available_quantity}
                      value={cart[item.source_item_id] ?? 1}
                      onChange={(event) => setQuantity(item, Number(event.target.value))}
                    />
                    <button onClick={() => setQuantity(item, (cart[item.source_item_id] ?? 1) + 1)}><Plus size={13} /></button>
                  </div>
                  <button className="iconButton" onClick={() => toggle(item)}><X size={14} /></button>
                </div>
              ))}
            </section>
          )}

          {send.error && <p className="errorText">{send.error.message}</p>}

          <button
            className="primaryButton"
            disabled={!selectedRows.length || send.isPending}
            onClick={() => send.mutate()}
          >
            <HandCoins size={15} />
            {send.isPending ? "Sending..." : "Send borrow request"}
          </button>

          <section className="missingBorrowPanel">
            <div className="missingBorrowHeading">
              <div>
                <strong>Card not in their collection?</strong>
                <small>Request it here. It will only be added and loaned to you if your friend accepts the notification.</small>
              </div>
            </div>

            <label>
              Find card
              <div className="suggestWrap">
                <div className="missingBorrowSearchInput">
                  <Search size={16} />
                  <input
                    value={missingQuery}
                    onChange={(event) => {
                      setMissingQuery(event.target.value)
                      setMissingPrintings([])
                      setMissingSelectedId("")
                    }}
                    placeholder="Search a card that is missing..."
                  />
                </div>
                {missingSuggestions.length > 0 && (
                  <div className="suggestions">
                    {missingSuggestions.map((name) => (
                      <button key={name} onClick={() => chooseMissingName(name)}>{name}</button>
                    ))}
                  </div>
                )}
              </div>
            </label>

            {missingPrintings.length > 0 && (
              <div className="missingBorrowSelection">
                <div className="missingBorrowPreview">
                  {missingSelected && cardImage(missingSelected) ? (
                    <img src={cardImage(missingSelected) ?? ""} alt={missingSelected.name} loading="lazy" decoding="async" />
                  ) : (
                    <div className="noImage">No image</div>
                  )}
                </div>

                <div className="missingBorrowFields">
                  <label>
                    Printing
                    <select value={missingSelectedId} onChange={(event) => setMissingSelectedId(event.target.value)}>
                      {missingPrintings.map((card) => (
                        <option key={card.id} value={card.id}>
                          {card.set_name} · {card.set.toUpperCase()} #{card.collector_number}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Quantity
                    <input
                      type="number"
                      min="1"
                      value={missingQuantity}
                      onChange={(event) => setMissingQuantity(Math.max(1, Number(event.target.value) || 1))}
                    />
                  </label>

                  {alreadyAvailable && (
                    <p className="settingsHint">This card is already available above. Select it from the collection instead.</p>
                  )}

                  {requestMissing.error && <p className="errorText">{requestMissing.error.message}</p>}
                  {requestMissing.isSuccess && <p className="successText">Request sent. Your friend will see it in Notifications.</p>}

                  <button
                    className="secondaryButton"
                    disabled={!missingSelected || alreadyAvailable || requestMissing.isPending}
                    onClick={() => requestMissing.mutate()}
                  >
                    <HandCoins size={15} />
                    {requestMissing.isPending ? "Sending..." : "Request missing card"}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  )
}

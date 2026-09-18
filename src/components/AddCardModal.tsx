import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, LoaderCircle, Search, X, XCircle } from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { addCollectionItem } from "../lib/data"
import { autocompleteCards, cardImage, searchPrintings, type ScryfallCard } from "../lib/scryfall"
import type { CollectionItem, Holder } from "../lib/types"

type Props = {
  holders: Holder[]
  onClose: () => void
}

type BulkRow = {
  id: number
  raw: string
  name: string
  quantity: number
  status: "waiting" | "searching" | "found" | "error" | "added"
  card: ScryfallCard | null
  message?: string
}

function parseBulkLines(text: string): BulkRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((raw, index) => {
      const match = raw.match(/^\s*(\d+)\s*[xX]?\s+(.+?)\s*$/)
      return {
        id: index,
        raw,
        quantity: match ? Math.max(1, Number(match[1])) : 1,
        name: match ? match[2].trim() : raw,
        status: "waiting" as const,
        card: null,
      }
    })
}

export function AddCardModal({ holders, onClose }: Props) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<"single" | "bulk">("single")

  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [printings, setPrintings] = useState<ScryfallCard[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [quantity, setQuantity] = useState(1)

  const [condition, setCondition] = useState<CollectionItem["condition"]>("NM")
  const [foil, setFoil] = useState(false)
  const [holderId, setHolderId] = useState<string>("")

  const [bulkText, setBulkText] = useState("")
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([])
  const [bulkSearching, setBulkSearching] = useState(false)
  const [bulkAdding, setBulkAdding] = useState(false)

  useEffect(() => {
    if (mode !== "single") return

    const timer = window.setTimeout(async () => {
      if (query.trim().length < 2) {
        setSuggestions([])
        return
      }
      try {
        setSuggestions((await autocompleteCards(query)).slice(0, 8))
      } catch {
        setSuggestions([])
      }
    }, 180)

    return () => window.clearTimeout(timer)
  }, [query, mode])

  const selected = useMemo(
    () => printings.find((card) => card.id === selectedId) ?? null,
    [printings, selectedId],
  )

  async function chooseName(name: string) {
    setQuery(name)
    setSuggestions([])
    const rows = await searchPrintings(name)
    setPrintings(rows)
    setSelectedId(rows[0]?.id ?? "")
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Choose a printing first")
      await addCollectionItem({
        card: selected,
        quantity: Math.max(1, quantity),
        condition,
        foil,
        holder_id: holderId ? Number(holderId) : null,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["collection"] })
      onClose()
    },
  })

  async function searchBulk() {
    const parsed = parseBulkLines(bulkText)
    setBulkRows(parsed)
    if (!parsed.length) return

    setBulkSearching(true)
    const working = [...parsed]

    for (let index = 0; index < working.length; index += 1) {
      working[index] = { ...working[index], status: "searching", message: undefined }
      setBulkRows([...working])

      try {
        const printings = await searchPrintings(working[index].name)
        if (!printings.length) {
          working[index] = {
            ...working[index],
            status: "error",
            message: "No printing found",
          }
        } else {
          working[index] = {
            ...working[index],
            status: "found",
            card: printings[0],
            message: `${printings[0].set_name} #${printings[0].collector_number}`,
          }
        }
      } catch (error) {
        working[index] = {
          ...working[index],
          status: "error",
          message: error instanceof Error ? error.message : "Search failed",
        }
      }

      setBulkRows([...working])

      // A short gap keeps bulk searches polite to Scryfall while the UI stays responsive.
      if (index < working.length - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 90))
      }
    }

    setBulkSearching(false)
  }

  async function addBulkFound() {
    const found = bulkRows.filter((row) => row.status === "found" && row.card)
    if (!found.length) return

    setBulkAdding(true)
    const working = [...bulkRows]

    for (const row of found) {
      const index = working.findIndex((candidate) => candidate.id === row.id)
      if (index < 0 || !row.card) continue

      try {
        await addCollectionItem({
          card: row.card,
          quantity: row.quantity,
          condition,
          foil,
          holder_id: holderId ? Number(holderId) : null,
        })
        working[index] = { ...working[index], status: "added", message: "Added" }
      } catch (error) {
        working[index] = {
          ...working[index],
          status: "error",
          message: error instanceof Error ? error.message : "Add failed",
        }
      }
      setBulkRows([...working])
    }

    await queryClient.invalidateQueries({ queryKey: ["collection"] })
    setBulkAdding(false)
  }

  const bulkDone = bulkRows.filter((row) => row.status === "found" || row.status === "error" || row.status === "added").length
  const bulkProgress = bulkRows.length ? Math.round((bulkDone / bulkRows.length) * 100) : 0
  const foundCount = bulkRows.filter((row) => row.status === "found").length

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal addCardModal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2>Add card</h2>
            <p>Add one card or search a whole list.</p>
          </div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modalTabs">
          <button className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}>Single</button>
          <button className={mode === "bulk" ? "active" : ""} onClick={() => setMode("bulk")}>Bulk add</button>
        </div>

        <div className="modalBody">
          {mode === "single" ? (
            <>
              <label>
                Card
                <div className="suggestWrap">
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Start typing a card name..."
                  />
                  {suggestions.length > 0 && (
                    <div className="suggestions">
                      {suggestions.map((name) => (
                        <button key={name} onClick={() => chooseName(name)}>{name}</button>
                      ))}
                    </div>
                  )}
                </div>
              </label>

              {printings.length > 0 && (
                <>
                  <label>
                    Printing
                    <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                      {printings.map((card) => (
                        <option key={card.id} value={card.id}>
                          {card.set_name} · {card.set.toUpperCase()} #{card.collector_number}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selected && cardImage(selected) && (
                    <img
                      className="previewCard"
                      src={cardImage(selected) ?? ""}
                      alt={selected.name}
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                </>
              )}

              <div className="formGrid">
                <label>
                  Quantity
                  <input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(event) => setQuantity(Number(event.target.value))}
                  />
                </label>

                <ConditionSelect condition={condition} onChange={setCondition} />
              </div>
            </>
          ) : (
            <>
              <label>
                Bulk list
                <textarea
                  className="bulkTextarea"
                  value={bulkText}
                  onChange={(event) => setBulkText(event.target.value)}
                  placeholder={"4 Lightning Bolt\n1 Sol Ring\n2 Counterspell"}
                />
              </label>
              <p className="settingsHint">Use one card per line. Quantity is optional; examples: “4 Lightning Bolt” or “1x Sol Ring”. The newest printing found is selected automatically.</p>

              <div className="bulkActions">
                <button className="secondaryButton" disabled={bulkSearching || bulkAdding || !bulkText.trim()} onClick={searchBulk}>
                  {bulkSearching ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />}
                  {bulkSearching ? "Searching..." : "Search cards"}
                </button>
                <button className="primaryButton" disabled={!foundCount || bulkSearching || bulkAdding} onClick={addBulkFound}>
                  {bulkAdding ? <LoaderCircle className="spin" size={15} /> : null}
                  {bulkAdding ? "Adding..." : `Add ${foundCount} found`}
                </button>
              </div>

              {bulkRows.length > 0 && (
                <div className="bulkProgressBlock">
                  <div className="bulkProgressHeader">
                    <span>{bulkSearching ? "Searching Scryfall" : "Search results"}</span>
                    <strong>{bulkProgress}%</strong>
                  </div>
                  <div className="progressTrack"><span style={{ width: `${bulkProgress}%` }} /></div>

                  <div className="bulkResults">
                    {bulkRows.map((row) => (
                      <div className="bulkRow" key={row.id}>
                        <span className="bulkStatusIcon">
                          {row.status === "searching" && <LoaderCircle className="spin" size={16} />}
                          {row.status === "found" && <CheckCircle2 size={16} />}
                          {row.status === "added" && <CheckCircle2 size={16} />}
                          {row.status === "error" && <XCircle size={16} />}
                          {row.status === "waiting" && <span className="waitingDot" />}
                        </span>
                        <div>
                          <strong>{row.quantity}× {row.name}</strong>
                          <small>{row.status === "waiting" ? "Waiting" : row.message || row.status}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <ConditionSelect condition={condition} onChange={setCondition} />
            </>
          )}

          <label>
            Local holder
            <select value={holderId} onChange={(event) => setHolderId(event.target.value)}>
              <option value="">My Collection</option>
              <optgroup label="Decks">
                {holders.filter((holder) => holder.type === "deck").map((holder) => (
                  <option key={holder.id} value={holder.id}>{holder.name}</option>
                ))}
              </optgroup>
              <optgroup label="Binders">
                {holders.filter((holder) => holder.type === "binder").map((holder) => (
                  <option key={holder.id} value={holder.id}>{holder.name}</option>
                ))}
              </optgroup>
              <optgroup label="Boxes">
                {holders.filter((holder) => holder.type === "box").map((holder) => (
                  <option key={holder.id} value={holder.id}>{holder.name}</option>
                ))}
              </optgroup>
            </select>
          </label>

          <label className="checkRow">
            <input type="checkbox" checked={foil} onChange={(event) => setFoil(event.target.checked)} />
            Foil
          </label>

          {mode === "single" && mutation.error && <p className="errorText">{mutation.error.message}</p>}

          {mode === "single" && (
            <button
              className="primaryButton"
              disabled={!selected || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Adding..." : "Add card"}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function ConditionSelect({
  condition,
  onChange,
}: {
  condition: CollectionItem["condition"]
  onChange: (condition: CollectionItem["condition"]) => void
}) {
  return (
    <label>
      Condition
      <select value={condition} onChange={(event) => onChange(event.target.value as CollectionItem["condition"])}>
        <option>NM</option>
        <option>LP</option>
        <option>MP</option>
        <option>HP</option>
        <option>DMG</option>
      </select>
    </label>
  )
}

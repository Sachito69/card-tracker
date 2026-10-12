import { useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, LoaderCircle, Search, X, XCircle } from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { addCollectionItem } from "../lib/data"
import { searchCards, cardImage, searchPrintings, type ScryfallCard } from "../lib/scryfall"
import type { CollectionItem, Holder } from "../lib/types"

type Props = {
  holders: Holder[]
  defaultHolderId?: number | null
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

export function AddCardModal({ holders, defaultHolderId = null, onClose }: Props) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<"single" | "bulk">("single")

  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<ScryfallCard[]>([])
  const [printings, setPrintings] = useState<ScryfallCard[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [chosenName, setChosenName] = useState("")
  const [searching, setSearching] = useState(false)
  const [loadingPrintings, setLoadingPrintings] = useState(false)
  const [lookupError, setLookupError] = useState("")
  const [searchAttempt, setSearchAttempt] = useState(0)
  const printingRequest = useRef(0)

  const [condition, setCondition] = useState<CollectionItem["condition"]>("NM")
  const [foil, setFoil] = useState(false)
  const [holderId, setHolderId] = useState<string>(defaultHolderId ? String(defaultHolderId) : "")

  const [bulkText, setBulkText] = useState("")
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([])
  const [bulkSearching, setBulkSearching] = useState(false)
  const [bulkAdding, setBulkAdding] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (mode !== "single" || chosenName || query.trim().length < 2) {
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = window.setTimeout(async () => {
      try {
        const results = await searchCards(query)
        if (!cancelled) setSuggestions(results)
      } catch (error) {
        if (!cancelled) setLookupError(error instanceof Error ? error.message : "Search failed")
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)

    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query, mode, chosenName, searchAttempt])

  useEffect(() => () => { printingRequest.current += 1 }, [mode])

  function changeQuery(value: string) {
    printingRequest.current += 1
    setQuery(value)
    setChosenName("")
    setSuggestions([])
    setPrintings([])
    setSelectedId("")
    setLoadingPrintings(false)
    setLookupError("")
  }

  const selected = useMemo(
    () => printings.find((card) => card.id === selectedId) ?? null,
    [printings, selectedId],
  )

  async function chooseName(name: string) {
    const request = ++printingRequest.current
    setQuery(name)
    setChosenName(name)
    setSuggestions([])
    setPrintings([])
    setSelectedId("")
    setLookupError("")
    setLoadingPrintings(true)
    try {
      const rows = await searchPrintings(name)
      if (request !== printingRequest.current) return
      setPrintings(rows)
      setSelectedId(rows[0]?.id ?? "")
      if (!rows.length) setLookupError("No printings found. Try another card.")
    } catch (error) {
      if (request === printingRequest.current) setLookupError(error instanceof Error ? error.message : "Could not load printings")
    } finally {
      if (request === printingRequest.current) setLoadingPrintings(false)
    }
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
          <button className={mode === "bulk" ? "active" : ""} onClick={() => {
            if (loadingPrintings) changeQuery(query)
            printingRequest.current += 1
            setMode("bulk")
          }}>Bulk add</button>
        </div>

        <div className="modalBody">
          {mode === "single" ? (
            <>
              <label>
                Card
                <div className="cardSearchInput">
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => changeQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && suggestions[0] && !searching) {
                        event.preventDefault()
                        void chooseName(suggestions[0].name)
                      }
                    }}
                    aria-controls="card-lookup-results"
                    placeholder="Start typing a card name..."
                  />
                  {query && <button className="iconButton" aria-label="Clear card search" onClick={() => changeQuery("")}><X size={16} /></button>}
                </div>
              </label>

              <div className="cardLookupPanel" id="card-lookup-results" aria-busy={searching || loadingPrintings}>
                <div className="lookupHeading">
                  <strong>{chosenName ? "Choose a printing" : "Search results"}</strong>
                  <span role="status">{loadingPrintings ? "Loading printings…" : searching ? "Searching…" : chosenName ? `${printings.length} printings` : `${suggestions.length} results`}</span>
                </div>
                <div className="lookupScroll">
                  {lookupError ? (
                    <div className="lookupMessage" role="alert">
                      <p className="errorText">{lookupError}</p>
                      <button className="secondaryButton" onClick={() => {
                        if (chosenName) void chooseName(chosenName)
                        else { setLookupError(""); setSearchAttempt((attempt) => attempt + 1) }
                      }}>Retry</button>
                    </div>
                  ) : searching || loadingPrintings ? (
                    <div className="lookupMessage"><LoaderCircle className="spin" size={24} /><p>{loadingPrintings ? "Finding available editions" : "Finding cards"}</p></div>
                  ) : chosenName ? (
                    <div className="printingGrid" role="group" aria-label="Available printings">
                      {printings.map((card) => (
                        <button
                          className={selectedId === card.id ? "printingOption selected" : "printingOption"}
                          key={card.id}
                          aria-pressed={selectedId === card.id}
                          aria-label={`${card.name}, ${card.set_name}, #${card.collector_number}`}
                          onClick={() => setSelectedId(card.id)}
                        >
                          <div className="printingArt">
                            {cardImage(card) ? <img src={cardImage(card)!} alt={card.name} loading="lazy" decoding="async" /> : <span>No artwork</span>}
                            {selectedId === card.id && <CheckCircle2 className="printingCheck" size={20} />}
                          </div>
                          <strong title={card.set_name}>{card.set_name}</strong>
                          <small>{card.set.toUpperCase()} · #{card.collector_number}</small>
                        </button>
                      ))}
                    </div>
                  ) : suggestions.length ? (
                    <div className="cardSearchResults">
                      {suggestions.map((card) => (
                        <button className="cardSearchResult" key={card.id} onClick={() => void chooseName(card.name)}>
                          <div className="searchResultArt">{cardImage(card) ? <img src={cardImage(card)!} alt="" loading="lazy" /> : <span>?</span>}</div>
                          <div><strong>{card.name}</strong><small>{card.type_line}</small></div>
                        </button>
                      ))}
                    </div>
                  ) : <div className="lookupMessage"><Search size={24} /><p>{query.trim().length >= 2 ? "No cards found. Try another name." : "Type at least two letters to see card artwork."}</p></div>}
                </div>
                <div className="selectedPrintingSummary" title={selected ? `${selected.name} · ${selected.set_name} #${selected.collector_number}` : undefined}>
                  {selected ? `${selected.name} · ${selected.set_name} #${selected.collector_number}` : "Select a card, then its edition. The newest edition is selected for you."}
                </div>
              </div>

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
              <option value="">Unsorted</option>
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
        </div>
        {mode === "single" && (
          <footer className="addCardFooter">
            <button
              className="primaryButton"
              disabled={!selected || loadingPrintings || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Adding..." : "Add card"}
            </button>
          </footer>
        )}
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


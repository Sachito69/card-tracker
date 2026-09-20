import { X } from "lucide-react"
import { DECK_FORMATS } from "../lib/formats"

export type FilterContext = "cards" | "deck" | "binder" | "box"

export type TrackerFilters = {
  colors: string[]
  commanderColors: string[]
  cardType: string
  manaValue: string
  deckFormat: string
}

export const EMPTY_FILTERS: TrackerFilters = {
  colors: [],
  commanderColors: [],
  cardType: "",
  manaValue: "",
  deckFormat: "",
}

const COLORS = [
  ["W", "White"],
  ["U", "Blue"],
  ["B", "Black"],
  ["R", "Red"],
  ["G", "Green"],
  ["C", "Colorless"],
] as const

function Checks({
  values,
  onToggle,
}: {
  values: string[]
  onToggle: (value: string) => void
}) {
  return (
    <div className="namedColorChecks">
      {COLORS.map(([value, label]) => (
        <label className="namedColorCheck" key={value}>
          <input
            type="checkbox"
            checked={values.includes(value)}
            onChange={() => onToggle(value)}
          />
          <span className={`manaDot mana-${value}`}>{value}</span>
          <span>{label}</span>
        </label>
      ))}
    </div>
  )
}

export function FilterModal({
  context,
  filters,
  onChange,
  cardTypes,
  onClose,
}: {
  context: FilterContext
  filters: TrackerFilters
  onChange: (next: TrackerFilters) => void
  cardTypes: string[]
  onClose: () => void
}) {
  const toggle = (field: "colors" | "commanderColors", value: string) => {
    const current = filters[field]
    const next = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value]
    onChange({ ...filters, [field]: next })
  }

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal smallModal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2>Filters</h2>
            <p>
              {context === "cards"
                ? "Filter your card tracker locally."
                : context === "deck"
                  ? "Filter decks by format."
                  : "More filters will be added here later."}
            </p>
          </div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modalBody">
          {context === "cards" && (
            <>
              <div className="filterSection">
                <strong>Colors</strong>
                <Checks values={filters.colors} onToggle={(value) => toggle("colors", value)} />
              </div>

              <div className="filterSection">
                <strong>Commander</strong>
                <p className="filterHint">
                  Shows cards whose color identity fits inside the selected commander colors.
                </p>
                <Checks
                  values={filters.commanderColors}
                  onToggle={(value) => toggle("commanderColors", value)}
                />
              </div>

              <label>
                Card type
                <select
                  value={filters.cardType}
                  onChange={(event) => onChange({ ...filters, cardType: event.target.value })}
                >
                  <option value="">Any card type</option>
                  {cardTypes.map((type) => (
                    <option value={type} key={type}>{type}</option>
                  ))}
                </select>
              </label>

              <label>
                Mana value
                <select
                  value={filters.manaValue}
                  onChange={(event) => onChange({ ...filters, manaValue: event.target.value })}
                >
                  <option value="">Any mana value</option>
                  {[0,1,2,3,4,5,6].map((value) => (
                    <option value={String(value)} key={value}>{value}</option>
                  ))}
                  <option value="7+">7+</option>
                </select>
              </label>
            </>
          )}

          {context === "deck" && (
            <label>
              Format
              <select
                value={filters.deckFormat}
                onChange={(event) => onChange({ ...filters, deckFormat: event.target.value })}
              >
                <option value="">Any format</option>
                {DECK_FORMATS.map((format) => (
                  <option value={format} key={format}>{format}</option>
                ))}
                <option value="__none__">Unspecified</option>
              </select>
            </label>
          )}

          {(context === "binder" || context === "box") && (
            <div className="workingNotice">
              <strong>No filters yet</strong>
              <p>Still working on filters for {context === "binder" ? "binders" : "boxes"}.</p>
            </div>
          )}

          <div className="modalFooterButtons">
            <button className="secondaryButton" onClick={() => onChange(EMPTY_FILTERS)}>
              Clear filters
            </button>
            <button className="primaryButton" onClick={onClose}>Done</button>
          </div>
        </div>
      </section>
    </div>
  )
}

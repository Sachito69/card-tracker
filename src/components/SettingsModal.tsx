import { useEffect, useState } from "react"
import { X } from "lucide-react"

type Density = "comfortable" | "compact"

export function applySavedDensity() {
  const density = (localStorage.getItem("tracker-density") || "comfortable") as Density
  document.documentElement.dataset.density = density
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [density, setDensity] = useState<Density>(
    (localStorage.getItem("tracker-density") || "comfortable") as Density,
  )

  useEffect(() => {
    document.documentElement.dataset.density = density
    localStorage.setItem("tracker-density", density)
  }, [density])

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal smallModal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2>Settings</h2>
            <p>Small local preferences for the tracker.</p>
          </div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modalBody">
          <label>
            Card grid density
            <select value={density} onChange={(event) => setDensity(event.target.value as Density)}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <p className="settingsHint">This setting is saved only in this browser.</p>
        </div>
      </section>
    </div>
  )
}

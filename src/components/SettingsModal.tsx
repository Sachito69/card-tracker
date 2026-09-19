import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchCurrentProfile, updateUsername } from "../lib/data"

type Density = "comfortable" | "compact"

export function applySavedDensity() {
  const density = (localStorage.getItem("tracker-density") || "comfortable") as Density
  document.documentElement.dataset.density = density
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const profile = useQuery({ queryKey: ["profile"], queryFn: fetchCurrentProfile })
  const [username, setUsername] = useState("")
  const [density, setDensity] = useState<Density>((localStorage.getItem("tracker-density") || "comfortable") as Density)

  useEffect(() => { if (profile.data?.username != null) setUsername(profile.data.username) }, [profile.data?.username])
  useEffect(() => {
    document.documentElement.dataset.density = density
    localStorage.setItem("tracker-density", density)
  }, [density])

  const saveUsername = useMutation({
    mutationFn: () => updateUsername(username),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["profile"] }) },
  })

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal smallModal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div><h2>Settings</h2><p>Account and local tracker preferences.</p></div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="modalBody">
          <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="username" /></label>
          <button className="secondaryButton" disabled={saveUsername.isPending || !username.trim()} onClick={() => saveUsername.mutate()}>{saveUsername.isPending ? "Saving..." : "Save username"}</button>
          {saveUsername.isSuccess && <p className="settingsHint">Username saved.</p>}
          {saveUsername.error && <p className="errorText">{saveUsername.error.message}</p>}
          <label>Card grid density<select value={density} onChange={(event) => setDensity(event.target.value as Density)}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
          <p className="settingsHint">Grid density is saved only in this browser.</p>
        </div>
      </section>
    </div>
  )
}

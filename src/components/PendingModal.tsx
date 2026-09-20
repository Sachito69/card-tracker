import { Trash2, X } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { deletePending, fetchPendingOutgoing } from "../lib/data"
import type { PendingItem } from "../lib/types"

export function PendingModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const pending = useQuery({
    queryKey: ["pending"],
    queryFn: fetchPendingOutgoing,
    staleTime: 15_000,
  })

  const remove = useMutation({
    mutationFn: (item: PendingItem) => deletePending(item),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["pending"] }),
        qc.invalidateQueries({ queryKey: ["collection"] }),
        qc.invalidateQueries({ queryKey: ["history"] }),
      ])
    },
  })

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2>Pending</h2>
            <p>Requests you sent that have not been accepted yet.</p>
          </div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modalBody">
          {pending.isLoading && <p className="settingsHint">Loading pending requests...</p>}
          {!pending.isLoading && !(pending.data ?? []).length && (
            <p className="settingsHint">Nothing pending.</p>
          )}

          {(pending.data ?? []).map((item) => (
            <div className="pendingRow" key={`${item.kind}-${item.id}`}>
              <div>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
              <button
                className="dangerButton"
                disabled={remove.isPending}
                onClick={() => remove.mutate(item)}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          ))}

          {remove.error && <p className="errorText">{remove.error.message}</p>}
        </div>
      </section>
    </div>
  )
}

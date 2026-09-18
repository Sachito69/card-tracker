import { X } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { fetchTransactionHistory } from "../lib/data"

export function HistoryModal({ onClose }: { onClose: () => void }) {
  const history = useQuery({
    queryKey: ["history"],
    queryFn: fetchTransactionHistory,
    staleTime: 30_000,
  })

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2>History</h2>
            <p>Recent loan and sale activity.</p>
          </div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modalBody historyBody">
          {history.isLoading && <p className="settingsHint">Loading history...</p>}
          {history.error && <p className="errorText">{history.error.message}</p>}
          {!history.isLoading && !history.error && history.data?.length === 0 && (
            <p className="settingsHint">No loan or sale history yet.</p>
          )}

          {(history.data ?? []).map((row) => (
            <article className="historyItem" key={row.id}>
              <div>
                <strong>{row.card_name}</strong>
                <small>{row.transaction_type === "loan" ? "Loan" : "Sale"} · ×{row.quantity}</small>
              </div>
              <div className="historyStatus">
                <span>{row.status}</span>
                <small>{new Date(row.created_at).toLocaleString()}</small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

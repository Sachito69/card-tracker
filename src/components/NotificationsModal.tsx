import { Check, X, XCircle } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchNotifications, respondFriendRequest, respondLoanReturn, respondUserTransaction } from "../lib/data"
import type { NotificationItem } from "../lib/types"

export function NotificationsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ["notifications"], queryFn: fetchNotifications, refetchInterval: 30_000 })

  const act = useMutation({
    mutationFn: async ({ item, accept }: { item: NotificationItem; accept: boolean }) => {
      if (item.kind === "friend") return respondFriendRequest(item.id, accept)
      if (item.kind === "return") return respondLoanReturn(item.id, accept)
      return respondUserTransaction(item.id, accept)
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["notifications"] }),
        qc.invalidateQueries({ queryKey: ["friends"] }),
        qc.invalidateQueries({ queryKey: ["collection"] }),
        qc.invalidateQueries({ queryKey: ["history"] }),
      ])
    },
  })

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div><h2>Notifications</h2><p>Friend, loan, sale, and return requests.</p></div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="modalBody notificationList">
          {query.isLoading && <p className="settingsHint">Loading notifications...</p>}
          {!query.isLoading && !(query.data ?? []).length && <div className="emptyMini"><Check size={28} /><strong>All caught up</strong><small>No pending requests.</small></div>}
          {(query.data ?? []).map((item) => (
            <div className="notificationRow" key={`${item.kind}-${item.id}`}>
              <div>
                {item.kind === "friend" ? (
                  <><strong>Friend request</strong><small>@{item.from_username ?? "user"} wants to add you.</small></>
                ) : item.kind === "return" ? (
                  <><strong>Return request</strong><small>@{item.other_username ?? "user"} is returning {item.quantity}× {item.card_name}.</small></>
                ) : (
                  <>
                    <strong>{item.kind === "loan" ? "Loan request" : "Sale request"}</strong>
                    <small>@{item.other_username ?? "user"} · {item.quantity}× {item.card_name}{item.kind === "sale" && item.price_per_card != null ? ` · ₱${item.price_per_card}/card` : ""}</small>
                  </>
                )}
              </div>
              <div className="rowActions">
                <button className="secondaryButton" disabled={act.isPending} onClick={() => act.mutate({ item, accept: false })}><XCircle size={14} /> Decline</button>
                <button className="primaryButton" disabled={act.isPending} onClick={() => act.mutate({ item, accept: true })}><Check size={14} /> {item.kind === "return" ? "Confirm" : "Accept"}</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

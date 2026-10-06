import { useState } from "react"
import { ArrowRight, UserRoundCheck, X } from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { migrateContactToUser } from "../lib/data"
import type { Contact, Friend } from "../lib/types"
import { useFeedback } from "./Feedback"

export function MigrateContactModal({
  contact,
  friends,
  onClose,
}: {
  contact: Contact
  friends: Friend[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { confirm, toast } = useFeedback()
  const [targetUserId, setTargetUserId] = useState("")

  const migrate = useMutation({
    mutationFn: () => migrateContactToUser(contact.id, targetUserId),
    onSuccess: async () => {
      toast(`${contact.name} migrated successfully`)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["contacts"] }),
        qc.invalidateQueries({ queryKey: ["friends"] }),
        qc.invalidateQueries({ queryKey: ["collection"] }),
        qc.invalidateQueries({ queryKey: ["history"] }),
        qc.invalidateQueries({ queryKey: ["notifications"] }),
      ])
      onClose()
    },
  })

  const target = friends.find((friend) => friend.user_id === targetUserId)

  return (
    <div className="modalBackdrop nestedModal" onMouseDown={onClose}>
      <section className="modal smallModal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2>Migrate {contact.name}</h2>
            <p>Transfer this local contact&apos;s transaction history to a registered friend.</p>
          </div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modalBody">
          <div className="migrationFlow">
            <div className="migrationPerson">
              <span className="friendAvatar localAvatar">{contact.name.slice(0, 1).toUpperCase()}</span>
              <div><strong>{contact.name}</strong><small>Non-user contact</small></div>
            </div>
            <ArrowRight size={20} />
            <div className="migrationPerson">
              <span className="friendAvatar">{(target?.username ?? "?").slice(0, 1).toUpperCase()}</span>
              <div><strong>{target?.username ?? "Choose a user"}</strong><small>Registered friend</small></div>
            </div>
          </div>

          <label>
            Migrate to
            <select value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)}>
              <option value="">Select a registered friend</option>
              {friends.map((friend) => (
                <option value={friend.user_id} key={friend.user_id}>{friend.username ?? "user"}</option>
              ))}
            </select>
          </label>

          <div className="workingNotice migrationWarning">
            <strong>This is permanent</strong>
            <p>All loans and sales linked to {contact.name} will be reassigned to the selected user, then the local contact will be removed.</p>
          </div>

          {migrate.error && <p className="errorText">{migrate.error.message}</p>}

          <button
            className="primaryButton"
            disabled={!targetUserId || migrate.isPending}
            onClick={async () => {
              const approved = await confirm({
                title: `Migrate ${contact.name}?`,
                description: `All transactions will be reassigned to ${target?.username ?? "the selected user"} and the local contact will be removed.`,
                confirmLabel: "Migrate contact",
                tone: "danger",
              })
              if (approved) migrate.mutate()
            }}
          >
            <UserRoundCheck size={15} />
            {migrate.isPending ? "Migrating..." : "Migrate contact"}
          </button>
        </div>
      </section>
    </div>
  )
}

import { useState } from "react"
import { Trash2, X } from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { deleteCollectionItem, updateCollectionItem } from "../lib/data"
import type { CollectionItem, Holder } from "../lib/types"

type Props = {
  item: CollectionItem
  holders: Holder[]
  onClose: () => void
}

export function CardEditorModal({ item, holders, onClose }: Props) {
  const queryClient = useQueryClient()
  const [quantity, setQuantity] = useState(item.quantity)
  const [condition, setCondition] = useState(item.condition)
  const [foil, setFoil] = useState(item.foil)
  const [holderId, setHolderId] = useState(item.holder_id?.toString() ?? "")

  const save = useMutation({
    mutationFn: async () => {
      await updateCollectionItem(item.id, {
        quantity: Math.max(1, quantity),
        condition,
        foil,
        holder_id: holderId ? Number(holderId) : null,
      })
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["collection"] })
      const previous = queryClient.getQueryData<CollectionItem[]>(["collection"])

      queryClient.setQueryData<CollectionItem[]>(["collection"], (rows = []) =>
        rows.map((row) =>
          row.id === item.id
            ? {
                ...row,
                quantity: Math.max(1, quantity),
                condition,
                foil,
                holder_id: holderId ? Number(holderId) : null,
                holder: holderId
                  ? holders.find((holder) => holder.id === Number(holderId)) ?? null
                  : null,
              }
            : row,
        ),
      )

      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["collection"], context.previous)
      }
    },
    onSuccess: onClose,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["collection"] }),
  })

  const remove = useMutation({
    mutationFn: () => deleteCollectionItem(item.id),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["collection"] })
      const previous = queryClient.getQueryData<CollectionItem[]>(["collection"])
      queryClient.setQueryData<CollectionItem[]>(["collection"], (rows = []) =>
        rows.filter((row) => row.id !== item.id),
      )
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(["collection"], context.previous)
    },
    onSuccess: onClose,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["collection"] }),
  })

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modal smallModal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2>{item.card.name}</h2>
            <p>{item.card.set_name}</p>
          </div>
          <button className="iconButton" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modalBody">
          <div className="formGrid">
            <label>
              Quantity
              <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
            </label>

            <label>
              Condition
              <select value={condition} onChange={(e) => setCondition(e.target.value as CollectionItem["condition"])}>
                <option>NM</option>
                <option>LP</option>
                <option>MP</option>
                <option>HP</option>
                <option>DMG</option>
              </select>
            </label>
          </div>

          <label>
            Holder
            <select value={holderId} onChange={(e) => setHolderId(e.target.value)}>
              <option value="">My Collection</option>
              <optgroup label="Decks">
                {holders.filter((h) => h.type === "deck").map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </optgroup>
              <optgroup label="Binders">
                {holders.filter((h) => h.type === "binder").map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </optgroup>
              <optgroup label="Boxes">
                {holders.filter((h) => h.type === "box").map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </optgroup>
            </select>
          </label>

          <label className="checkRow">
            <input type="checkbox" checked={foil} onChange={(e) => setFoil(e.target.checked)} />
            Foil
          </label>

          {(save.error || remove.error) && (
            <p className="errorText">{save.error?.message ?? remove.error?.message}</p>
          )}

          <div className="editorActions">
            <button
              className="dangerButton"
              disabled={remove.isPending}
              onClick={() => {
                if (confirm(`Remove ${item.card.name} from your tracker?`)) remove.mutate()
              }}
            >
              <Trash2 size={15} /> Remove
            </button>
            <button className="primaryButton" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

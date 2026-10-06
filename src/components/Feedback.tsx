import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

type ToastTone = "success" | "error" | "info"

type ToastItem = {
  id: number
  message: string
  tone: ToastTone
}

type ConfirmOptions = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: "default" | "danger"
}

type FeedbackApi = {
  toast: (message: string, tone?: ToastTone) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const FeedbackContext = createContext<FeedbackApi | null>(null)

export function useFeedback() {
  const value = useContext(FeedbackContext)
  if (!value) throw new Error("useFeedback must be used inside FeedbackProvider")
  return value
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null)
  const confirmResolver = useRef<((value: boolean) => void) | null>(null)
  const nextToastId = useRef(1)

  const toast = useCallback((message: string, tone: ToastTone = "success") => {
    const id = nextToastId.current++
    setToasts((current) => [...current, { id, message, tone }])

    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
    }, 3200)
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      confirmResolver.current?.(false)
      confirmResolver.current = resolve
      setConfirmState(options)
    })
  }, [])

  const finishConfirm = useCallback((value: boolean) => {
    confirmResolver.current?.(value)
    confirmResolver.current = null
    setConfirmState(null)
  }, [])

  const api = useMemo(() => ({ toast, confirm }), [toast, confirm])

  return (
    <FeedbackContext.Provider value={api}>
      {children}

      <div className="toastViewport" aria-live="polite" aria-atomic="false">
        {toasts.map((item) => (
          <div className={`appToast toast-${item.tone}`} key={item.id}>
            {item.tone === "success" ? (
              <CheckCircle2 size={18} />
            ) : item.tone === "error" ? (
              <XCircle size={18} />
            ) : (
              <Info size={18} />
            )}
            <span>{item.message}</span>
            <button
              className="toastClose"
              aria-label="Dismiss"
              onClick={() =>
                setToasts((current) => current.filter((entry) => entry.id !== item.id))
              }
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>

      {confirmState && (
        <div
          className="confirmBackdrop"
          role="presentation"
          onMouseDown={() => finishConfirm(false)}
        >
          <section
            className="confirmDialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={`confirmIcon ${confirmState.tone === "danger" ? "danger" : ""}`}>
              <AlertTriangle size={22} />
            </div>
            <div className="confirmCopy">
              <h3 id="confirm-title">{confirmState.title}</h3>
              {confirmState.description && <p>{confirmState.description}</p>}
            </div>
            <div className="confirmActions">
              <button className="secondaryButton" onClick={() => finishConfirm(false)}>
                {confirmState.cancelLabel ?? "Cancel"}
              </button>
              <button
                className={confirmState.tone === "danger" ? "dangerButton" : "primaryButton"}
                onClick={() => finishConfirm(true)}
              >
                {confirmState.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </section>
        </div>
      )}
    </FeedbackContext.Provider>
  )
}

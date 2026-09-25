import { useEffect, useRef, useState } from "react"
import type { Session } from "@supabase/supabase-js"
import { useQueryClient } from "@tanstack/react-query"
import { supabase } from "./lib/supabase"
import { Auth } from "./components/Auth"
import { Tracker } from "./components/Tracker"

export default function App() {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const lastUserId = useRef<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      lastUserId.current = data.session?.user.id ?? null
      setSession(data.session)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null

      if (lastUserId.current !== nextUserId) {
        queryClient.clear()
        lastUserId.current = nextUserId
      }

      setSession(nextSession)
    })

    return () => data.subscription.unsubscribe()
  }, [queryClient])

  if (session === undefined) {
    return (
      <main className="authPage">
        <div className="authCard">Loading...</div>
      </main>
    )
  }

  return session ? <Tracker userId={session.user.id} /> : <Auth />
}

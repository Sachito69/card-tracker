import { useEffect, useState } from "react"
import type { Session } from "@supabase/supabase-js"
import { supabase } from "./lib/supabase"
import { Auth } from "./components/Auth"
import { Tracker } from "./components/Tracker"

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return <main className="authPage"><div className="authCard">Loading...</div></main>
  }

  return session ? <Tracker /> : <Auth />
}

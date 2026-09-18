import { useState } from "react"
import { supabase } from "../lib/supabase"

export function Auth() {
  const [mode, setMode] = useState<"login" | "signup">("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setMessage("")

    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })

    if (result.error) setMessage(result.error.message)
    else if (mode === "signup") setMessage("Account created. Check your email if confirmation is enabled.")

    setBusy(false)
  }

  return (
    <main className="authPage">
      <section className="authCard">
        <h1>MTG Card Tracker</h1>
        <p>Fast, simple inventory tracking.</p>

        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>

        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>

        {message && <p className="authMessage">{message}</p>}

        <button className="primaryButton" disabled={busy || !email || !password} onClick={submit}>
          {busy ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}
        </button>

        <button className="textButton" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
        </button>
      </section>
    </main>
  )
}

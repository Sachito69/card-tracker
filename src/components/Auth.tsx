import { useState } from "react"
import { supabase } from "../lib/supabase"

const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/

export function Auth() {
  const [mode, setMode] = useState<"login" | "signup">("login")
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    setMessage("")

    if (mode === "signup" && !USERNAME_RE.test(username.trim())) {
      setMessage("Username must be 3–24 characters using letters, numbers, or _. ")
      return
    }

    setBusy(true)

    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({
          email,
          password,
          options: { data: { username: username.trim() } },
        })

    if (result.error) {
      const text = result.error.message.toLowerCase().includes("duplicate")
        ? "That username is already taken."
        : result.error.message
      setMessage(text)
    } else if (mode === "signup") {
      setMessage("Account created. Check your email if confirmation is enabled.")
    }

    setBusy(false)
  }

  return (
    <main className="authPage">
      <section className="authCard">
        <h1>MTG Card Tracker</h1>
        <p>Fast, simple inventory tracking.</p>

        {mode === "signup" && (
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              placeholder="sacho"
            />
          </label>
        )}

        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        </label>

        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </label>

        {message && <p className="authMessage">{message}</p>}

        <button className="primaryButton" disabled={busy || !email || !password || (mode === "signup" && !username)} onClick={submit}>
          {busy ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}
        </button>

        <button className="textButton" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMessage("") }}>
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
        </button>
      </section>
    </main>
  )
}

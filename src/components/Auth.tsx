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

    const cleanUsername = username.trim()

    if (mode === "signup" && !USERNAME_RE.test(cleanUsername)) {
      setMessage("Username must be 3–24 characters using letters, numbers, or _.")
      return
    }

    if (!email.trim()) {
      setMessage("Enter your email.")
      return
    }

    if (!password) {
      setMessage("Enter your password.")
      return
    }

    setBusy(true)

    try {
      if (mode === "login") {
        const result = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })

        if (result.error) throw result.error
      } else {
        const result = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { username: cleanUsername } },
        })

        if (result.error) throw result.error

        setMessage("Account created. Check your email if confirmation is enabled.")
      }
    } catch (error: any) {
      const text = String(error?.message ?? error ?? "")
      setMessage(
        text.toLowerCase().includes("duplicate")
          ? "That username is already taken."
          : text || "Invalid email or password.",
      )
    } finally {
      setBusy(false)
    }
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
              placeholder="Username"
            />
          </label>
        )}

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="Email"
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="Password"
          />
        </label>

        {message && <p className="authMessage">{message}</p>}

        <button
          className="primaryButton"
          disabled={
            busy ||
            !email.trim() ||
            !password ||
            (mode === "signup" && !username.trim())
          }
          onClick={submit}
        >
          {busy ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}
        </button>

        <button
          className="textButton"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login")
            setMessage("")
          }}
        >
          {mode === "login"
            ? "Need an account? Sign up"
            : "Already have an account? Log in"}
        </button>
      </section>
    </main>
  )
}

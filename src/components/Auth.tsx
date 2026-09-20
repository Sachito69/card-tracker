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

    if (!USERNAME_RE.test(cleanUsername)) {
      setMessage("Username must be 3–24 characters using letters, numbers, or _.")
      return
    }

    if (!password) {
      setMessage("Enter your password.")
      return
    }

    if (mode === "signup" && !email.trim()) {
      setMessage("Enter your email.")
      return
    }

    setBusy(true)

    try {
      if (mode === "login") {
        const { data, error } = await supabase.functions.invoke("username-login", {
          body: {
            username: cleanUsername,
            password,
          },
        })

        if (error) throw error
        if (!data?.access_token || !data?.refresh_token) {
          throw new Error(data?.error || "Invalid username or password.")
        }

        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        })

        if (sessionError) throw sessionError
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
          : text || "Invalid username or password.",
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

        <label>
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            placeholder="sacho"
          />
        </label>

        {mode === "signup" && (
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </label>
        )}

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </label>

        {message && <p className="authMessage">{message}</p>}

        <button
          className="primaryButton"
          disabled={
            busy ||
            !username.trim() ||
            !password ||
            (mode === "signup" && !email.trim())
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

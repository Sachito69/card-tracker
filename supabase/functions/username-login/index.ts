import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const { username, password } = await req.json()

    const cleanUsername = String(username ?? "").trim()
    const cleanPassword = String(password ?? "")

    if (!cleanUsername || !cleanPassword) {
      return new Response(
        JSON.stringify({ error: "Invalid username or password." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    })

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("user_id")
      .ilike("username", cleanUsername)
      .maybeSingle()

    if (profileError || !profile?.user_id) {
      return new Response(
        JSON.stringify({ error: "Invalid username or password." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const { data: userResult, error: userError } =
      await admin.auth.admin.getUserById(profile.user_id)

    const email = userResult?.user?.email

    if (userError || !email) {
      return new Response(
        JSON.stringify({ error: "Invalid username or password." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    })

    const { data: loginData, error: loginError } =
      await authClient.auth.signInWithPassword({
        email,
        password: cleanPassword,
      })

    if (loginError || !loginData.session) {
      return new Response(
        JSON.stringify({ error: "Invalid username or password." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    return new Response(
      JSON.stringify({
        access_token: loginData.session.access_token,
        refresh_token: loginData.session.refresh_token,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid username or password." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }
})

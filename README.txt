EMAIL LOGIN RESTORED

Replace:
- src/components/Auth.tsx

Changes:
- Login is back to normal Supabase Email + Password.
- Signup still asks for Username + Email + Password.
- Placeholder hints remain inside the fields:
  Username / Email / Password.
- No Supabase Edge Function is needed for login anymore.
- You can ignore or delete the old username-login Edge Function later.

No SQL migration is needed.

Then run:
npm run build
npm run dev

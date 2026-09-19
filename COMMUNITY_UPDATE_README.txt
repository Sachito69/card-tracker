MTG TRACKER COMMUNITY UPDATE

IMPORTANT: Your site already has a Supabase database.

1. In Supabase -> SQL Editor, run:
   supabase/feature_update.sql

   Do NOT run schema.sql over the existing database.
   schema.sql is included only as the complete schema for a brand-new database.

2. Replace the files in this ZIP, preserving their folders.

3. Run:
   npm run build

4. Then test locally:
   npm run dev

5. Push to GitHub when ready. Render will redeploy.

FEATURES INCLUDED
- Username field during signup
- Existing users can set/change username in Settings
- Community dropdown:
  - Add friend
  - Friends list
  - Create non-user
- Friend requests by username
- Notifications popup in Menu
- Notifications for:
  - Friend requests
  - Loan requests
  - Sale requests
  - Return requests
- Friends list can lend/sell to registered friends
- Registered loan/sale requests require recipient acceptance
- Non-user contacts use local/manual transactions
- Replaced old scope buttons/holder dropdown with Filter popup
- Color checkboxes
- Deck/Binder/Box/Friend dropdown filters
- Card menu has partial-quantity Move
- Move destination supports My Collection, Deck, Binder, Box
- Lender cannot move a stack while it has active lent cards
- Borrower sees Return Card instead of Move
- Return creates a confirmation notification for the lender
- Active borrowed cards appear in the borrower's tracker

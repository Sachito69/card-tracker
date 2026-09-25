ACCOUNT CACHE + MOVE TO COLLECTION FIX

REPLACE:
- src/App.tsx
- src/components/Tracker.tsx

RUN IN SUPABASE SQL EDITOR:
- supabase/fix_move_and_account_cache.sql

WHAT THIS FIXES

1. TWO ACCOUNTS IN THE SAME BROWSER
React Query is now cleared whenever the logged-in Supabase user changes.
The main account-specific queries also use the current user id in their keys:

  ["collection", userId]
  ["holders", userId]
  ["notifications", userId]
  ["profile", userId]
  ["pending", userId]

Logging out also clears the cache immediately.

This prevents Account B from rendering Account A's cached cards after switching
accounts in the same browser.

2. MOVING A CARD FROM BOX / BINDER / DECK TO MY COLLECTION
The move_collection_quantity database function no longer deletes a full-stack
source row if it can simply reuse that row.

If it must merge into an existing My Collection stack, historical
card_transactions are repointed to the surviving collection_items row before
the old row is deleted.

This fixes:
  null value in column "source_item_id" of relation "card_transactions"
  violates not-null constraint

AFTER REPLACING/RUNNING SQL:
npm run build
npm run dev

Then test:
A. Login Account A -> note cards -> logout -> login Account B.
B. Move a full card stack from a Box to My Collection.
C. Move a partial quantity from a Box to My Collection.

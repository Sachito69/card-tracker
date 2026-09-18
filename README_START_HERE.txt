MTG TRACKER V2 - START HERE

DO NOT USE THE PREVIOUS STARTER SCHEMA.
This version matches the simplified model:

LOCAL HOLDERS
- Deck
- Binder
- Box

They are intentionally identical in behavior.
Cards can move freely among them or sit in My Collection.

PEOPLE
1) Registered friends
   - real account
   - accepted friendship required
   - loan/sale request starts PENDING
   - recipient accepts or declines
   - safer because inventory changes happen through database RPCs

2) Non-user contacts
   - local mini-profile owned by you
   - they cannot receive an app notification because they have no account
   - transactions can still start as PENDING so you confirm them manually

IMPORTANT MODEL RULE
People are NOT stored in holders.
A person is a transaction recipient.

That means:
- Deck / Binder / Box = "where my physical card is locally"
- Person = "who currently has / is buying the card via a loan/sale transaction"

This avoids mixing ownership with location and makes lending safer.

STACK
- React
- TypeScript
- Vite
- Supabase
- TanStack Query
- CSS

START
1. Create NEW Supabase project.
2. Run supabase/schema.sql in SQL Editor.
3. Copy .env.example to .env.
4. Put project URL + anon/publishable key in .env.
5. npm install
6. npm run dev

FIRST BUILD FOCUS
- super-snappy Card Tracker
- local holders
- registered friends
- non-user contacts
- pending secure transaction model

NOT BUILT YET
- the full loan/sale UI
- incoming notification center
- return flow
- transaction history UI

The database model for those is already prepared so they can be added without redesigning the tracker.

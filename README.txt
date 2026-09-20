BUILD FIX + REMOVE FROM HOLDER UPDATE

Replace:
- src/components/Tracker.tsx
- src/components/CardEditorModal.tsx

Fixes:
1. Removes the stale setDeckOptionsId() call that caused:
   Cannot find name 'setDeckOptionsId'

2. "Remove" behavior:
   - Card in Deck / Binder / Box:
     Remove from holder -> moves the full stack to My Collection.
     It does NOT delete the card from your tracker.
   - Card already in My Collection:
     Remove -> deletes it from your tracker as before.
   - Lent cards remain protected and cannot be removed/moved.

No Supabase changes are needed.

Then run:
npm run build
npm run dev

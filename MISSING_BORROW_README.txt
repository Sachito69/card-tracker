MISSING-CARD BORROW REQUESTS

Run in Supabase SQL Editor first:
  supabase/missing_card_borrow_requests.sql

Replace changed frontend files:
- src/components/BorrowModal.tsx
- src/components/NotificationsModal.tsx
- src/lib/data.ts
- src/lib/types.ts
- src/styles.css

Behavior:
1. Open Friends List -> Borrow.
2. Existing available cards still show normally.
3. If the card is missing, use the new "Card not in their collection?" search.
4. Choose a Scryfall printing and quantity, then send the request.
5. The owner receives a notification. Nothing is added before they accept.
6. On Accept, the requested copies are added to the owner's My Collection and immediately become an active loan to the requester.
7. The normal borrower Return -> lender Confirm flow applies after that.
8. The requester can cancel the still-pending request from Menu -> Pending.

Missing-card requests currently add the accepted copies as NM, non-foil.

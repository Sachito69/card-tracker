COMMUNITY BORROW + MIGRATION UPDATE

IMPORTANT
Run this once in Supabase -> SQL Editor before testing:
  supabase/community_borrow_migration.sql

Replace these frontend files:
- src/components/FriendsListModal.tsx
- src/components/BorrowModal.tsx
- src/components/MigrateContactModal.tsx
- src/components/NotificationsModal.tsx
- src/components/CardEditorModal.tsx
- src/lib/data.ts
- src/lib/types.ts
- src/styles.css

WHAT CHANGED
1. Friends List UI cleanup
   - Registered friends and non-user contacts are separate card-style sections.
   - Better identity/avatar layout and grouped actions.

2. Borrow button for registered friends
   - Borrow opens the friend's currently available inventory.
   - Pick cards in an image grid/cart.
   - Sends a borrow request to the card owner.
   - The owner receives a Borrow request notification and Accept/Decline controls.
   - Accepted borrowed cards use the normal loan + return flow.

3. Non-user/contact returns
   - Cards actively lent to a non-user show who has them.
   - Opening the card shows a clear "Return from NAME" button.
   - The owner can mark the contact loan returned directly.

4. Migrate non-user contact
   - Non-user rows now have Migrate.
   - Choose one of your accepted registered friends.
   - ALL transactions for the local contact are reassigned to that user.
   - The local contact is deleted after migration.
   - Active loans become normal registered-user loans after migration.

5. Pending / notifications
   - Transactions now record who initiated them with requested_by.
   - Borrow requests notify the owner, while normal loan offers notify the recipient.
   - The original requester can cancel a pending request from Pending.

AFTER REPLACING FILES / RUNNING SQL
npm run build
npm run dev

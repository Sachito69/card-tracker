PROFESSIONAL FEEDBACK UPDATE

Replace:
- src/main.tsx
- src/styles.css
- src/components/Feedback.tsx
- src/components/Skeletons.tsx
- src/components/Tracker.tsx
- src/components/CardEditorModal.tsx
- src/components/MigrateContactModal.tsx
- src/components/FriendsListModal.tsx
- src/components/BorrowModal.tsx
- src/components/TransactionModal.tsx
- src/components/NotificationsModal.tsx
- src/components/PendingModal.tsx
- src/components/HistoryModal.tsx

No Supabase/SQL changes are required.

ADDED

1. TOAST NOTIFICATIONS
Examples:
- Card moved
- Card details saved
- Return request sent
- Loan request sent
- Sale request sent
- Request accepted / declined
- Pending request cancelled
- Contact migrated
- Deck deleted

Toasts automatically dismiss and work on desktop and mobile.

2. CUSTOM CONFIRMATION DIALOGS
Browser confirm() popups were replaced for:
- Delete deck
- Remove card
- Move full card stack back to My Collection
- Mark non-user loan returned
- Migrate non-user contact

On mobile these confirmations open as bottom sheets.

3. LOADING SKELETONS
Added visual loading placeholders for:
- Main card collection
- Deck / binder / box lists
- Friends
- Contacts
- Borrow card browser
- Lend / sell card browser
- Notifications
- Pending requests
- History

These make loading feel intentional instead of showing plain "Loading..." text.

Run:
npm run build
npm run dev

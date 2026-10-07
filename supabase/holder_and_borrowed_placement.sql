-- Holder deletion + borrowed-card placement
-- Run once in Supabase SQL Editor BEFORE using this frontend update.

-- 1) Borrowers can organize an active borrowed card into one of THEIR holders.
alter table public.card_transactions
  add column if not exists borrower_holder_id bigint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'card_transactions_borrower_holder_id_fkey'
  ) then
    alter table public.card_transactions
      add constraint card_transactions_borrower_holder_id_fkey
      foreign key (borrower_holder_id)
      references public.holders(id)
      on delete set null;
  end if;
end
$$;

create index if not exists idx_card_transactions_borrower_holder_id
  on public.card_transactions(borrower_holder_id);

create or replace function public.move_borrowed_loan(
  p_transaction_id bigint,
  p_holder_id bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tx public.card_transactions%rowtype;
begin
  select *
  into tx
  from public.card_transactions
  where id = p_transaction_id
    and recipient_user_id = auth.uid()
    and transaction_type = 'loan'
    and status in ('active', 'return_pending')
  for update;

  if not found then
    raise exception 'Borrowed card not found';
  end if;

  if p_holder_id is not null and not exists (
    select 1
    from public.holders
    where id = p_holder_id
      and user_id = auth.uid()
  ) then
    raise exception 'Destination holder not found';
  end if;

  update public.card_transactions
  set borrower_holder_id = p_holder_id
  where id = p_transaction_id;
end;
$$;

grant execute on function public.move_borrowed_loan(bigint, bigint)
to authenticated;


-- 2) Safely delete ANY holder (deck, binder or box).
-- Owned cards are moved to Unsorted (holder_id NULL).
-- Borrowed cards placed in the holder automatically become Unsorted because
-- borrower_holder_id uses ON DELETE SET NULL.
create or replace function public.delete_holder_safe(p_holder_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owned_holder public.holders%rowtype;
  row_item public.collection_items%rowtype;
  target_id bigint;
begin
  select *
  into owned_holder
  from public.holders
  where id = p_holder_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Holder not found';
  end if;

  for row_item in
    select *
    from public.collection_items
    where holder_id = p_holder_id
      and user_id = auth.uid()
    for update
  loop
    target_id := null;

    select id
    into target_id
    from public.collection_items
    where user_id = auth.uid()
      and card_id = row_item.card_id
      and holder_id is null
      and condition = row_item.condition
      and foil = row_item.foil
      and id <> row_item.id
    limit 1
    for update;

    if target_id is null then
      -- Keep the same row ID so transaction history references remain valid.
      update public.collection_items
      set holder_id = null
      where id = row_item.id;
    else
      -- If we merge into an existing Unsorted stack, repoint ALL historical
      -- and active transaction references before deleting the source row.
      update public.card_transactions
      set source_item_id = target_id
      where source_item_id = row_item.id
        and owner_id = auth.uid();

      update public.collection_items
      set quantity = quantity + row_item.quantity
      where id = target_id;

      delete from public.collection_items
      where id = row_item.id;
    end if;
  end loop;

  delete from public.holders
  where id = p_holder_id
    and user_id = auth.uid();
end;
$$;

grant execute on function public.delete_holder_safe(bigint)
to authenticated;


-- Keep older frontend builds working.
create or replace function public.delete_deck_safe(p_deck_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.holders
    where id = p_deck_id
      and user_id = auth.uid()
      and type = 'deck'
  ) then
    raise exception 'Deck not found';
  end if;

  perform public.delete_holder_safe(p_deck_id);
end;
$$;

grant execute on function public.delete_deck_safe(bigint)
to authenticated;

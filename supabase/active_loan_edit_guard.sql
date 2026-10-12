-- Run after the project's existing schema and holder_and_borrowed_placement.sql.
-- No policies are removed, RLS remains enabled, and no new client grants are added.
begin;

create or replace function public.guard_active_loan_inventory()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  -- Existing SECURITY DEFINER transaction RPCs run as the trusted database
  -- owner. They must still be able to settle sales, merge inventory, and delete
  -- holders. A direct PostgREST client write runs as authenticated instead.
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- PostgreSQL already locks this inventory row for UPDATE/DELETE. Loan
  -- creation/acceptance also locks it, so a concurrent loan cannot slip
  -- between this check and a direct inventory edit.
  if exists (
    select 1 from public.card_transactions
    where source_item_id = old.id
      and transaction_type = 'loan'
      and status in ('active', 'return_pending')
  ) then
    if tg_op = 'DELETE' then
      raise exception 'Return all active loans before deleting this card'
        using errcode = '23514';
    end if;
    if new.quantity is distinct from old.quantity
       or new.card_id is distinct from old.card_id
       or new.foil is distinct from old.foil
       or new.user_id is distinct from old.user_id then
      raise exception 'Quantity, printing, finish and ownership are locked during an active loan'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_active_loan_inventory on public.collection_items;
create trigger guard_active_loan_inventory
before update or delete on public.collection_items
for each row execute function public.guard_active_loan_inventory();

revoke all on function public.guard_active_loan_inventory() from public;

-- Borrowed copies remain transaction projections, never borrower-owned
-- collection_items. The existing move_borrowed_loan RPC checks auth.uid(),
-- accepts only active/return_pending loans, checks the destination belongs to
-- that borrower, and updates ONLY borrower_holder_id. Its ownership and loan
-- details cannot be edited through client table writes.
-- Keep the existing SELECT-only transaction access; do not add UPDATE grants.

-- Also close the normal move RPC path into a locked destination stack.
create or replace function public.move_collection_quantity(
  p_item_id bigint,
  p_quantity integer,
  p_holder_id bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  src public.collection_items%rowtype;
  target_id bigint;
  reserved integer;
begin
  if p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;

  select *
  into src
  from public.collection_items
  where id = p_item_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Card not found';
  end if;

  if p_quantity > src.quantity then
    raise exception 'Not enough copies';
  end if;

  select coalesce(sum(quantity), 0)::integer
  into reserved
  from public.card_transactions
  where owner_id = auth.uid()
    and source_item_id = src.id
    and status in ('pending', 'active', 'return_pending');

  if reserved > 0 then
    raise exception 'Cards in a pending or active transaction cannot be moved';
  end if;

  if p_holder_id is not null and not exists (
    select 1
    from public.holders
    where id = p_holder_id
      and user_id = auth.uid()
  ) then
    raise exception 'Holder not found';
  end if;

  if src.holder_id is not distinct from p_holder_id then
    return;
  end if;

  select id
  into target_id
  from public.collection_items
  where user_id = auth.uid()
    and card_id = src.card_id
    and holder_id is not distinct from p_holder_id
    and condition = src.condition
    and foil = src.foil
    and id <> src.id
  limit 1
  for update;

  -- A free stack must not be merged into a stack whose quantity is locked.
  -- Check after locking the target row, as loan creation locks the same row.
  if target_id is not null and exists (
    select 1 from public.card_transactions
    where source_item_id = target_id
      and transaction_type = 'loan'
      and status in ('active', 'return_pending')
  ) then
    raise exception 'Return all active loans before merging into this card stack';
  end if;

  -- Moving the entire stack:
  -- If no matching target exists, keep the SAME collection_items id and only
  -- change its holder. This preserves every historical transaction reference.
  if p_quantity = src.quantity and target_id is null then
    update public.collection_items
    set holder_id = p_holder_id
    where id = src.id;

    return;
  end if;

  -- If an entire stack is merging into an existing target, repoint historical
  -- transactions BEFORE deleting the source row.
  if p_quantity = src.quantity and target_id is not null then
    update public.card_transactions
    set source_item_id = target_id
    where source_item_id = src.id
      and owner_id = auth.uid();

    update public.collection_items
    set quantity = quantity + src.quantity
    where id = target_id;

    delete from public.collection_items
    where id = src.id;

    return;
  end if;

  -- Partial-stack move: source row stays alive, so no transaction reference
  -- needs to change.
  if target_id is null then
    insert into public.collection_items(
      user_id,
      card_id,
      holder_id,
      quantity,
      condition,
      foil
    )
    values(
      auth.uid(),
      src.card_id,
      p_holder_id,
      p_quantity,
      src.condition,
      src.foil
    );
  else
    update public.collection_items
    set quantity = quantity + p_quantity
    where id = target_id;
  end if;

  update public.collection_items
  set quantity = quantity - p_quantity
  where id = src.id;
end;
$$;

grant execute on function public.move_collection_quantity(bigint, integer, bigint)
to authenticated;


commit;

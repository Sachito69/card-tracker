-- Account-independent card move fix
-- Run once in Supabase SQL Editor.
--
-- Fixes:
-- "null value in column source_item_id of relation card_transactions
--  violates not-null constraint"
--
-- The old move function could delete a collection_items row while historical
-- card_transactions still pointed to it. If the FK uses ON DELETE SET NULL,
-- PostgreSQL then tries to null source_item_id, but that column is NOT NULL.
--
-- This version preserves/repoints the source row safely.

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

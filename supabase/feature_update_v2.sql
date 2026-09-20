-- MTG Tracker feature update v2
-- Run this ONCE in Supabase SQL Editor on the existing database.

alter table public.holders
  add column if not exists format text;

alter table public.card_catalog
  add column if not exists color_identity jsonb not null default '[]'::jsonb;

-- Best-effort backfill for cards already cached.
-- Newly added cards will store Scryfall's real color_identity.
update public.card_catalog
set color_identity = colors
where color_identity = '[]'::jsonb
  and jsonb_array_length(colors) > 0;

create index if not exists holders_user_format_idx
  on public.holders(user_id, type, format);

-- Delete/cancel pending items created by the current user.
create or replace function public.delete_pending_request(
  p_kind text,
  p_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind = 'friend' then
    delete from public.friendships
    where id = p_id
      and requested_by = auth.uid()
      and status = 'pending';

    if not found then
      raise exception 'Pending friend request not found';
    end if;
    return;
  end if;

  if p_kind = 'transaction' then
    delete from public.card_transactions
    where id = p_id
      and owner_id = auth.uid()
      and status = 'pending';

    if not found then
      raise exception 'Pending transaction not found';
    end if;
    return;
  end if;

  raise exception 'Invalid pending item';
end;
$$;

-- Helper logic is repeated in transaction RPCs so a selected card is moved
-- out of a deck/binder/box into My Collection before the loan/sale request
-- is recorded. Partial stacks are split safely.

create or replace function public.create_user_transaction(
  p_recipient_user_id uuid,
  p_source_item_id bigint,
  p_transaction_type text,
  p_quantity integer,
  p_price_per_card numeric default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  src public.collection_items%rowtype;
  a uuid;
  b uuid;
  reserved integer;
  tx_id bigint;
  transaction_source_id bigint;
  loose_id bigint;
begin
  if p_transaction_type not in ('loan','sale') then
    raise exception 'Invalid type';
  end if;
  if p_quantity <= 0 then
    raise exception 'Invalid quantity';
  end if;

  a := least(auth.uid(), p_recipient_user_id);
  b := greatest(auth.uid(), p_recipient_user_id);

  if not exists(
    select 1
    from public.friendships
    where user_a = a
      and user_b = b
      and status = 'accepted'
  ) then
    raise exception 'Recipient must be an accepted friend';
  end if;

  select * into src
  from public.collection_items
  where id = p_source_item_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Card not found';
  end if;

  select coalesce(sum(quantity),0)::integer into reserved
  from public.card_transactions
  where source_item_id = src.id
    and owner_id = auth.uid()
    and status in ('pending','active','return_pending');

  if src.quantity - reserved < p_quantity then
    raise exception 'Not enough available copies';
  end if;

  transaction_source_id := src.id;

  -- Cards being lent/sold should no longer appear inside a local holder.
  if src.holder_id is not null then
    select id into loose_id
    from public.collection_items
    where user_id = auth.uid()
      and card_id = src.card_id
      and holder_id is null
      and condition = src.condition
      and foil = src.foil
    limit 1
    for update;

    if loose_id is null then
      insert into public.collection_items(
        user_id, card_id, holder_id, quantity, condition, foil
      )
      values(
        auth.uid(), src.card_id, null, p_quantity, src.condition, src.foil
      )
      returning id into transaction_source_id;
    else
      update public.collection_items
      set quantity = quantity + p_quantity
      where id = loose_id;
      transaction_source_id := loose_id;
    end if;

    update public.collection_items
    set quantity = quantity - p_quantity
    where id = src.id;

    delete from public.collection_items
    where id = src.id
      and quantity = 0;
  end if;

  insert into public.card_transactions(
    owner_id,
    recipient_user_id,
    source_item_id,
    card_id,
    transaction_type,
    quantity,
    condition,
    foil,
    price_per_card,
    status
  )
  values(
    auth.uid(),
    p_recipient_user_id,
    transaction_source_id,
    src.card_id,
    p_transaction_type,
    p_quantity,
    src.condition,
    src.foil,
    p_price_per_card,
    'pending'
  )
  returning id into tx_id;

  return tx_id;
end;
$$;

create or replace function public.create_contact_transaction(
  p_contact_id bigint,
  p_source_item_id bigint,
  p_transaction_type text,
  p_quantity integer,
  p_price_per_card numeric default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  src public.collection_items%rowtype;
  reserved integer;
  tx_id bigint;
  transaction_source_id bigint;
  loose_id bigint;
begin
  if p_transaction_type not in ('loan','sale') then
    raise exception 'Invalid type';
  end if;
  if p_quantity <= 0 then
    raise exception 'Invalid quantity';
  end if;
  if not exists(
    select 1
    from public.contacts
    where id = p_contact_id
      and user_id = auth.uid()
  ) then
    raise exception 'Contact not found';
  end if;

  select * into src
  from public.collection_items
  where id = p_source_item_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Card not found';
  end if;

  select coalesce(sum(quantity),0)::integer into reserved
  from public.card_transactions
  where source_item_id = src.id
    and owner_id = auth.uid()
    and status in ('pending','active','return_pending');

  if src.quantity - reserved < p_quantity then
    raise exception 'Not enough available copies';
  end if;

  transaction_source_id := src.id;

  if p_transaction_type = 'loan' and src.holder_id is not null then
    select id into loose_id
    from public.collection_items
    where user_id = auth.uid()
      and card_id = src.card_id
      and holder_id is null
      and condition = src.condition
      and foil = src.foil
    limit 1
    for update;

    if loose_id is null then
      insert into public.collection_items(
        user_id, card_id, holder_id, quantity, condition, foil
      )
      values(
        auth.uid(), src.card_id, null, p_quantity, src.condition, src.foil
      )
      returning id into transaction_source_id;
    else
      update public.collection_items
      set quantity = quantity + p_quantity
      where id = loose_id;
      transaction_source_id := loose_id;
    end if;

    update public.collection_items
    set quantity = quantity - p_quantity
    where id = src.id;

    delete from public.collection_items
    where id = src.id
      and quantity = 0;
  end if;

  if p_transaction_type = 'loan' then
    insert into public.card_transactions(
      owner_id, recipient_contact_id, source_item_id, card_id,
      transaction_type, quantity, condition, foil, price_per_card,
      status, responded_at
    )
    values(
      auth.uid(), p_contact_id, transaction_source_id, src.card_id,
      'loan', p_quantity, src.condition, src.foil, p_price_per_card,
      'active', now()
    )
    returning id into tx_id;
  else
    insert into public.card_transactions(
      owner_id, recipient_contact_id, source_item_id, card_id,
      transaction_type, quantity, condition, foil, price_per_card,
      status, responded_at, completed_at
    )
    values(
      auth.uid(), p_contact_id, src.id, src.card_id,
      'sale', p_quantity, src.condition, src.foil, p_price_per_card,
      'completed', now(), now()
    )
    returning id into tx_id;

    if src.quantity = p_quantity then
      delete from public.collection_items where id = src.id;
    else
      update public.collection_items
      set quantity = quantity - p_quantity
      where id = src.id;
    end if;
  end if;

  return tx_id;
end;
$$;

grant execute on function public.delete_pending_request(text,bigint) to authenticated;
grant execute on function public.create_user_transaction(uuid,bigint,text,integer,numeric) to authenticated;
grant execute on function public.create_contact_transaction(bigint,bigint,text,integer,numeric) to authenticated;

-- Pending/active transactions reserve a stack. Do not let it be moved into a
-- local holder until the request is deleted/declined or the loan is returned.
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

  select * into src
  from public.collection_items
  where id = p_item_id
    and user_id = auth.uid()
  for update;

  if not found then raise exception 'Card not found'; end if;
  if p_quantity > src.quantity then raise exception 'Not enough copies'; end if;

  select coalesce(sum(quantity),0)::integer into reserved
  from public.card_transactions
  where owner_id = auth.uid()
    and source_item_id = src.id
    and status in ('pending','active','return_pending');

  if reserved > 0 then
    raise exception 'Cards in a pending or active transaction cannot be moved';
  end if;

  if p_holder_id is not null and not exists(
    select 1 from public.holders
    where id = p_holder_id and user_id = auth.uid()
  ) then
    raise exception 'Holder not found';
  end if;

  if src.holder_id is not distinct from p_holder_id then return; end if;

  select id into target_id
  from public.collection_items
  where user_id = auth.uid()
    and card_id = src.card_id
    and holder_id is not distinct from p_holder_id
    and condition = src.condition
    and foil = src.foil
  limit 1
  for update;

  if target_id is null then
    insert into public.collection_items(
      user_id,card_id,holder_id,quantity,condition,foil
    ) values(
      auth.uid(),src.card_id,p_holder_id,p_quantity,src.condition,src.foil
    );
  else
    update public.collection_items
    set quantity = quantity + p_quantity
    where id = target_id;
  end if;

  if p_quantity = src.quantity then
    delete from public.collection_items where id = src.id;
  else
    update public.collection_items
    set quantity = quantity - p_quantity
    where id = src.id;
  end if;
end;
$$;

grant execute on function public.move_collection_quantity(bigint,integer,bigint) to authenticated;

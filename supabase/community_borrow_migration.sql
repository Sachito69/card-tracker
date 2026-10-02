-- Community borrowing + contact migration update
-- Run once in Supabase SQL Editor on your existing project.

alter table public.card_transactions
  add column if not exists requested_by uuid references auth.users(id) on delete cascade;

update public.card_transactions
set requested_by = owner_id
where requested_by is null;

create index if not exists card_transactions_requested_by_idx
  on public.card_transactions(requested_by, status);

-- Lender-initiated user transaction.
-- requested_by records who started the request so the correct person receives
-- the notification and approval action.
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
  if p_recipient_user_id = auth.uid() then
    raise exception 'Invalid recipient';
  end if;

  a := least(auth.uid(), p_recipient_user_id);
  b := greatest(auth.uid(), p_recipient_user_id);

  if not exists (
    select 1 from public.friendships
    where user_a = a and user_b = b and status = 'accepted'
  ) then
    raise exception 'Recipient must be an accepted friend';
  end if;

  select * into src
  from public.collection_items
  where id = p_source_item_id and user_id = auth.uid()
  for update;

  if not found then raise exception 'Card not found'; end if;

  select coalesce(sum(quantity),0)::integer into reserved
  from public.card_transactions
  where source_item_id = src.id
    and owner_id = auth.uid()
    and status in ('pending','active','return_pending');

  if src.quantity - reserved < p_quantity then
    raise exception 'Not enough available copies';
  end if;

  transaction_source_id := src.id;

  -- A card offered for loan/sale should leave a Deck/Binder/Box immediately.
  if src.holder_id is not null then
    select id into loose_id
    from public.collection_items
    where user_id = auth.uid()
      and card_id = src.card_id
      and holder_id is null
      and condition = src.condition
      and foil = src.foil
      and id <> src.id
    limit 1
    for update;

    if p_quantity = src.quantity then
      if loose_id is null then
        update public.collection_items
        set holder_id = null
        where id = src.id;
        transaction_source_id := src.id;
      else
        -- Preserve historical transaction references before removing src.
        update public.card_transactions
        set source_item_id = loose_id
        where source_item_id = src.id;

        update public.collection_items
        set quantity = quantity + src.quantity
        where id = loose_id;

        delete from public.collection_items where id = src.id;
        transaction_source_id := loose_id;
      end if;
    else
      if loose_id is null then
        insert into public.collection_items(user_id,card_id,holder_id,quantity,condition,foil)
        values(auth.uid(),src.card_id,null,p_quantity,src.condition,src.foil)
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
    end if;
  end if;

  insert into public.card_transactions(
    owner_id,recipient_user_id,source_item_id,card_id,transaction_type,
    quantity,condition,foil,price_per_card,status,requested_by
  ) values(
    auth.uid(),p_recipient_user_id,transaction_source_id,src.card_id,p_transaction_type,
    p_quantity,src.condition,src.foil,p_price_per_card,'pending',auth.uid()
  ) returning id into tx_id;

  return tx_id;
end;
$$;

-- Friend inventory that can be requested for borrowing.
create or replace function public.fetch_friend_borrowable_inventory(
  p_friend_user_id uuid
)
returns table(
  source_item_id bigint,
  card_id text,
  card_name text,
  image_url text,
  holder_name text,
  holder_type text,
  quantity integer,
  available_quantity integer,
  condition text,
  foil boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  a uuid;
  b uuid;
begin
  if p_friend_user_id = auth.uid() then
    raise exception 'Invalid friend';
  end if;

  a := least(auth.uid(), p_friend_user_id);
  b := greatest(auth.uid(), p_friend_user_id);

  if not exists (
    select 1 from public.friendships
    where user_a = a and user_b = b and status = 'accepted'
  ) then
    raise exception 'Not an accepted friend';
  end if;

  return query
  select
    ci.id,
    ci.card_id,
    cc.name,
    cc.image_url,
    h.name,
    h.type,
    ci.quantity,
    (ci.quantity - coalesce((
      select sum(ct.quantity)::integer
      from public.card_transactions ct
      where ct.source_item_id = ci.id
        and ct.owner_id = p_friend_user_id
        and ct.status in ('pending','active','return_pending')
    ),0))::integer as available_quantity,
    ci.condition,
    ci.foil
  from public.collection_items ci
  join public.card_catalog cc on cc.id = ci.card_id
  left join public.holders h on h.id = ci.holder_id
  where ci.user_id = p_friend_user_id
    and ci.quantity - coalesce((
      select sum(ct.quantity)::integer
      from public.card_transactions ct
      where ct.source_item_id = ci.id
        and ct.owner_id = p_friend_user_id
        and ct.status in ('pending','active','return_pending')
    ),0) > 0
  order by lower(cc.name), ci.id;
end;
$$;

-- Borrower-initiated request. The friend still owns the card; nothing moves
-- until the owner accepts the request.
create or replace function public.request_borrow_from_friend(
  p_owner_user_id uuid,
  p_source_item_id bigint,
  p_quantity integer
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
begin
  if p_owner_user_id = auth.uid() then raise exception 'Invalid owner'; end if;
  if p_quantity <= 0 then raise exception 'Invalid quantity'; end if;

  a := least(auth.uid(), p_owner_user_id);
  b := greatest(auth.uid(), p_owner_user_id);

  if not exists (
    select 1 from public.friendships
    where user_a = a and user_b = b and status = 'accepted'
  ) then
    raise exception 'Not an accepted friend';
  end if;

  select * into src
  from public.collection_items
  where id = p_source_item_id and user_id = p_owner_user_id
  for update;

  if not found then raise exception 'Card is no longer available'; end if;

  select coalesce(sum(quantity),0)::integer into reserved
  from public.card_transactions
  where source_item_id = src.id
    and owner_id = p_owner_user_id
    and status in ('pending','active','return_pending');

  if src.quantity - reserved < p_quantity then
    raise exception 'Not enough available copies';
  end if;

  insert into public.card_transactions(
    owner_id,recipient_user_id,source_item_id,card_id,transaction_type,
    quantity,condition,foil,price_per_card,status,requested_by
  ) values(
    p_owner_user_id,auth.uid(),src.id,src.card_id,'loan',
    p_quantity,src.condition,src.foil,null,'pending',auth.uid()
  ) returning id into tx_id;

  return tx_id;
end;
$$;

-- Accept/decline both lender-initiated offers and borrower-initiated requests.
create or replace function public.respond_user_transaction(
  p_transaction_id bigint,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tx public.card_transactions%rowtype;
  src public.collection_items%rowtype;
  decision_user uuid;
  reserved_other integer;
  existing_id bigint;
  loose_id bigint;
  active_source_id bigint;
begin
  select * into tx
  from public.card_transactions
  where id = p_transaction_id
  for update;

  if not found then raise exception 'Transaction not found'; end if;
  if tx.status <> 'pending' then raise exception 'Transaction already handled'; end if;

  -- Whoever did NOT create the request is the person who must decide.
  if tx.requested_by = tx.owner_id then
    decision_user := tx.recipient_user_id;
  else
    decision_user := tx.owner_id;
  end if;

  if decision_user is distinct from auth.uid() then
    raise exception 'You cannot respond to this request';
  end if;

  if not p_accept then
    update public.card_transactions
    set status = 'declined', responded_at = now()
    where id = tx.id;
    return;
  end if;

  select * into src
  from public.collection_items
  where id = tx.source_item_id and user_id = tx.owner_id
  for update;

  if not found then raise exception 'Source inventory changed'; end if;

  select coalesce(sum(quantity),0)::integer into reserved_other
  from public.card_transactions
  where source_item_id = src.id
    and id <> tx.id
    and status in ('pending','active','return_pending');

  if src.quantity - reserved_other < tx.quantity then
    raise exception 'Source inventory changed';
  end if;

  if tx.transaction_type = 'loan' then
    active_source_id := src.id;

    -- A borrower-created request stays in the owner's holder until accepted.
    -- Move the accepted quantity to My Collection now.
    if src.holder_id is not null then
      select id into loose_id
      from public.collection_items
      where user_id = tx.owner_id
        and card_id = src.card_id
        and holder_id is null
        and condition = src.condition
        and foil = src.foil
        and id <> src.id
      limit 1
      for update;

      if tx.quantity = src.quantity then
        if loose_id is null then
          update public.collection_items set holder_id = null where id = src.id;
          active_source_id := src.id;
        else
          update public.card_transactions
          set source_item_id = loose_id
          where source_item_id = src.id and id <> tx.id;

          update public.collection_items
          set quantity = quantity + src.quantity
          where id = loose_id;

          delete from public.collection_items where id = src.id;
          active_source_id := loose_id;
        end if;
      else
        if loose_id is null then
          insert into public.collection_items(user_id,card_id,holder_id,quantity,condition,foil)
          values(tx.owner_id,src.card_id,null,tx.quantity,src.condition,src.foil)
          returning id into active_source_id;
        else
          update public.collection_items
          set quantity = quantity + tx.quantity
          where id = loose_id;
          active_source_id := loose_id;
        end if;

        update public.collection_items
        set quantity = quantity - tx.quantity
        where id = src.id;
      end if;

      update public.card_transactions
      set source_item_id = active_source_id
      where id = tx.id;
    end if;

    update public.card_transactions
    set status = 'active', responded_at = now()
    where id = tx.id;
    return;
  end if;

  -- Sale acceptance: move ownership to recipient while preserving source ids.
  select id into existing_id
  from public.collection_items
  where user_id = tx.recipient_user_id
    and card_id = tx.card_id
    and holder_id is null
    and condition = tx.condition
    and foil = tx.foil
  limit 1
  for update;

  if tx.quantity = src.quantity then
    if existing_id is null then
      update public.collection_items
      set user_id = tx.recipient_user_id, holder_id = null
      where id = src.id;
    else
      update public.card_transactions
      set source_item_id = existing_id
      where source_item_id = src.id;

      update public.collection_items
      set quantity = quantity + src.quantity
      where id = existing_id;

      delete from public.collection_items where id = src.id;
    end if;
  else
    if existing_id is null then
      insert into public.collection_items(user_id,card_id,holder_id,quantity,condition,foil)
      values(tx.recipient_user_id,tx.card_id,null,tx.quantity,tx.condition,tx.foil);
    else
      update public.collection_items
      set quantity = quantity + tx.quantity
      where id = existing_id;
    end if;

    update public.collection_items
    set quantity = quantity - tx.quantity
    where id = src.id;
  end if;

  update public.card_transactions
  set status = 'completed', responded_at = now(), completed_at = now()
  where id = tx.id;
end;
$$;

-- Allow the original requester to cancel either a normal outgoing offer or a
-- borrower-created request.
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

    if not found then raise exception 'Pending friend request not found'; end if;
    return;
  end if;

  if p_kind = 'transaction' then
    delete from public.card_transactions
    where id = p_id
      and requested_by = auth.uid()
      and status = 'pending';

    if not found then raise exception 'Pending transaction not found'; end if;
    return;
  end if;

  raise exception 'Invalid pending item';
end;
$$;

-- Convert a local non-user contact into a registered friend. Historical and
-- active transactions are reassigned, then the local contact row is removed.
create or replace function public.migrate_contact_to_user(
  p_contact_id bigint,
  p_target_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.contacts%rowtype;
  a uuid;
  b uuid;
  moved integer;
begin
  select * into c
  from public.contacts
  where id = p_contact_id and user_id = auth.uid()
  for update;

  if not found then raise exception 'Contact not found'; end if;
  if p_target_user_id = auth.uid() then raise exception 'Invalid target user'; end if;

  a := least(auth.uid(), p_target_user_id);
  b := greatest(auth.uid(), p_target_user_id);

  if not exists (
    select 1 from public.friendships
    where user_a = a and user_b = b and status = 'accepted'
  ) then
    raise exception 'Target must be an accepted friend';
  end if;

  update public.card_transactions
  set recipient_user_id = p_target_user_id,
      recipient_contact_id = null
  where owner_id = auth.uid()
    and recipient_contact_id = p_contact_id;

  get diagnostics moved = row_count;

  delete from public.contacts
  where id = p_contact_id and user_id = auth.uid();

  return moved;
end;
$$;

-- Owner-side manual return for active loans to local/non-user contacts.
create or replace function public.complete_contact_loan(
  p_transaction_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.card_transactions
  set status = 'completed',
      responded_at = coalesce(responded_at, now()),
      completed_at = now()
  where id = p_transaction_id
    and owner_id = auth.uid()
    and recipient_contact_id is not null
    and transaction_type = 'loan'
    and status in ('active','return_pending');

  if not found then raise exception 'Active contact loan not found'; end if;
end;
$$;

grant execute on function public.create_user_transaction(uuid,bigint,text,integer,numeric) to authenticated;
grant execute on function public.fetch_friend_borrowable_inventory(uuid) to authenticated;
grant execute on function public.request_borrow_from_friend(uuid,bigint,integer) to authenticated;
grant execute on function public.respond_user_transaction(bigint,boolean) to authenticated;
grant execute on function public.delete_pending_request(text,bigint) to authenticated;
grant execute on function public.migrate_contact_to_user(bigint,uuid) to authenticated;
grant execute on function public.complete_contact_loan(bigint) to authenticated;

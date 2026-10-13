-- Replacement for saved decklists. Run after the existing active-loan/holder migrations.
-- Supports both databases with and without tracker_ux_saved_decklists.sql installed.
begin;
alter table public.collection_items add column if not exists is_missing boolean not null default false;
drop index if exists public.collection_items_unique_stack;
create unique index collection_items_unique_stack on public.collection_items
(user_id,card_id,coalesce(holder_id,0::bigint),condition,foil,is_missing);

create or replace function public.guard_inventory_status() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if new.holder_id is not null and not exists(select 1 from public.holders where id=new.holder_id and user_id=new.user_id) then
    raise exception 'Holder must belong to inventory owner' using errcode='23514';
  end if;
  if tg_op='UPDATE' and new.is_missing is distinct from old.is_missing then
    raise exception 'Use Mark acquired to change missing status' using errcode='23514';
  end if;
  return new;
end $$;
drop trigger if exists guard_inventory_status on public.collection_items;
create trigger guard_inventory_status before insert or update on public.collection_items
for each row execute function public.guard_inventory_status();
revoke all on function public.guard_inventory_status() from public,anon,authenticated;

create or replace function public.guard_missing_transaction() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare missing boolean;
begin
  if new.source_item_id is not null then
    select is_missing into missing from public.collection_items where id=new.source_item_id for update;
    if missing then raise exception 'Missing cards cannot be lent, sold or borrowed' using errcode='23514'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_missing_transaction on public.card_transactions;
create trigger guard_missing_transaction before insert or update on public.card_transactions
for each row execute function public.guard_missing_transaction();
revoke all on function public.guard_missing_transaction() from public,anon,authenticated;

create or replace function public.add_inventory_stack(p_card_id text,p_quantity integer,p_condition text,
p_foil boolean,p_holder_id bigint,p_is_missing boolean) returns bigint
language plpgsql security definer set search_path=pg_catalog,public as $$
declare target bigint;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_quantity is null or p_quantity<=0 or p_is_missing is null or p_foil is null then
    raise exception 'Invalid inventory details' using errcode='23514'; end if;
  if p_holder_id is not null and not exists(select 1 from public.holders where id=p_holder_id and user_id=auth.uid()) then
    raise exception 'Holder not found' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':inventory',0));
  select id into target from public.collection_items where user_id=auth.uid() and card_id=p_card_id
    and condition=p_condition and foil=p_foil and is_missing=p_is_missing
    and holder_id is not distinct from p_holder_id for update;
  if target is not null then
    if exists(select 1 from public.card_transactions where source_item_id=target and status in ('pending','active','return_pending')) then
      raise exception 'Return or cancel transactions before adding to this stack' using errcode='23514'; end if;
    update public.collection_items set quantity=quantity+p_quantity where id=target;
  else
    insert into public.collection_items(user_id,card_id,quantity,condition,foil,holder_id,is_missing)
    values(auth.uid(),p_card_id,p_quantity,p_condition,p_foil,p_holder_id,p_is_missing) returning id into target;
  end if;
  return target;
end $$;

create or replace function public.acquire_missing_stack(p_item_id bigint,p_quantity integer) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare src public.collection_items%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':inventory',0));
  select * into src from public.collection_items where id=p_item_id and user_id=auth.uid() and is_missing for update;
  if not found then raise exception 'Missing card changed; refresh and try again' using errcode='23514'; end if;
  if p_quantity is null or p_quantity<1 or p_quantity>src.quantity then
    raise exception 'Quantity must be between 1 and the missing quantity' using errcode='23514'; end if;
  perform public.add_inventory_stack(src.card_id,p_quantity,src.condition,src.foil,src.holder_id,false);
  if p_quantity=src.quantity then delete from public.collection_items where id=src.id;
  else update public.collection_items set quantity=quantity-p_quantity where id=src.id; end if;
end $$;
revoke all on function public.add_inventory_stack(text,integer,text,boolean,bigint,boolean),
public.acquire_missing_stack(bigint,integer) from public,anon;
grant execute on function public.add_inventory_stack(text,integer,text,boolean,bigint,boolean),
public.acquire_missing_stack(bigint,integer) to authenticated;

CREATE OR REPLACE FUNCTION public.create_contact_transaction(p_contact_id bigint, p_source_item_id bigint, p_transaction_type text, p_quantity integer, p_price_per_card numeric DEFAULT NULL::numeric)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if src.is_missing then raise exception 'Missing cards cannot be lent or sold' using errcode='23514'; end if;

  select coalesce(sum(quantity), 0)::integer
  into reserved
  from public.card_transactions
  where source_item_id = src.id
    and owner_id = auth.uid()
    and status in ('pending','active','return_pending');

  if src.quantity - reserved < p_quantity then
    raise exception 'Not enough available copies';
  end if;

  transaction_source_id := src.id;

  -- For contact loans, also move selected cards out of local holders.
  if p_transaction_type = 'loan' and src.holder_id is not null then
    select id into loose_id
    from public.collection_items
    where user_id = auth.uid()
      and card_id = src.card_id
      and holder_id is null
      and condition = src.condition
      and foil = src.foil and not is_missing
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

    if src.quantity = p_quantity then
      delete from public.collection_items
      where id = src.id;
    else
      update public.collection_items
      set quantity = quantity - p_quantity
      where id = src.id;
    end if;
  end if;

  if p_transaction_type = 'loan' then
    insert into public.card_transactions(
      owner_id,
      recipient_contact_id,
      source_item_id,
      card_id,
      transaction_type,
      quantity,
      condition,
      foil,
      price_per_card,
      status,
      responded_at
    )
    values(
      auth.uid(),
      p_contact_id,
      transaction_source_id,
      src.card_id,
      'loan',
      p_quantity,
      src.condition,
      src.foil,
      p_price_per_card,
      'active',
      now()
    )
    returning id into tx_id;
  else
    insert into public.card_transactions(
      owner_id,
      recipient_contact_id,
      source_item_id,
      card_id,
      transaction_type,
      quantity,
      condition,
      foil,
      price_per_card,
      status,
      responded_at,
      completed_at
    )
    values(
      auth.uid(),
      p_contact_id,
      src.id,
      src.card_id,
      'sale',
      p_quantity,
      src.condition,
      src.foil,
      p_price_per_card,
      'completed',
      now(),
      now()
    )
    returning id into tx_id;

    if src.quantity = p_quantity then
      delete from public.collection_items
      where id = src.id;
    else
      update public.collection_items
      set quantity = quantity - p_quantity
      where id = src.id;
    end if;
  end if;

  return tx_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_user_transaction(p_recipient_user_id uuid, p_source_item_id bigint, p_transaction_type text, p_quantity integer, p_price_per_card numeric DEFAULT NULL::numeric)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if src.is_missing then raise exception 'Missing cards cannot be lent or sold' using errcode='23514'; end if;

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
      and foil = src.foil and not is_missing
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
$function$
;

CREATE OR REPLACE FUNCTION public.request_borrow_from_friend(p_owner_user_id uuid, p_source_item_id bigint, p_quantity integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.respond_user_transaction(p_transaction_id bigint, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if src.is_missing then raise exception 'Missing cards cannot be lent or sold' using errcode='23514'; end if;

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
        and foil = src.foil and not is_missing
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
    and foil = tx.foil and not is_missing
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
$function$
;

CREATE OR REPLACE FUNCTION public.respond_missing_borrow_request(p_request_id bigint, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req public.borrow_card_requests%rowtype;
  source_id bigint;
  tx_id bigint;
begin
  select * into req
  from public.borrow_card_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'Request not found'; end if;
  if req.owner_user_id is distinct from auth.uid() then
    raise exception 'You cannot respond to this request';
  end if;
  if req.status <> 'pending' then raise exception 'Request already handled'; end if;

  if not p_accept then
    update public.borrow_card_requests
    set status = 'declined', responded_at = now()
    where id = req.id;
    return;
  end if;

  if not exists(
    select 1 from public.friendships
    where user_a = least(req.owner_user_id, req.requester_user_id)
      and user_b = greatest(req.owner_user_id, req.requester_user_id)
      and status = 'accepted'
  ) then
    raise exception 'Friendship is no longer active';
  end if;

  -- The owner accepting the notification confirms that these physical copies
  -- should be added to their collection. Keep them in My Collection and mark
  -- the requested quantity as an active loan to the requester.
  select id into source_id
  from public.collection_items
  where user_id = req.owner_user_id
    and card_id = req.card_id
    and holder_id is null
    and condition = req.condition
    and foil = req.foil and not is_missing
  limit 1
  for update;

  if source_id is null then
    insert into public.collection_items(
      user_id,card_id,holder_id,quantity,condition,foil
    ) values(
      req.owner_user_id,req.card_id,null,req.quantity,req.condition,req.foil
    ) returning id into source_id;
  else
    update public.collection_items
    set quantity = quantity + req.quantity
    where id = source_id;
  end if;

  insert into public.card_transactions(
    owner_id,recipient_user_id,source_item_id,card_id,transaction_type,
    quantity,condition,foil,price_per_card,status,requested_by,responded_at
  ) values(
    req.owner_user_id,req.requester_user_id,source_id,req.card_id,'loan',
    req.quantity,req.condition,req.foil,null,'active',req.requester_user_id,now()
  ) returning id into tx_id;

  update public.borrow_card_requests
  set status = 'accepted', responded_at = now(), transaction_id = tx_id
  where id = req.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fetch_friend_borrowable_inventory(p_friend_user_id uuid)
 RETURNS TABLE(source_item_id bigint, card_id text, card_name text, image_url text, holder_name text, holder_type text, quantity integer, available_quantity integer, condition text, foil boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  where ci.user_id = p_friend_user_id and not ci.is_missing
    and ci.quantity - coalesce((
      select sum(ct.quantity)::integer
      from public.card_transactions ct
      where ct.source_item_id = ci.id
        and ct.owner_id = p_friend_user_id
        and ct.status in ('pending','active','return_pending')
    ),0) > 0
  order by lower(cc.name), ci.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_holder_safe(p_holder_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      and foil = row_item.foil and is_missing = row_item.is_missing
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
$function$
;

CREATE OR REPLACE FUNCTION public.duplicate_deck(p_deck_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  source_deck public.holders%rowtype;
  new_id bigint;
  new_name text;
  suffix integer := 2;
begin
  select * into source_deck
  from public.holders
  where id = p_deck_id
    and user_id = auth.uid()
    and type = 'deck';

  if not found then
    raise exception 'Deck not found';
  end if;

  new_name := source_deck.name || ' Copy';

  while exists (
    select 1 from public.holders
    where user_id = auth.uid()
      and type = 'deck'
      and lower(name) = lower(new_name)
  ) loop
    new_name := source_deck.name || ' Copy ' || suffix;
    suffix := suffix + 1;
  end loop;

  insert into public.holders(user_id, name, type, format, notes)
  values(auth.uid(), new_name, 'deck', source_deck.format, source_deck.notes)
  returning id into new_id;

  insert into public.collection_items(
    user_id, card_id, holder_id, quantity, condition, foil, is_missing
  )
  select
    auth.uid(), card_id, new_id, quantity, condition, foil, is_missing
  from public.collection_items
  where holder_id = p_deck_id
    and user_id = auth.uid();

  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.move_collection_quantity(p_item_id bigint, p_quantity integer, p_holder_id bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  src public.collection_items%rowtype;
  target_id bigint;
  reserved integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':inventory',0));
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
    and foil = src.foil and is_missing = src.is_missing
    and id <> src.id
  limit 1
  for update;

  -- A free stack must not be merged into a stack whose quantity is locked.
  -- Check after locking the target row, as loan creation locks the same row.
  if target_id is not null and exists (
    select 1 from public.card_transactions
    where source_item_id = target_id
      and status in ('pending', 'active', 'return_pending')
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
      foil, is_missing
    )
    values(
      auth.uid(),
      src.card_id,
      p_holder_id,
      p_quantity,
      src.condition,
      src.foil, src.is_missing
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
$function$
;

CREATE OR REPLACE FUNCTION public.move_card_with_undo(p_item_id bigint, p_quantity integer, p_holder_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare src public.collection_items%rowtype; eligible boolean;
begin
  select * into src from public.collection_items where id=p_item_id and user_id=auth.uid() for update;
  if not found then raise exception 'Card not found' using errcode='42501'; end if;
  if src.holder_id is not distinct from p_holder_id then raise exception 'Choose another destination' using errcode='23514'; end if;
  eligible:=p_quantity=src.quantity and not exists(select 1 from public.collection_items
    where user_id=auth.uid() and id<>src.id and card_id=src.card_id and condition=src.condition and foil=src.foil and is_missing=src.is_missing and holder_id is not distinct from p_holder_id);
  perform public.move_collection_quantity(src.id,p_quantity,p_holder_id);
  if not eligible then return null; end if;
  return jsonb_build_object('user_id',auth.uid(),'kind','owned','source_id',src.id,
    'original_holder',src.holder_id,'expected_holder',p_holder_id,'quantity',src.quantity,'condition',src.condition,'foil',src.foil,'is_missing',src.is_missing,'card_id',src.card_id);
end; $function$
;

CREATE OR REPLACE FUNCTION public.undo_card_placement(p_change jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare src public.collection_items%rowtype; tx public.card_transactions%rowtype;
  original bigint:=(p_change->>'original_holder')::bigint; expected bigint:=(p_change->>'expected_holder')::bigint;
begin
  if auth.uid() is null or p_change->>'user_id' is distinct from auth.uid()::text then raise exception 'Not your move' using errcode='42501'; end if;
  if original is not null and not exists(select 1 from public.holders where id=original and user_id=auth.uid()) then
    raise exception 'Original holder no longer exists' using errcode='23514';
  end if;
  if p_change->>'kind'='owned' then
    select * into src from public.collection_items where id=(p_change->>'source_id')::bigint and user_id=auth.uid() for update;
    if not found or src.holder_id is distinct from expected or src.quantity::text is distinct from p_change->>'quantity'
      or src.card_id is distinct from p_change->>'card_id' or src.condition is distinct from p_change->>'condition'
      or src.foil::text is distinct from p_change->>'foil'
      or src.is_missing is distinct from coalesce((p_change->>'is_missing')::boolean,false)
      or exists(select 1 from public.card_transactions where source_item_id=src.id and status in ('pending','active','return_pending'))
      or exists(select 1 from public.collection_items where user_id=auth.uid() and id<>src.id and card_id=src.card_id
        and condition=src.condition and foil=src.foil and is_missing=src.is_missing and holder_id is not distinct from original) then
      raise exception 'Collection changed; this move cannot be undone' using errcode='23514';
    end if;
    perform public.move_collection_quantity(src.id,src.quantity,original);
  elsif p_change->>'kind'='borrowed' then
    select * into tx from public.card_transactions where id=(p_change->>'source_id')::bigint and recipient_user_id=auth.uid()
      and transaction_type='loan' for update;
    if not found or tx.borrower_holder_id is distinct from expected or tx.status is distinct from p_change->>'loan_status'
      or tx.status not in ('active','return_pending') or tx.quantity::text is distinct from p_change->>'quantity'
      or tx.card_id is distinct from p_change->>'card_id' or tx.condition is distinct from p_change->>'condition'
      or tx.foil::text is distinct from p_change->>'foil' then
      raise exception 'Loan changed; this move cannot be undone' using errcode='23514';
    end if;
    perform public.move_borrowed_loan(tx.id,original);
  else raise exception 'Invalid move' using errcode='23514';
  end if;
end; $function$
;

create or replace function public.move_borrowed_with_undo(p_transaction_id bigint,p_holder_id bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare tx public.card_transactions%rowtype;
begin
  select * into tx from public.card_transactions where id=p_transaction_id and recipient_user_id=auth.uid()
    and transaction_type='loan' and status in ('active','return_pending') for update;
  if not found then raise exception 'Borrowed card not found' using errcode='42501'; end if;
  if tx.borrower_holder_id is not distinct from p_holder_id then raise exception 'Choose another destination' using errcode='23514'; end if;
  perform public.move_borrowed_loan(tx.id,p_holder_id);
  return jsonb_build_object('user_id',auth.uid(),'kind','borrowed','source_id',tx.id,
    'original_holder',tx.borrower_holder_id,'expected_holder',p_holder_id,'quantity',tx.quantity,
    'condition',tx.condition,'foil',tx.foil,'card_id',tx.card_id,'loan_status',tx.status);
end; $$;



-- Convert only unmet requests. Dropping the optional targets makes reruns naturally idempotent.
do $$
declare target record; missing integer;
begin
  if to_regclass('public.decklist_entries') is not null then
    for target in execute 'select d.*, h.user_id from public.decklist_entries d join public.holders h on h.id=d.holder_id' loop
      select greatest(0,target.desired_quantity-coalesce(sum(qty),0))::integer into missing from (
        select greatest(0,ci.quantity-coalesce((select sum(t.quantity) from public.card_transactions t where t.source_item_id=ci.id
          and t.transaction_type='loan' and t.status in ('active','return_pending')),0)) as qty
        from public.collection_items ci join public.card_catalog c on c.id=ci.card_id
        where ci.user_id=target.user_id and ci.holder_id=target.holder_id
          and (case when c.oracle_id is null then 'printing:'||c.id else 'oracle:'||c.oracle_id end)=target.identity_key
        union all
        select t.quantity from public.card_transactions t join public.card_catalog c on c.id=t.card_id
        where t.recipient_user_id=target.user_id and t.borrower_holder_id=target.holder_id and t.transaction_type='loan'
          and t.status in ('active','return_pending')
          and (case when c.oracle_id is null then 'printing:'||c.id else 'oracle:'||c.oracle_id end)=target.identity_key
      ) counts;
      if missing>0 then
        insert into public.collection_items(user_id,card_id,holder_id,quantity,condition,foil,is_missing)
        values(target.user_id,target.card_id,target.holder_id,missing,'NM',false,true)
        on conflict (user_id,card_id,(coalesce(holder_id,0::bigint)),condition,foil,is_missing)
        do update set quantity=collection_items.quantity+excluded.quantity;
      end if;
    end loop;
  end if;
end $$;
drop function if exists public.fill_deck_entry(bigint,jsonb);
drop function if exists public.replace_decklist(bigint,jsonb);
drop trigger if exists serialize_deck_inventory on public.collection_items;
drop trigger if exists serialize_borrowed_deck_inventory on public.card_transactions;
drop trigger if exists guard_decklist_holder_type on public.holders;
drop table if exists public.decklist_entries;
drop function if exists public.validate_decklist_entry();
drop function if exists public.guard_decklist_holder_type();
drop function if exists public.serialize_deck_inventory();
revoke all on function public.move_card_with_undo(bigint,integer,bigint),public.move_borrowed_with_undo(bigint,bigint),
public.undo_card_placement(jsonb) from public,anon;
grant execute on function public.move_card_with_undo(bigint,integer,bigint),public.move_borrowed_with_undo(bigint,bigint),
public.undo_card_placement(jsonb) to authenticated;
create or replace function public.delete_deck_safe(p_deck_id bigint) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.holders where id=p_deck_id and user_id=auth.uid() and type='deck') then
  raise exception 'Deck not found' using errcode='42501'; end if;
 perform public.delete_holder_safe(p_deck_id);
end $$;
revoke all on function public.delete_deck_safe(bigint) from public,anon;
grant execute on function public.delete_deck_safe(bigint) to authenticated;
notify pgrst,'reload schema';
commit;

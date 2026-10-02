-- Missing-card borrow requests
-- Lets a friend request a card that is not currently in the lender's visible
-- borrowable collection. The owner must approve the notification first.

create table if not exists public.borrow_card_requests (
  id bigint generated always as identity primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null references public.card_catalog(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  condition text not null default 'NM' check (condition in ('NM','LP','MP','HP','DMG')),
  foil boolean not null default false,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  transaction_id bigint references public.card_transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create index if not exists borrow_card_requests_owner_status_idx
  on public.borrow_card_requests(owner_user_id,status,created_at desc);

create index if not exists borrow_card_requests_requester_status_idx
  on public.borrow_card_requests(requester_user_id,status,created_at desc);

alter table public.borrow_card_requests enable row level security;

drop policy if exists "borrow request participants can read" on public.borrow_card_requests;
create policy "borrow request participants can read"
  on public.borrow_card_requests
  for select
  to authenticated
  using (auth.uid() = owner_user_id or auth.uid() = requester_user_id);

create or replace function public.request_missing_borrow_card(
  p_owner_user_id uuid,
  p_card_id text,
  p_quantity integer
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  a uuid;
  b uuid;
  request_id bigint;
begin
  if p_owner_user_id = auth.uid() then raise exception 'Invalid owner'; end if;
  if p_quantity <= 0 then raise exception 'Invalid quantity'; end if;

  if not exists(select 1 from public.card_catalog where id = p_card_id) then
    raise exception 'Card is not in the catalog';
  end if;

  a := least(auth.uid(), p_owner_user_id);
  b := greatest(auth.uid(), p_owner_user_id);

  if not exists(
    select 1 from public.friendships
    where user_a = a and user_b = b and status = 'accepted'
  ) then
    raise exception 'Not an accepted friend';
  end if;

  if exists(
    select 1
    from public.borrow_card_requests
    where owner_user_id = p_owner_user_id
      and requester_user_id = auth.uid()
      and card_id = p_card_id
      and status = 'pending'
  ) then
    raise exception 'You already have a pending request for this card';
  end if;

  insert into public.borrow_card_requests(
    owner_user_id, requester_user_id, card_id, quantity
  ) values(
    p_owner_user_id, auth.uid(), p_card_id, p_quantity
  ) returning id into request_id;

  return request_id;
end;
$$;

create or replace function public.respond_missing_borrow_request(
  p_request_id bigint,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    and foil = req.foil
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
$$;

-- Extend the existing Pending delete RPC so borrowers can cancel a missing-card request.
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

  if p_kind = 'missing_borrow' then
    update public.borrow_card_requests
    set status = 'cancelled', responded_at = now()
    where id = p_id
      and requester_user_id = auth.uid()
      and status = 'pending';

    if not found then raise exception 'Pending missing-card request not found'; end if;
    return;
  end if;

  raise exception 'Invalid pending item';
end;
$$;

grant execute on function public.request_missing_borrow_card(uuid,text,integer) to authenticated;
grant execute on function public.respond_missing_borrow_request(bigint,boolean) to authenticated;
grant execute on function public.delete_pending_request(text,bigint) to authenticated;

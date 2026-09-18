-- MTG Card Tracker - clean v2 schema
-- Run in a NEW Supabase project.
--
-- MODEL
-- 1) holders = local physical places only: deck / binder / box
-- 2) friends = registered users with accepted friendship
-- 3) contacts = local non-user people
-- 4) loans/sales are transactions; ownership does NOT move until rules say so
-- 5) registered-user transactions start pending and require recipient acceptance

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.card_catalog (
  id text primary key,
  oracle_id text,
  name text not null,
  set_code text,
  set_name text,
  collector_number text,
  image_url text,
  type_line text,
  colors jsonb not null default '[]'::jsonb,
  cmc numeric,
  legalities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Local physical holders. Decks, binders and boxes behave the same.
create table if not exists public.holders (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('deck','binder','box')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.collection_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null references public.card_catalog(id) on delete restrict,
  holder_id bigint references public.holders(id) on delete set null,
  quantity integer not null default 1 check (quantity > 0),
  condition text not null default 'NM'
    check (condition in ('NM','LP','MP','HP','DMG')),
  foil boolean not null default false,
  created_at timestamptz not null default now()
);

-- Registered-user friend list.
create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  check (user_a <> user_b)
);

create unique index if not exists friendships_pair_unique
  on public.friendships (least(user_a,user_b), greatest(user_a,user_b));

-- Non-user people are local-only contacts owned by one account.
create table if not exists public.contacts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);

-- A loan/sale request is the security boundary.
-- Registered user: recipient_user_id set, starts pending, recipient must accept.
-- Non-user contact: recipient_contact_id set; since they cannot log in, owner can
-- manually activate/complete it in the UI.
create table if not exists public.card_transactions (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid references auth.users(id) on delete restrict,
  recipient_contact_id bigint references public.contacts(id) on delete restrict,
  source_item_id bigint not null references public.collection_items(id) on delete restrict,
  card_id text not null references public.card_catalog(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('loan','sale')),
  quantity integer not null check (quantity > 0),
  price_per_card numeric,
  status text not null default 'pending'
    check (status in ('pending','active','declined','completed','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  completed_at timestamptz,
  check (
    (recipient_user_id is not null and recipient_contact_id is null)
    or
    (recipient_user_id is null and recipient_contact_id is not null)
  )
);

create unique index if not exists collection_items_unique_stack
  on public.collection_items (
    user_id,
    card_id,
    coalesce(holder_id, 0::bigint),
    condition,
    foil
  );

create index if not exists collection_items_user_idx on public.collection_items(user_id);
create index if not exists collection_items_holder_idx on public.collection_items(user_id, holder_id);
create index if not exists holders_user_type_idx on public.holders(user_id, type);
create index if not exists contacts_user_idx on public.contacts(user_id);
create index if not exists transactions_owner_idx on public.card_transactions(owner_id, status);
create index if not exists transactions_recipient_idx on public.card_transactions(recipient_user_id, status);
create index if not exists card_catalog_name_idx on public.card_catalog(lower(name));

alter table public.profiles enable row level security;
alter table public.card_catalog enable row level security;
alter table public.holders enable row level security;
alter table public.collection_items enable row level security;
alter table public.friendships enable row level security;
alter table public.contacts enable row level security;
alter table public.card_transactions enable row level security;

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable"
on public.profiles for select to authenticated using (true);

drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own update"
on public.profiles for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "holders own rows" on public.holders;
create policy "holders own rows"
on public.holders for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "collection own rows" on public.collection_items;
create policy "collection own rows"
on public.collection_items for all to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and (
    holder_id is null
    or exists (
      select 1 from public.holders h
      where h.id = holder_id and h.user_id = auth.uid()
    )
  )
);

drop policy if exists "card catalog read" on public.card_catalog;
create policy "card catalog read"
on public.card_catalog for select to authenticated using (true);

drop policy if exists "card catalog insert" on public.card_catalog;
create policy "card catalog insert"
on public.card_catalog for insert to authenticated with check (true);

drop policy if exists "card catalog update" on public.card_catalog;
create policy "card catalog update"
on public.card_catalog for update to authenticated using (true) with check (true);

drop policy if exists "friendships participants read" on public.friendships;
create policy "friendships participants read"
on public.friendships for select to authenticated
using (auth.uid() in (user_a, user_b));

drop policy if exists "friendships create" on public.friendships;
create policy "friendships create"
on public.friendships for insert to authenticated
with check (
  requested_by = auth.uid()
  and auth.uid() in (user_a, user_b)
);

drop policy if exists "contacts own rows" on public.contacts;
create policy "contacts own rows"
on public.contacts for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "transactions participants read" on public.card_transactions;
create policy "transactions participants read"
on public.card_transactions for select to authenticated
using (
  owner_id = auth.uid()
  or recipient_user_id = auth.uid()
);

-- Do not allow arbitrary client-side updates/inserts for transactions.
-- Use the RPCs below so acceptance / inventory transfer stays atomic.

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.holders to authenticated;
grant select, insert, update, delete on public.collection_items to authenticated;
grant select, insert, update on public.card_catalog to authenticated;
grant select on public.friendships to authenticated;
grant select, insert on public.friendships to authenticated;
grant select, insert, update, delete on public.contacts to authenticated;
grant select on public.card_transactions to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Signup profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(user_id, username)
  values (new.id, null)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Friend request by target user id.
create or replace function public.send_friend_request(p_target uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  a uuid;
  b uuid;
  new_id bigint;
begin
  if p_target is null or p_target = auth.uid() then
    raise exception 'Invalid friend';
  end if;

  a := least(auth.uid(), p_target);
  b := greatest(auth.uid(), p_target);

  insert into public.friendships(user_a,user_b,requested_by,status)
  values(a,b,auth.uid(),'pending')
  on conflict (least(user_a,user_b), greatest(user_a,user_b))
  do update set requested_by = excluded.requested_by, status='pending'
  returning id into new_id;

  return new_id;
end;
$$;

-- Accept / decline a friend request.
create or replace function public.respond_friend_request(p_friendship_id bigint, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.friendships%rowtype;
begin
  select * into f from public.friendships where id=p_friendship_id for update;
  if not found then raise exception 'Friend request not found'; end if;
  if auth.uid() not in (f.user_a,f.user_b) or auth.uid() = f.requested_by then
    raise exception 'Not allowed';
  end if;

  if p_accept then
    update public.friendships set status='accepted' where id=f.id;
  else
    delete from public.friendships where id=f.id;
  end if;
end;
$$;

-- Create registered-user transaction request.
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
  tx_id bigint;
begin
  if p_transaction_type not in ('loan','sale') then raise exception 'Invalid type'; end if;
  if p_quantity <= 0 then raise exception 'Invalid quantity'; end if;

  a := least(auth.uid(), p_recipient_user_id);
  b := greatest(auth.uid(), p_recipient_user_id);

  if not exists (
    select 1 from public.friendships
    where user_a=a and user_b=b and status='accepted'
  ) then
    raise exception 'Recipient must be an accepted friend';
  end if;

  select * into src
  from public.collection_items
  where id=p_source_item_id and user_id=auth.uid()
  for update;

  if not found or src.quantity < p_quantity then
    raise exception 'Not enough available copies';
  end if;

  insert into public.card_transactions(
    owner_id, recipient_user_id, source_item_id, card_id,
    transaction_type, quantity, price_per_card, status
  )
  values(
    auth.uid(), p_recipient_user_id, src.id, src.card_id,
    p_transaction_type, p_quantity, p_price_per_card, 'pending'
  )
  returning id into tx_id;

  return tx_id;
end;
$$;

-- Non-user contact transaction. There is no remote account to notify/accept,
-- so this returns a pending row for the owner to manually confirm in UI.
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
  tx_id bigint;
begin
  if p_transaction_type not in ('loan','sale') then raise exception 'Invalid type'; end if;
  if p_quantity <= 0 then raise exception 'Invalid quantity'; end if;
  if not exists(select 1 from public.contacts where id=p_contact_id and user_id=auth.uid()) then
    raise exception 'Contact not found';
  end if;

  select * into src
  from public.collection_items
  where id=p_source_item_id and user_id=auth.uid()
  for update;

  if not found or src.quantity < p_quantity then
    raise exception 'Not enough available copies';
  end if;

  insert into public.card_transactions(
    owner_id, recipient_contact_id, source_item_id, card_id,
    transaction_type, quantity, price_per_card, status
  )
  values(
    auth.uid(), p_contact_id, src.id, src.card_id,
    p_transaction_type, p_quantity, p_price_per_card, 'pending'
  )
  returning id into tx_id;

  return tx_id;
end;
$$;

-- Registered recipient acceptance.
-- Loan: owner keeps ownership, transaction becomes active.
-- Sale: inventory ownership moves atomically on acceptance.
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
  existing_id bigint;
begin
  select * into tx from public.card_transactions where id=p_transaction_id for update;
  if not found then raise exception 'Transaction not found'; end if;
  if tx.recipient_user_id <> auth.uid() then raise exception 'Not recipient'; end if;
  if tx.status <> 'pending' then raise exception 'Transaction already handled'; end if;

  if not p_accept then
    update public.card_transactions
    set status='declined', responded_at=now()
    where id=tx.id;
    return;
  end if;

  select * into src
  from public.collection_items
  where id=tx.source_item_id and user_id=tx.owner_id
  for update;

  if not found or src.quantity < tx.quantity then
    raise exception 'Source inventory changed';
  end if;

  if tx.transaction_type='sale' then
    if src.quantity = tx.quantity then
      delete from public.collection_items where id=src.id;
    else
      update public.collection_items
      set quantity=quantity-tx.quantity
      where id=src.id;
    end if;

    select id into existing_id
    from public.collection_items
    where user_id=tx.recipient_user_id
      and card_id=tx.card_id
      and holder_id is null
      and condition=src.condition
      and foil=src.foil
    limit 1
    for update;

    if existing_id is null then
      insert into public.collection_items(
        user_id,card_id,holder_id,quantity,condition,foil
      )
      values(
        tx.recipient_user_id,tx.card_id,null,tx.quantity,src.condition,src.foil
      );
    else
      update public.collection_items
      set quantity=quantity+tx.quantity
      where id=existing_id;
    end if;

    update public.card_transactions
    set status='completed', responded_at=now(), completed_at=now()
    where id=tx.id;
  else
    update public.card_transactions
    set status='active', responded_at=now()
    where id=tx.id;
  end if;
end;
$$;

grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.respond_friend_request(bigint,boolean) to authenticated;
grant execute on function public.create_user_transaction(uuid,bigint,text,integer,numeric) to authenticated;
grant execute on function public.create_contact_transaction(bigint,bigint,text,integer,numeric) to authenticated;
grant execute on function public.respond_user_transaction(bigint,boolean) to authenticated;

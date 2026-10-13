-- Saved plans, atomic filling and conditional placement Undo.
-- Apply after the existing tracker migrations, including active_loan_edit_guard.
begin;
create table public.decklist_entries (
  id bigint generated always as identity primary key,
  holder_id bigint not null references public.holders(id) on delete cascade,
  card_id text not null references public.card_catalog(id),
  identity_key text not null,
  desired_quantity integer not null check (desired_quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(holder_id,identity_key)
);
alter table public.decklist_entries enable row level security;
create policy "decklist owned decks" on public.decklist_entries for all to authenticated
using (exists(select 1 from public.holders h where h.id=holder_id and h.user_id=(select auth.uid()) and h.type='deck'))
with check (exists(select 1 from public.holders h where h.id=holder_id and h.user_id=(select auth.uid()) and h.type='deck'));
grant select on public.decklist_entries to authenticated;

create function public.validate_decklist_entry() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.holders where id=new.holder_id and type='deck') then
    raise exception 'Decklist requires a deck' using errcode='23514';
  end if;
  select case when oracle_id is null then 'printing:'||id else 'oracle:'||oracle_id end
  into new.identity_key from public.card_catalog where id=new.card_id;
  if new.identity_key is null then raise exception 'Unknown card' using errcode='23514'; end if;
  new.updated_at:=now();
  return new;
end; $$;
create trigger validate_decklist_entry before insert or update on public.decklist_entries
for each row execute function public.validate_decklist_entry();
create function public.guard_decklist_holder_type() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if new.type<>'deck' and exists(select 1 from public.decklist_entries where holder_id=old.id) then
    raise exception 'Clear the saved decklist before changing holder type' using errcode='23514';
  end if;
  return new;
end; $$;
create trigger guard_decklist_holder_type before update of type on public.holders
for each row execute function public.guard_decklist_holder_type();
revoke all on function public.validate_decklist_entry(),public.guard_decklist_holder_type() from public,anon,authenticated;

-- Moves/returns and direct inventory edits share the deck lock used by Fill.
-- A concurrent operation either serializes or rolls back; it cannot overfill
-- after the deficit was calculated against an unlocked destination.
create function public.serialize_deck_inventory() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare old_holder bigint; new_holder bigint;
begin
  if tg_table_name='collection_items' then
    if tg_op<>'INSERT' then old_holder:=old.holder_id; end if;
    if tg_op<>'DELETE' then new_holder:=new.holder_id; end if;
  else
    if tg_op<>'INSERT' then old_holder:=old.borrower_holder_id; end if;
    if tg_op<>'DELETE' then new_holder:=new.borrower_holder_id; end if;
  end if;
  perform 1 from public.holders where id in (old_holder,new_holder) and type='deck' order by id for update;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
create trigger serialize_deck_inventory before insert or update or delete on public.collection_items
for each row execute function public.serialize_deck_inventory();
create trigger serialize_borrowed_deck_inventory before insert or update or delete on public.card_transactions
for each row execute function public.serialize_deck_inventory();
revoke all on function public.serialize_deck_inventory() from public,anon,authenticated;

create function public.replace_decklist(p_deck_id bigint,p_entries jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare entry_json jsonb;
begin
  perform 1 from public.holders where id=p_deck_id and user_id=auth.uid() and type='deck' for update;
  if not found then raise exception 'Deck not found' using errcode='42501'; end if;
  if p_entries is null or jsonb_typeof(p_entries)<>'array' then raise exception 'Expected a decklist array' using errcode='23514'; end if;
  for entry_json in select value from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(entry_json)<>'object' or jsonb_typeof(entry_json->'card_id')<>'string'
      or coalesce(entry_json->>'desired_quantity','') !~ '^[1-9][0-9]*$'
      or length(entry_json->>'desired_quantity')>10 or (entry_json->>'desired_quantity')::numeric>2147483647
      or not exists(select 1 from public.card_catalog where id=entry_json->>'card_id') then
      raise exception 'Invalid card or quantity' using errcode='23514';
    end if;
  end loop;
  delete from public.decklist_entries where holder_id=p_deck_id;
  insert into public.decklist_entries(holder_id,card_id,identity_key,desired_quantity)
  select p_deck_id,min(c.id),case when c.oracle_id is null then 'printing:'||c.id else 'oracle:'||c.oracle_id end,
    sum((x->>'desired_quantity')::integer)::integer
  from jsonb_array_elements(p_entries) x join public.card_catalog c on c.id=x->>'card_id'
  group by case when c.oracle_id is null then 'printing:'||c.id else 'oracle:'||c.oracle_id end;
end; $$;

create function public.fill_deck_entry(p_entry_id bigint,p_allocations jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  target public.decklist_entries%rowtype; deck_id bigint; allocation_json jsonb;
  src public.collection_items%rowtype; tx public.card_transactions%rowtype;
  placed bigint; requested bigint:=0; qty integer; identity text; reserved bigint;
begin
  select holder_id into deck_id from public.decklist_entries where id=p_entry_id;
  perform 1 from public.holders where id=deck_id and user_id=auth.uid() and type='deck' for update;
  if not found then raise exception 'Deck not found' using errcode='42501'; end if;
  select * into target from public.decklist_entries where id=p_entry_id and holder_id=deck_id for update;
  if not found then raise exception 'Decklist changed; refresh and retry' using errcode='23514'; end if;
  if p_allocations is null or jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)=0 then
    raise exception 'Select at least one source' using errcode='23514';
  end if;
  for allocation_json in select value from jsonb_array_elements(p_allocations) loop
    if coalesce(allocation_json->>'kind','') not in ('owned','borrowed')
      or coalesce(allocation_json->>'source_id','') !~ '^[1-9][0-9]*$'
      or coalesce(allocation_json->>'quantity','') !~ '^[1-9][0-9]*$'
      or length(allocation_json->>'quantity')>10 or (allocation_json->>'quantity')::numeric>2147483647 then
      raise exception 'Invalid allocation' using errcode='23514';
    end if;
    requested:=requested+(allocation_json->>'quantity')::integer;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_allocations) x
    group by x->>'kind',(x->>'source_id')::bigint having count(*)>1) then
    raise exception 'Duplicate source' using errcode='23514';
  end if;
  -- Lock destination inventory, then source rows, then borrowed transactions.
  -- All fillers for this deck share the deck-row lock above.
  perform 1 from public.collection_items where user_id=auth.uid() and holder_id=deck_id order by id for update;
  perform 1 from public.collection_items where user_id=auth.uid() and id in (
    select (x->>'source_id')::bigint from jsonb_array_elements(p_allocations) x where x->>'kind'='owned'
  ) order by id for update;
  perform 1 from public.card_transactions where recipient_user_id=auth.uid() and id in (
    select (x->>'source_id')::bigint from jsonb_array_elements(p_allocations) x where x->>'kind'='borrowed'
  ) order by id for update;
  select coalesce(sum(greatest(0,ci.quantity-coalesce((
    select sum(t.quantity) from public.card_transactions t where t.source_item_id=ci.id
      and t.owner_id=auth.uid() and t.transaction_type='loan' and t.status in ('active','return_pending')
  ),0))),0) into placed from public.collection_items ci join public.card_catalog c on c.id=ci.card_id
  where ci.user_id=auth.uid() and ci.holder_id=deck_id
    and (case when c.oracle_id is null then 'printing:'||c.id else 'oracle:'||c.oracle_id end)=target.identity_key;
  select placed+coalesce(sum(t.quantity),0) into placed
  from public.card_transactions t join public.card_catalog c on c.id=t.card_id
  where t.recipient_user_id=auth.uid() and t.borrower_holder_id=deck_id and t.transaction_type='loan'
    and t.status in ('active','return_pending')
    and (case when c.oracle_id is null then 'printing:'||c.id else 'oracle:'||c.oracle_id end)=target.identity_key;
  if requested>greatest(0,target.desired_quantity-placed) then
    raise exception 'Decklist changed or selected copies exceed the missing quantity' using errcode='23514';
  end if;
  for allocation_json in select value from jsonb_array_elements(p_allocations) order by value->>'kind',(value->>'source_id')::bigint loop
    qty:=(allocation_json->>'quantity')::integer;
    if allocation_json->>'kind'='owned' then
      select * into src from public.collection_items where id=(allocation_json->>'source_id')::bigint and user_id=auth.uid();
      if not found then raise exception 'Source not found' using errcode='42501'; end if;
      if src.holder_id=deck_id or exists(select 1 from public.holders where id=src.holder_id and type='deck') then
        raise exception 'Choose a source outside other decks' using errcode='23514';
      end if;
      select case when oracle_id is null then 'printing:'||id else 'oracle:'||oracle_id end into identity from public.card_catalog where id=src.card_id;
      select coalesce(sum(quantity),0) into reserved from public.card_transactions
      where source_item_id=src.id and status in ('pending','active','return_pending');
      if identity<>target.identity_key or qty>src.quantity or reserved>0 then
        raise exception 'Source is reserved, unavailable or a different card' using errcode='23514';
      end if;
      perform public.move_collection_quantity(src.id,qty,deck_id);
    else
      select * into tx from public.card_transactions where id=(allocation_json->>'source_id')::bigint
        and recipient_user_id=auth.uid() and transaction_type='loan' and status in ('active','return_pending');
      if not found then raise exception 'Borrowed source not found' using errcode='42501'; end if;
      select case when oracle_id is null then 'printing:'||id else 'oracle:'||oracle_id end into identity from public.card_catalog where id=tx.card_id;
      if qty<>tx.quantity or identity<>target.identity_key or tx.borrower_holder_id=deck_id
        or exists(select 1 from public.holders where id=tx.borrower_holder_id and type='deck') then
        raise exception 'Borrowed copies move as a whole stack from outside other decks' using errcode='23514';
      end if;
      perform public.move_borrowed_loan(tx.id,deck_id);
    end if;
  end loop;
end; $$;

create function public.move_card_with_undo(p_item_id bigint,p_quantity integer,p_holder_id bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare src public.collection_items%rowtype; eligible boolean;
begin
  select * into src from public.collection_items where id=p_item_id and user_id=auth.uid() for update;
  if not found then raise exception 'Card not found' using errcode='42501'; end if;
  if src.holder_id is not distinct from p_holder_id then raise exception 'Choose another destination' using errcode='23514'; end if;
  eligible:=p_quantity=src.quantity and not exists(select 1 from public.collection_items
    where user_id=auth.uid() and id<>src.id and card_id=src.card_id and condition=src.condition and foil=src.foil and holder_id is not distinct from p_holder_id);
  perform public.move_collection_quantity(src.id,p_quantity,p_holder_id);
  if not eligible then return null; end if;
  return jsonb_build_object('user_id',auth.uid(),'kind','owned','source_id',src.id,
    'original_holder',src.holder_id,'expected_holder',p_holder_id,'quantity',src.quantity,'condition',src.condition,'foil',src.foil,'card_id',src.card_id);
end; $$;

create function public.move_borrowed_with_undo(p_transaction_id bigint,p_holder_id bigint) returns jsonb
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

create function public.undo_card_placement(p_change jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
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
      or exists(select 1 from public.card_transactions where source_item_id=src.id and status in ('pending','active','return_pending'))
      or exists(select 1 from public.collection_items where user_id=auth.uid() and id<>src.id and card_id=src.card_id
        and condition=src.condition and foil=src.foil and holder_id is not distinct from original) then
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
end; $$;

revoke all on function public.replace_decklist(bigint,jsonb),public.fill_deck_entry(bigint,jsonb),
 public.move_card_with_undo(bigint,integer,bigint),public.move_borrowed_with_undo(bigint,bigint),public.undo_card_placement(jsonb) from public,anon;
grant execute on function public.replace_decklist(bigint,jsonb),public.fill_deck_entry(bigint,jsonb),
 public.move_card_with_undo(bigint,integer,bigint),public.move_borrowed_with_undo(bigint,bigint),public.undo_card_placement(jsonb) to authenticated;
commit;

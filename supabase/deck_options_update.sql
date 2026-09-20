-- MTG Tracker deck options update
-- Run this once in Supabase SQL Editor.

create or replace function public.delete_deck_safe(p_deck_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  row_item record;
  target_id bigint;
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

  for row_item in
    select *
    from public.collection_items
    where holder_id = p_deck_id
      and user_id = auth.uid()
    for update
  loop
    select id into target_id
    from public.collection_items
    where user_id = auth.uid()
      and card_id = row_item.card_id
      and holder_id is null
      and condition = row_item.condition
      and foil = row_item.foil
    limit 1
    for update;

    if target_id is null then
      update public.collection_items
      set holder_id = null
      where id = row_item.id;
    else
      update public.collection_items
      set quantity = quantity + row_item.quantity
      where id = target_id;

      delete from public.collection_items
      where id = row_item.id;
    end if;
  end loop;

  delete from public.holders
  where id = p_deck_id
    and user_id = auth.uid()
    and type = 'deck';
end;
$$;

create or replace function public.duplicate_deck(p_deck_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
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
    user_id, card_id, holder_id, quantity, condition, foil
  )
  select
    auth.uid(), card_id, new_id, quantity, condition, foil
  from public.collection_items
  where holder_id = p_deck_id
    and user_id = auth.uid();

  return new_id;
end;
$$;

grant execute on function public.delete_deck_safe(bigint) to authenticated;
grant execute on function public.duplicate_deck(bigint) to authenticated;

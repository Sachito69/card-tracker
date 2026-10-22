-- Run once in Supabase SQL Editor.
-- Atomically lend every physical, available card in a deck.
-- Existing per-card notifications/return handling remains in place.
create or replace function public.lend_deck(
  p_deck_id bigint,
  p_recipient_user_id uuid default null,
  p_contact_id bigint default null
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_row record;
  v_count integer := 0;
  v_reserved integer;
begin
  if v_owner is null then raise exception 'Sign in first'; end if;
  if ((p_recipient_user_id is not null)::integer + (p_contact_id is not null)::integer) <> 1
    then raise exception 'Choose exactly one recipient'; end if;
  if not exists(select 1 from public.holders where id=p_deck_id and user_id=v_owner and type='deck')
    then raise exception 'Deck not found'; end if;
  if p_recipient_user_id is not null and not exists(
    select 1 from public.friendships
    where user_a=least(v_owner,p_recipient_user_id)
      and user_b=greatest(v_owner,p_recipient_user_id)
      and status='accepted'
  ) then raise exception 'Recipient must be an accepted friend'; end if;
  if p_contact_id is not null and not exists(
    select 1 from public.contacts where id=p_contact_id and user_id=v_owner
  ) then raise exception 'Contact not found'; end if;

  -- Lock sources first; either all requests are created or none are.
  for v_row in
    select id, quantity
    from public.collection_items
    where holder_id=p_deck_id and user_id=v_owner and coalesce(is_missing,false)=false
    order by id for update
  loop
    select coalesce(sum(quantity),0)::integer into v_reserved
    from public.card_transactions
    where owner_id=v_owner and source_item_id=v_row.id
      and status in ('pending','active','return_pending');
    if v_row.quantity-v_reserved <> v_row.quantity then
      raise exception 'Some cards in this deck are already reserved or lent';
    end if;
    if p_recipient_user_id is not null then
      perform public.create_user_transaction(p_recipient_user_id,v_row.id,'loan',v_row.quantity,null);
    else
      perform public.create_contact_transaction(p_contact_id,v_row.id,'loan',v_row.quantity,null);
    end if;
    v_count := v_count+1;
  end loop;
  if v_count=0 then raise exception 'Deck has no physical cards to lend'; end if;
  return v_count;
end;
$$;
revoke all on function public.lend_deck(bigint,uuid,bigint) from public;
grant execute on function public.lend_deck(bigint,uuid,bigint) to authenticated;

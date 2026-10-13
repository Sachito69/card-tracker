-- Run inside the local fixture database. ROLLBACK leaves fixture data intact.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.replace_decklist(1,'[{"card_id":"ring","desired_quantity":4}]');
do $$
begin
  if (select desired_quantity from public.decklist_entries where holder_id=1) <> 4 then raise exception 'Target save failed'; end if;
  if (select sum(quantity) from public.collection_items) <> 7 then raise exception 'Plan changed physical inventory'; end if;
end;
$$;
select public.fill_deck_entry((select id from public.decklist_entries where holder_id=1),
  '[{"kind":"owned","source_id":1,"quantity":2},{"kind":"borrowed","source_id":1,"quantity":1}]');
do $$
declare entry bigint; before_qty integer;
begin
  select id into entry from public.decklist_entries where holder_id=1;
  select quantity into before_qty from public.collection_items where id=2;
  begin
    perform public.fill_deck_entry(entry,'[{"kind":"owned","source_id":2,"quantity":2}]');
    raise exception 'Overfill accepted';
  exception when check_violation then null;
  end;
  if (select quantity from public.collection_items where id=2) <> before_qty then raise exception 'Failed fill changed source'; end if;
  perform public.replace_decklist(1,'[{"card_id":"ring","desired_quantity":6}]');
  select id into entry from public.decklist_entries where holder_id=1;
  begin
    perform public.fill_deck_entry(entry,'[{"kind":"owned","source_id":2,"quantity":1},{"kind":"owned","source_id":3,"quantity":1}]');
    raise exception 'Reserved later source accepted';
  exception when check_violation then null;
  end;
  if (select quantity from public.collection_items where id=2) <> before_qty then raise exception 'Partial allocation was not rolled back'; end if;
  perform public.replace_decklist(1,'[{"card_id":"ring","desired_quantity":4}]');
  select id into entry from public.decklist_entries where holder_id=1;
  begin
    perform public.fill_deck_entry(entry,'[{"kind":"owned","source_id":2,"quantity":1},{"kind":"owned","source_id":2,"quantity":1}]');
    raise exception 'Duplicate allocation accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.replace_decklist(4,'[{"card_id":"ring","desired_quantity":1}]');
    raise exception 'Foreign deck accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.replace_decklist(1,'[{"card_id":"ring","desired_quantity":1.5}]');
    raise exception 'Fraction accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.fill_deck_entry(entry,'[{"kind":"owned","source_id":3,"quantity":1}]');
    raise exception 'Reserved source accepted';
  exception when check_violation then null;
  end;
end;
$$;
select public.fill_deck_entry((select id from public.decklist_entries where holder_id=1),'[{"kind":"owned","source_id":2,"quantity":1}]');
select public.replace_decklist(1,'[{"card_id":"ring","desired_quantity":2},{"card_id":"ring2","desired_quantity":2}]');
do $$
begin
  if (select count(*) from public.decklist_entries where holder_id=1) <> 1 then raise exception 'Editions did not combine'; end if;
end;
$$;
do $$
declare undo jsonb; failed boolean:=false;
begin
  undo:=public.move_card_with_undo(2,2,3);
  if undo is null then raise exception 'Safe move omitted Undo'; end if;
  perform public.undo_card_placement(undo);
  if (select holder_id from public.collection_items where id=2)<>2 then raise exception 'Undo did not restore placement'; end if;
  undo:=public.move_card_with_undo(2,2,3);
  update public.collection_items set condition='LP' where id=2;
  begin
    perform public.undo_card_placement(undo);
    raise exception 'Stale Undo accepted';
  exception when check_violation then failed:=true;
  end;
  if not failed then raise exception 'Undo conflict not tested'; end if;
  undo:=public.move_borrowed_with_undo(1,2);
  perform public.undo_card_placement(undo);
  if (select borrower_holder_id from public.card_transactions where id=1)<>1 then raise exception 'Borrowed Undo did not restore'; end if;
  if has_function_privilege('anon','public.fill_deck_entry(bigint,jsonb)','EXECUTE') then raise exception 'Anonymous Fill execution exposed'; end if;
  if has_function_privilege('anon','public.undo_card_placement(jsonb)','EXECUTE') then raise exception 'Anonymous Undo execution exposed'; end if;
end;
$$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$
begin
  if exists(select 1 from public.decklist_entries where holder_id=1) then raise exception 'Plan leaked across users'; end if;
end;
$$;
rollback;

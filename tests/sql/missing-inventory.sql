begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare missing_id bigint; owned_id bigint; failed boolean;
begin
  missing_id:=public.add_inventory_stack('ring',4,'NM',false,1,true);
  perform public.acquire_missing_stack(missing_id,1);
  if (select quantity from collection_items where id=missing_id)<>3 then raise exception 'Expected 3 missing'; end if;
  if (select sum(quantity) from collection_items where holder_id=1 and not is_missing)<>1 then raise exception 'Expected 1 owned'; end if;
  failed:=false;
  begin perform public.acquire_missing_stack(missing_id,4); exception when check_violation then failed:=true; end;
  if not failed then raise exception 'Overacquisition accepted'; end if;
  failed:=false;
  begin update collection_items set is_missing=false where id=missing_id; exception when check_violation then failed:=true; end;
  if not failed then raise exception 'Direct status flip accepted'; end if;
  failed:=false;
  begin perform public.add_inventory_stack('ring',1,'NM',false,4,true); exception when insufficient_privilege then failed:=true; end;
  if not failed then raise exception 'Foreign holder accepted'; end if;
  failed:=false;
  begin perform public.create_user_transaction('22222222-2222-4222-8222-222222222222',missing_id,'loan',1,null); exception when others then failed:=true; end;
  if not failed then raise exception 'Missing loan accepted'; end if;
  perform public.move_collection_quantity(missing_id,1,2);
  if (select quantity from collection_items where holder_id=2 and is_missing)<>1 then raise exception 'Move lost status'; end if;
  perform public.acquire_missing_stack(missing_id,2);
  if exists(select 1 from collection_items where id=missing_id) then raise exception 'Acquired row remains'; end if;
end $$;
rollback;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare missing_id bigint; failed boolean; undo jsonb;
begin
  missing_id:=public.add_inventory_stack('ring',2,'NM',false,3,true);
  failed:=false;
  begin perform public.acquire_missing_stack(missing_id,1); exception when check_violation then failed:=true; end;
  if not failed then raise exception 'Merged acquisition into pending reservation'; end if;
  if (select quantity from collection_items where id=missing_id)<>2 then raise exception 'Failure reduced missing quantity'; end if;
  failed:=false;
  begin perform public.add_inventory_stack('ring',1,'NM',false,3,false); exception when check_violation then failed:=true; end;
  if not failed then raise exception 'Added into reserved stack'; end if;
  failed:=false;
  begin perform public.create_user_transaction('22222222-2222-4222-8222-222222222222',missing_id,'sale',1,null); exception when others then failed:=true; end;
  if not failed then raise exception 'Sold missing copies'; end if;
  failed:=false;
  begin update collection_items set holder_id=4 where id=missing_id; exception when check_violation then failed:=true; end;
  if not failed then raise exception 'Direct foreign placement accepted'; end if;
  undo:=public.move_card_with_undo(missing_id,2,1);
  perform public.undo_card_placement(undo);
  if not (select is_missing and holder_id=3 from collection_items where id=missing_id) then raise exception 'Undo changed missing status'; end if;
  perform public.delete_holder_safe(3);
  if not (select is_missing and holder_id is null from collection_items where id=missing_id) then raise exception 'Holder deletion lost missing request'; end if;
  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
  if exists(select 1 from collection_items where id=missing_id) then raise exception 'RLS exposes other user inventory'; end if;
  failed:=false;
  begin perform public.acquire_missing_stack(missing_id,1); exception when check_violation then failed:=true; end;
  if not failed then raise exception 'Foreign acquisition accepted'; end if;
end $$;
rollback;
do $$ begin
 if has_function_privilege('anon','public.acquire_missing_stack(bigint,integer)','execute') then raise exception 'Anonymous acquisition allowed'; end if;
end $$;
-- A sale creates owned copies even if the buyer already has an identical missing request.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare source_id bigint; request_id bigint; missing_id bigint; failed boolean;
begin
 source_id:=public.add_inventory_stack('other',2,'NM',false,2,false);
 request_id:=public.create_user_transaction('22222222-2222-4222-8222-222222222222',source_id,'sale',2,null);
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 missing_id:=public.add_inventory_stack('other',4,'NM',false,null,true);
 perform public.respond_user_transaction(request_id,true);
 if (select quantity from collection_items where id=missing_id)<>4 then raise exception 'Sale changed missing request'; end if;
 if (select sum(quantity) from collection_items where card_id='other' and not is_missing)<>2 then raise exception 'Sale did not create owned copies'; end if;
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 source_id:=public.add_inventory_stack('other',2,'NM',true,1,true);
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 failed:=false;
 begin perform public.request_borrow_from_friend('11111111-1111-4111-8111-111111111111',source_id,1); exception when check_violation then failed:=true; end;
 if not failed then raise exception 'Borrowed missing source'; end if;
 if exists(select 1 from public.fetch_friend_borrowable_inventory('11111111-1111-4111-8111-111111111111') where source_item_id=source_id) then raise exception 'Borrow list exposes missing'; end if;
end $$;
rollback;
-- Existing borrower placement and lender edit restrictions survive the replacement.
begin;
update public.card_transactions set status='active' where id=2;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare undo jsonb; failed boolean;
begin
 failed:=false;
 begin update collection_items set quantity=3 where id=3; exception when check_violation then failed:=true; end;
 if not failed then raise exception 'Active lender quantity became editable'; end if;
 failed:=false;
 begin update collection_items set foil=true where id=3; exception when check_violation then failed:=true; end;
 if not failed then raise exception 'Active lender finish became editable'; end if;
 undo:=public.move_borrowed_with_undo(1,2);
 if (select borrower_holder_id from card_transactions where id=1)<>2 then raise exception 'Borrowed move failed'; end if;
 perform public.undo_card_placement(undo);
 if (select owner_id from card_transactions where id=1) <> '22222222-2222-4222-8222-222222222222'::uuid then raise exception 'Borrowed ownership changed'; end if;
end $$;
rollback;

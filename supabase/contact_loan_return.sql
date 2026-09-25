-- Non-user/contact loan return support
-- Run once in Supabase SQL Editor.

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
  set
    status = 'completed',
    responded_at = coalesce(responded_at, now()),
    completed_at = now()
  where id = p_transaction_id
    and owner_id = auth.uid()
    and recipient_contact_id is not null
    and transaction_type = 'loan'
    and status in ('active', 'return_pending');

  if not found then
    raise exception 'Active contact loan not found';
  end if;
end;
$$;

grant execute on function public.complete_contact_loan(bigint) to authenticated;

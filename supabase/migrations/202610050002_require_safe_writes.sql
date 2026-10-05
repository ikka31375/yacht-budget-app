-- Apply after the updated application is live. Older open tabs must reload.
begin;

-- Prevent older browsers from bypassing the transaction and racing the new app.
-- Dashboard/SQL administration remains available to the database owner.
create or replace function public.require_club_accounting_operation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') and coalesce(current_setting('app.club_accounting_write', true), '') <> 'on' then
    raise exception '画面を再読み込みして、更新後のアプリから操作してください。';
  end if;
  return null;
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array['payments', 'expenses', 'billing_events', 'club_transactions', 'offset_transactions'] loop
    execute format('drop trigger if exists require_club_accounting_operation on public.%I', v_table);
    execute format('create trigger require_club_accounting_operation before insert or update or delete on public.%I for each statement execute function public.require_club_accounting_operation()', v_table);
  end loop;
end;
$$;

revoke all on function public.require_club_accounting_operation() from public;
commit;

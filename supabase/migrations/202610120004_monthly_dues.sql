begin;
select pg_advisory_xact_lock(812903472);
create temporary table dues_migration_before on commit drop as
  select jsonb_object_agg(key, (select coalesce(jsonb_agg(row - array['billing_kind','billing_month','dues_month','dues_excluded_months'] order by row->>'id'),'[]'::jsonb) from jsonb_array_elements(value) row)) snapshot
  from jsonb_each(public.get_club_accounting_snapshot());

-- Only unambiguous legacy titles are classified. Cash dates are never used.
create or replace function public.infer_dues_month(p_title text, p_due date)
returns date language plpgsql immutable set search_path = '' as $$
declare parts text[]; result date;
begin
  parts := regexp_match(p_title, '^([0-9]{4})年([0-9]{1,2})月部費([（(].*[）)])?$');
  if parts is not null then
    if parts[2]::integer not between 1 and 12 then return null; end if;
    result := make_date(parts[1]::integer, parts[2]::integer, 1);
  else
    parts := regexp_match(p_title, '^([0-9]{1,2})月(度)?部費$');
    if parts is null or parts[1]::integer <> extract(month from p_due)::integer then return null; end if;
    result := date_trunc('month', p_due)::date;
  end if;
  return result;
exception when datetime_field_overflow then return null;
end $$;

do $$
declare first_run boolean;
begin
  first_run := not exists(select 1 from information_schema.columns where table_schema='public' and table_name='billing_events' and column_name='billing_kind');
  alter table public.billing_events add column if not exists billing_kind text not null default 'other';
  alter table public.billing_events add column if not exists billing_month date;
  alter table public.payments add column if not exists dues_month date;
  alter table public.members add column if not exists dues_excluded_months jsonb not null default '{}'::jsonb;
  if first_run then
    update public.billing_events set billing_kind='dues', billing_month=public.infer_dues_month(title,due_date)
      where public.infer_dues_month(title,due_date) is not null;
    update public.payments p set dues_month=e.billing_month from public.billing_events e where e.id=p.billing_event_id;
  end if;
  if not exists(select 1 from pg_constraint where conname='billing_kind_month_check' and conrelid='public.billing_events'::regclass) then
    alter table public.billing_events add constraint billing_kind_month_check check (
      (billing_kind='other' and billing_month is null) or
      (billing_kind='dues' and billing_month is not null and extract(day from billing_month)=1));
    alter table public.members add constraint dues_excluded_object_check check(jsonb_typeof(dues_excluded_months)='object');
  end if;
end $$;

-- Abort on contradictory legacy data rather than deleting or merging money records.
create unique index if not exists payments_member_dues_month_unique on public.payments(member_id,dues_month) where dues_month is not null;
create unique index if not exists payments_member_event_unique on public.payments(member_id,billing_event_id);

create or replace function public.prepare_billing_metadata()
returns trigger language plpgsql set search_path='' as $$
declare kind text; month_value text;
begin
  kind := current_setting('app.club_billing_kind',true);
  if kind in ('dues','other') then
    new.billing_kind := kind;
    month_value := current_setting('app.club_billing_month',true);
    new.billing_month := case when kind='dues' then month_value::date else null end;
  elsif new.billing_kind='other' and new.billing_month is null then
    -- Protect callers using the previous version of the creation form too.
    new.billing_month := public.infer_dues_month(new.title,new.due_date);
    if new.billing_month is not null then new.billing_kind := 'dues'; end if;
  end if;
  return new;
end $$;
drop trigger if exists prepare_billing_metadata on public.billing_events;
create trigger prepare_billing_metadata before insert on public.billing_events for each row execute function public.prepare_billing_metadata();

create or replace function public.prepare_payment_dues_month()
returns trigger language plpgsql set search_path='' as $$
begin
  select billing_month into new.dues_month from public.billing_events where id=new.billing_event_id;
  if new.dues_month is not null and exists(select 1 from public.members where id=new.member_id and dues_excluded_months ? to_char(new.dues_month,'YYYY-MM')) then
    raise exception '対象外に設定された月です。対象外の設定を解除してから請求してください。';
  end if;
  return new;
end $$;
drop trigger if exists prepare_payment_dues_month on public.payments;
create trigger prepare_payment_dues_month before insert or update of member_id,billing_event_id,dues_month on public.payments for each row execute function public.prepare_payment_dues_month();

create or replace function public.sync_billing_dues_month()
returns trigger language plpgsql set search_path='' as $$
begin
  update public.payments set dues_month=new.billing_month where billing_event_id=new.id and dues_month is distinct from new.billing_month;
  return new;
end $$;
drop trigger if exists sync_billing_dues_month on public.billing_events;
create trigger sync_billing_dues_month after update of billing_kind,billing_month on public.billing_events for each row execute function public.sync_billing_dues_month();

create or replace function public.apply_club_billing_operation(p_operation text,p_payload jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare ev public.billing_events%rowtype; m public.members%rowtype; ids uuid[];
  kind text; month_date date; month_text text; reason text; expected_reason text;
begin
  perform pg_advisory_xact_lock(812903472);
  perform set_config('app.club_accounting_write','on',true);
  if p_operation in ('create_billing','classify_billing','set_dues_exclusion') then
    kind := p_payload->>'billing_kind';
    if p_operation='set_dues_exclusion' or kind='dues' then
      month_text := p_payload->>'billing_month';
      if month_text is null or month_text !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception '部費の対象月を指定してください。'; end if;
      month_date := (month_text||'-01')::date;
    elsif kind is distinct from 'other' then raise exception '請求の種類を指定してください。';
    end if;
  end if;

  if p_operation='create_billing' then
    select * into ev from public.billing_events where id=(p_payload->>'id')::uuid for update;
    if found and (ev.billing_kind is distinct from kind or ev.billing_month is distinct from month_date) then
      raise exception '同じ作成リクエストの内容が変更されています。画面を更新してください。';
    end if;
    if kind='dues' and exists(select 1 from public.payments where dues_month=month_date
      and billing_event_id<>(p_payload->>'id')::uuid
      and member_id in(select value::uuid from jsonb_array_elements_text(p_payload->'member_ids'))) then
      raise exception '同じ月の部費が既に請求されています。金額違いの請求も確認してください。';
    end if;
    perform set_config('app.club_billing_kind',kind,true);
    perform set_config('app.club_billing_month',coalesce(month_date::text,''),true);
    perform public.apply_club_accounting_operation('create_billing',p_payload);
    perform set_config('app.club_billing_kind','',true);
    perform set_config('app.club_billing_month','',true);

  elsif p_operation in ('add_billing_members','classify_billing') then
    select * into ev from public.billing_events where id=(p_payload->>'id')::uuid for update;
    if not found then raise exception '請求が見つかりません。画面を更新してください。'; end if;
    if ev.amount::text is distinct from p_payload->>'expected_amount'
      or ev.billing_kind is distinct from p_payload->>'expected_kind'
      or coalesce(to_char(ev.billing_month,'YYYY-MM'),'') is distinct from coalesce(p_payload->>'expected_month','') then
      raise exception '請求内容が更新されています。画面を更新して再確認してください。';
    end if;
    if p_operation='classify_billing' then
      update public.billing_events set billing_kind=kind,billing_month=month_date where id=ev.id;
    else
      if jsonb_typeof(p_payload->'member_ids') is distinct from 'array' then raise exception '対象部員を選択してください。'; end if;
      select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(p_payload->'member_ids');
      if coalesce(cardinality(ids),0)=0 or exists(select 1 from unnest(ids) x where x is null) then raise exception '対象部員を選択してください。'; end if;
      if exists(select 1 from unnest(ids) x left join public.members candidate on candidate.id=x where candidate.id is null or candidate.is_active=false) then
        raise exception '存在しない部員、または退部した部員には請求できません。';
      end if;
      if ev.billing_month is not null then
        if exists(select 1 from public.payments where member_id=any(ids) and dues_month=ev.billing_month and billing_event_id<>ev.id) then
          raise exception '同じ月の部費が既に請求されています。金額違いの請求も確認してください。';
        end if;
        if exists(select 1 from public.members where id=any(ids) and dues_excluded_months ? to_char(ev.billing_month,'YYYY-MM')) then
          raise exception '対象外に設定された部員が含まれています。';
        end if;
      end if;
      insert into public.payments(billing_event_id,member_id,status,paid_amount)
        select ev.id,x,'未納',0 from unnest(ids) x where not exists(
          select 1 from public.payments where billing_event_id=ev.id and member_id=x);
    end if;

  elsif p_operation='set_dues_exclusion' then
    select * into m from public.members where id=(p_payload->>'member_id')::uuid for update;
    if not found then raise exception '部員が見つかりません。'; end if;
    reason := trim(coalesce(p_payload->>'reason',''));
    expected_reason := coalesce(p_payload->>'expected_reason','');
    if coalesce(m.dues_excluded_months->>month_text,'') is distinct from expected_reason then raise exception '対象外の設定が更新されています。画面を更新してください。'; end if;
    if reason<>'' then
      if length(reason)>200 then raise exception '理由は200文字以内で入力してください。'; end if;
      if exists(select 1 from public.payments where member_id=m.id and dues_month=month_date) then
        raise exception '請求が登録済みです。未納の請求を対象から除外してから設定してください。納入済みの記録は保持されます。';
      end if;
      update public.members set dues_excluded_months=jsonb_set(dues_excluded_months,array[month_text],to_jsonb(reason)) where id=m.id;
    else
      update public.members set dues_excluded_months=dues_excluded_months-month_text where id=m.id;
    end if;
  else raise exception '未対応の操作です。';
  end if;
end $$;
revoke all on function public.apply_club_billing_operation(text,jsonb) from public;
grant execute on function public.apply_club_billing_operation(text,jsonb) to anon,authenticated;
do $$
declare after_snapshot jsonb;
begin
  select jsonb_object_agg(key, (select coalesce(jsonb_agg(row - array['billing_kind','billing_month','dues_month','dues_excluded_months'] order by row->>'id'),'[]'::jsonb) from jsonb_array_elements(value) row)) into after_snapshot
    from jsonb_each(public.get_club_accounting_snapshot());
  if after_snapshot is distinct from (select snapshot from pg_temp.dues_migration_before) then
    raise exception '会計記録に差分があるため、部費管理の更新を取り消しました。';
  end if;
end $$;
notify pgrst,'reload schema';
commit;

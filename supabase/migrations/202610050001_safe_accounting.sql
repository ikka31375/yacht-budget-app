-- Apply once in Supabase SQL Editor before deploying the new application.
-- No records are deleted or rewritten. Functions preserve the caller's RLS policies.
begin;

alter table public.payments add column if not exists paid_at timestamptz;
alter table public.expenses add column if not exists settled_at timestamptz;

create or replace function public.get_club_accounting_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'members', coalesce((select jsonb_agg(m) from public.members m), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(p) from public.payments p), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(e) from public.expenses e), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(b) from public.billing_events b), '[]'::jsonb),
    'clubTransactions', coalesce((select jsonb_agg(c) from public.club_transactions c), '[]'::jsonb),
    'offsetTransactions', coalesce((select jsonb_agg(o) from public.offset_transactions o), '[]'::jsonb)
  );
$$;

create or replace function public.apply_club_accounting_operation(p_operation text, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := (p_payload ->> 'id')::uuid;
  v_amount bigint;
  v_count integer;
  v_members uuid[];
  v_existing_members uuid[];
  v_payment public.payments%rowtype;
  v_expense public.expenses%rowtype;
  v_event public.billing_events%rowtype;
  v_offset public.offset_transactions%rowtype;
  v_club public.club_transactions%rowtype;
  v_payment_offsets bigint;
  v_expense_offsets bigint;
  v_next_paid bigint;
  v_next_settled bigint;
  v_cash_paid bigint;
  v_cash_settled bigint;
begin
  if v_id is null then raise exception '操作対象が指定されていません。'; end if;
  -- Serialize all accounting writes, including offset/cash settlement/deletion.
  -- No stale browser totals are trusted when deciding whether an operation is valid.
  perform pg_catalog.pg_advisory_xact_lock(812903472);
  perform pg_catalog.set_config('app.club_accounting_write', 'on', true);

  if p_operation in ('create_billing', 'create_expense', 'create_club_transaction', 'create_offset') then
    if coalesce(p_payload ->> 'amount', '') !~ '^[0-9]{1,10}$' then
      raise exception '金額は1円以上の整数で入力してください。';
    end if;
    v_amount := (p_payload ->> 'amount')::bigint;
    if v_amount < 1 or v_amount > 2147483647 then raise exception '金額が範囲外です。'; end if;
  end if;
  if p_operation in ('create_billing', 'create_expense', 'create_club_transaction')
     and nullif(btrim(p_payload ->> 'title'), '') is null then
    raise exception '品名・請求名を入力してください。';
  end if;

  case p_operation
  when 'create_billing' then
    if jsonb_typeof(p_payload -> 'member_ids') is distinct from 'array' then raise exception '対象部員を指定してください。'; end if;
    select array_agg(distinct value::uuid order by value::uuid) into v_members
      from jsonb_array_elements_text(p_payload -> 'member_ids');
    if coalesce(cardinality(v_members), 0) = 0 then raise exception '対象部員を指定してください。'; end if;
    if (select count(*) from public.members where id = any(v_members)) <> cardinality(v_members) then
      raise exception '対象部員を確認できませんでした。再読み込みしてください。';
    end if;
    select * into v_event from public.billing_events where id = v_id for update;
    if found then
      select array_agg(member_id order by member_id) into v_existing_members from public.payments where billing_event_id = v_id;
      if v_event.title is distinct from btrim(p_payload ->> 'title') or v_event.amount is distinct from v_amount
         or v_event.due_date is distinct from (p_payload ->> 'due_date')::date
         or v_existing_members is distinct from v_members then
        raise exception '前回の請求は保存済みです。再読み込みして内容を確認してください。';
      end if;
      return v_id;
    end if;
    insert into public.billing_events(id, title, amount, due_date, type)
      values(v_id, btrim(p_payload ->> 'title'), v_amount, (p_payload ->> 'due_date')::date, '部費・遠征費');
    insert into public.payments(billing_event_id, member_id, status, paid_amount, payment_method)
      select v_id, member_id, '未納', 0, '現金/振込' from unnest(v_members) member_id;
    get diagnostics v_count = row_count;
    if v_count <> cardinality(v_members) then raise exception '請求対象を保存できませんでした。'; end if;

  when 'delete_billing' then
    select * into v_event from public.billing_events where id = v_id for update;
    if not found then raise exception '請求が見つかりません。再読み込みしてください。'; end if;
    if exists(select 1 from public.payments where billing_event_id = v_id and (coalesce(paid_amount, 0) > 0 or status <> '未納'))
       or exists(select 1 from public.offset_transactions o join public.payments p on p.id = o.payment_id where p.billing_event_id = v_id) then
      raise exception '納入・相殺済みの請求は削除できません。先に該当の記録を取り消してください。';
    end if;
    delete from public.payments where billing_event_id = v_id;
    if exists(select 1 from public.payments where billing_event_id = v_id) then raise exception '一部の請求を削除する権限がありません。'; end if;
    delete from public.billing_events where id = v_id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception '請求を削除できませんでした。'; end if;

  when 'delete_payment' then
    select * into v_payment from public.payments where id = v_id for update;
    if not found then raise exception '請求が見つかりません。'; end if;
    if coalesce(v_payment.paid_amount, 0) <> 0 or v_payment.status <> '未納'
       or exists(select 1 from public.offset_transactions where payment_id = v_id) then
      raise exception '納入・相殺済みの請求は除外できません。';
    end if;
    delete from public.payments where id = v_id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception '請求を除外できませんでした。'; end if;

  when 'create_expense' then
    select * into v_expense from public.expenses where id = v_id;
    if found then
      if v_expense.member_id is distinct from (p_payload ->> 'member_id')::uuid or v_expense.amount is distinct from v_amount
         or v_expense.title is distinct from btrim(p_payload ->> 'title') or v_expense.category is distinct from p_payload ->> 'category'
         or coalesce(v_expense.receipt_url, '') is distinct from coalesce(p_payload ->> 'receipt_url', '') then
        raise exception '前回の申請は保存済みです。再読み込みして内容を確認してください。';
      end if;
      return v_id;
    end if;
    if not exists(select 1 from public.members where id = (p_payload ->> 'member_id')::uuid) then raise exception '部員が見つかりません。'; end if;
    insert into public.expenses(id, member_id, title, amount, category, receipt_url, status, settled_amount)
      values(v_id, (p_payload ->> 'member_id')::uuid, btrim(p_payload ->> 'title'), v_amount,
        p_payload ->> 'category', coalesce(p_payload ->> 'receipt_url', ''), '未精算', 0);

  when 'attach_receipt' then
    if coalesce(p_payload ->> 'receipt_url', '') !~ '^https://' then raise exception '写真が保存されていません。'; end if;
    select * into v_expense from public.expenses where id = v_id for update;
    if not found then raise exception '立替が見つかりません。'; end if;
    if coalesce(v_expense.receipt_url, '') = p_payload ->> 'receipt_url' then return v_id; end if;
    if coalesce(v_expense.receipt_url, '') is distinct from coalesce(p_payload ->> 'expected_receipt_url', '') then
      raise exception '写真が更新されています。再読み込みしてください。';
    end if;
    update public.expenses set receipt_url = p_payload ->> 'receipt_url' where id = v_id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception '写真を申請に添付できませんでした。'; end if;

  when 'create_club_transaction' then
    if coalesce(p_payload ->> 'type', '') not in ('収入', '支出')
       or coalesce(p_payload ->> 'payment_source', '') not in ('部口座振込', '部室現金') then
      raise exception '出納の種別・出納元が不正です。';
    end if;
    select * into v_club from public.club_transactions where id = v_id;
    if found then
      if v_club.title is distinct from btrim(p_payload ->> 'title') or v_club.amount is distinct from v_amount
         or v_club.type is distinct from p_payload ->> 'type' or v_club.category is distinct from p_payload ->> 'category'
         or v_club.payment_source is distinct from p_payload ->> 'payment_source'
         or coalesce(v_club.event_tag, '') is distinct from coalesce(p_payload ->> 'event_tag', '') then
        raise exception '前回の出納は保存済みです。再読み込みして内容を確認してください。';
      end if;
      return v_id;
    end if;
    insert into public.club_transactions(id, type, title, amount, category, payment_source, event_tag)
      values(v_id, p_payload ->> 'type', btrim(p_payload ->> 'title'), v_amount,
        p_payload ->> 'category', p_payload ->> 'payment_source', p_payload ->> 'event_tag');

  when 'create_offset' then
    select * into v_offset from public.offset_transactions where id = v_id;
    if found then
      if v_offset.payment_id is distinct from (p_payload ->> 'payment_id')::uuid
         or v_offset.expense_id is distinct from (p_payload ->> 'expense_id')::uuid or v_offset.amount is distinct from v_amount then
        raise exception '前回の相殺は保存済みです。再読み込みしてください。';
      end if;
      return v_id;
    end if;
    select * into v_payment from public.payments where id = (p_payload ->> 'payment_id')::uuid for update;
    if not found then raise exception '請求が見つかりません。'; end if;
    select * into v_expense from public.expenses where id = (p_payload ->> 'expense_id')::uuid for update;
    if not found then raise exception '立替が見つかりません。'; end if;
    select * into v_event from public.billing_events where id = v_payment.billing_event_id;
    if not found then raise exception '請求イベントが見つかりません。'; end if;
    if v_payment.member_id <> v_expense.member_id then raise exception '別の部員の部費と立替は相殺できません。'; end if;
    if coalesce(v_payment.paid_amount, 0) is distinct from (p_payload ->> 'expected_paid')::bigint
       or coalesce(v_expense.settled_amount, 0) is distinct from (p_payload ->> 'expected_settled')::bigint then
      raise exception '残額が更新されています。画面を再読み込みしてから相殺してください。';
    end if;
    if v_amount > v_event.amount - coalesce(v_payment.paid_amount, 0)
       or v_amount > v_expense.amount - coalesce(v_expense.settled_amount, 0) then
      raise exception '相殺金額が請求または立替の残額を超えています。';
    end if;
    select coalesce(sum(amount), 0) into v_payment_offsets from public.offset_transactions where payment_id = v_payment.id;
    select coalesce(sum(amount), 0) into v_expense_offsets from public.offset_transactions where expense_id = v_expense.id;
    if v_payment_offsets > coalesce(v_payment.paid_amount, 0) or v_expense_offsets > coalesce(v_expense.settled_amount, 0) then
      raise exception '既存の相殺履歴と残額に不一致があります。会計担当に確認してください。';
    end if;
    v_next_paid := coalesce(v_payment.paid_amount, 0) + v_amount;
    v_next_settled := coalesce(v_expense.settled_amount, 0) + v_amount;
    insert into public.offset_transactions(id, member_id, payment_id, expense_id, amount)
      values(v_id, v_payment.member_id, v_payment.id, v_expense.id, v_amount);
    update public.payments set paid_amount = v_next_paid,
      status = case when v_next_paid = v_event.amount then '支払済' else '一部納入' end,
      payment_method = case when coalesce(v_payment.paid_amount, 0) > v_payment_offsets then v_payment.payment_method
                           when v_next_paid = v_event.amount then '相殺' else '一部相殺' end where id = v_payment.id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception '部費を更新できませんでした。'; end if;
    update public.expenses set settled_amount = v_next_settled,
      status = case when v_next_settled = v_expense.amount then '精算済' else '一部精算' end where id = v_expense.id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception '立替を更新できませんでした。'; end if;

  when 'cancel_offset' then
    select * into v_offset from public.offset_transactions where id = v_id for update;
    if not found then return v_id; end if;
    select * into v_payment from public.payments where id = v_offset.payment_id for update;
    if not found then raise exception '相殺先の請求が見つかりません。'; end if;
    select * into v_expense from public.expenses where id = v_offset.expense_id for update;
    if not found then raise exception '相殺元の立替が見つかりません。'; end if;
    select * into v_event from public.billing_events where id = v_payment.billing_event_id;
    if not found then raise exception '請求イベントが見つかりません。'; end if;
    select coalesce(sum(amount), 0) into v_payment_offsets from public.offset_transactions where payment_id = v_payment.id;
    select coalesce(sum(amount), 0) into v_expense_offsets from public.offset_transactions where expense_id = v_expense.id;
    v_cash_paid := coalesce(v_payment.paid_amount, 0) - v_payment_offsets;
    v_cash_settled := coalesce(v_expense.settled_amount, 0) - v_expense_offsets;
    if v_cash_paid < 0 or v_cash_settled < 0 then raise exception '相殺履歴と残額に不一致があります。'; end if;
    v_next_paid := coalesce(v_payment.paid_amount, 0) - v_offset.amount;
    v_next_settled := coalesce(v_expense.settled_amount, 0) - v_offset.amount;
    update public.payments set paid_amount = v_next_paid,
      status = case when v_next_paid = 0 then '未納' when v_next_paid = v_event.amount then '支払済' else '一部納入' end,
      payment_method = case when v_next_paid = 0 then '現金/振込' when v_cash_paid > 0 then v_payment.payment_method else '一部相殺' end
      where id = v_payment.id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception '部費を更新できませんでした。'; end if;
    update public.expenses set settled_amount = v_next_settled,
      status = case when v_next_settled = 0 then '未精算' when v_next_settled = v_expense.amount then '精算済' else '一部精算' end
      where id = v_expense.id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception '立替を更新できませんでした。'; end if;
    delete from public.offset_transactions where id = v_id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception '相殺を取り消せませんでした。'; end if;

  when 'set_payment' then
    select * into v_payment from public.payments where id = v_id for update;
    if not found then raise exception '請求が見つかりません。'; end if;
    select * into v_event from public.billing_events where id = v_payment.billing_event_id;
    if not found then raise exception '請求イベントが見つかりません。'; end if;
    if coalesce(v_payment.paid_amount, 0) is distinct from (p_payload ->> 'expected_paid')::bigint then raise exception '納入額が更新されています。再読み込みしてください。'; end if;
    select coalesce(sum(amount), 0) into v_payment_offsets from public.offset_transactions where payment_id = v_id;
    if v_payment_offsets > coalesce(v_payment.paid_amount, 0) or v_payment_offsets > v_event.amount then raise exception '相殺履歴と納入額に不一致があります。'; end if;
    if (p_payload ->> 'clear')::boolean then
      if coalesce(p_payload ->> 'method', '') not in ('現金', '振込') then raise exception '納入方法を指定してください。'; end if;
      v_next_paid := v_event.amount;
    elsif (p_payload ->> 'clear')::boolean = false then v_next_paid := v_payment_offsets;
    else raise exception '納入操作が指定されていません。'; end if;
    update public.payments set paid_amount = v_next_paid,
      status = case when v_next_paid = 0 then '未納' when v_next_paid = v_event.amount then '支払済' else '一部納入' end,
      payment_method = case when v_next_paid > v_payment_offsets then p_payload ->> 'method'
                           when v_next_paid = 0 then '現金/振込' when v_next_paid = v_event.amount then '相殺' else '一部相殺' end,
      paid_at = case when v_next_paid > v_payment_offsets then coalesce(paid_at, now()) else null end
      where id = v_id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception '納入状態を保存できませんでした。'; end if;

  when 'set_expense' then
    select * into v_expense from public.expenses where id = v_id for update;
    if not found then raise exception '立替が見つかりません。'; end if;
    if coalesce(v_expense.settled_amount, 0) is distinct from (p_payload ->> 'expected_settled')::bigint then raise exception '精算額が更新されています。再読み込みしてください。'; end if;
    select coalesce(sum(amount), 0) into v_expense_offsets from public.offset_transactions where expense_id = v_id;
    if v_expense_offsets > coalesce(v_expense.settled_amount, 0) or v_expense_offsets > v_expense.amount then raise exception '相殺履歴と精算額に不一致があります。'; end if;
    if (p_payload ->> 'clear')::boolean then v_next_settled := v_expense.amount;
    elsif (p_payload ->> 'clear')::boolean = false then v_next_settled := v_expense_offsets;
    else raise exception '精算操作が指定されていません。'; end if;
    update public.expenses set settled_amount = v_next_settled,
      status = case when v_next_settled = 0 then '未精算' when v_next_settled = v_expense.amount then '精算済' else '一部精算' end,
      reject_reason = case when v_next_settled > v_expense_offsets then '現金精算' else '' end,
      settled_at = case when v_next_settled > v_expense_offsets then coalesce(settled_at, now()) else null end
      where id = v_id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception '精算状態を保存できませんでした。'; end if;

  when 'delete_expense' then
    select * into v_expense from public.expenses where id = v_id for update;
    if not found then raise exception '立替が見つかりません。'; end if;
    if coalesce(v_expense.settled_amount, 0) <> 0 or v_expense.status <> '未精算'
       or exists(select 1 from public.offset_transactions where expense_id = v_id) then
      raise exception '精算・相殺済みの立替は削除できません。先に該当の記録を取り消してください。';
    end if;
    delete from public.expenses where id = v_id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception '立替を削除できませんでした。'; end if;

  else raise exception '未対応の会計操作です。';
  end case;
  return v_id;
end;
$$;

revoke all on function public.get_club_accounting_snapshot() from public;
revoke all on function public.apply_club_accounting_operation(text, jsonb) from public;
grant execute on function public.get_club_accounting_snapshot() to anon, authenticated;
grant execute on function public.apply_club_accounting_operation(text, jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
commit;

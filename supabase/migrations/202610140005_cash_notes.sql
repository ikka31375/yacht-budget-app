begin;

-- Keep the cash record and its optional note in the same transaction.
-- Existing dates, review notes, receipt settings and access policies are retained.
create or replace function public.apply_club_cash_operation(p_operation text, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  saved public.club_transactions%rowtype;
  existed boolean;
  note text;
  record_id uuid;
  written integer;
begin
  if p_operation is distinct from 'create_club_transaction' then raise exception '未対応の操作です。'; end if;
  if p_payload ? 'review_note' and jsonb_typeof(p_payload->'review_note') not in ('string','null') then
    raise exception 'メモは文章で入力してください。';
  end if;
  note := nullif(btrim(p_payload->>'review_note'),'');
  if length(note)>2000 then raise exception 'メモは2000文字以内で入力してください。'; end if;

  perform pg_advisory_xact_lock(812903472);
  perform set_config('app.club_accounting_write','on',true);
  select * into saved from public.club_transactions where id=(p_payload->>'id')::uuid for update;
  existed := found;
  if existed and saved.review_note is distinct from note then
    raise exception '前回の出納は保存済みです。再読み込みしてメモを確認してください。';
  end if;
  record_id := public.apply_club_accounting_operation(p_operation,p_payload);
  if not existed then
    update public.club_transactions set review_note=note where id=record_id;
    get diagnostics written=row_count;
    if written<>1 then raise exception '出納とメモを保存できませんでした。'; end if;
  end if;
  return record_id;
end $$;

revoke all on function public.apply_club_cash_operation(text,jsonb) from public;
grant execute on function public.apply_club_cash_operation(text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;

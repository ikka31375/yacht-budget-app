const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
let db, member, event, payment, expense;
const migration = fs.readFileSync('supabase/migrations/202610050001_safe_accounting.sql', 'utf8');
const guardMigration = fs.readFileSync('supabase/migrations/202610050002_require_safe_writes.sql', 'utf8');

before(async () => {
  db = await PGlite.create();
  await db.exec(fs.readFileSync('tests/fixtures/schema.sql', 'utf8'));
  await db.exec(migration);
  await db.exec(guardMigration);
  // Reapplying the migration must not reset historical data or fail.
  await db.exec(migration);
  await db.exec(guardMigration);
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('reset role; drop trigger if exists fail_expense_write on public.expenses; drop trigger if exists fail_payment_insert on public.payments;');
  await db.exec('truncate public.offset_transactions, public.payments, public.expenses, public.club_transactions, public.billing_events, public.members;');
  member = randomUUID(); event = randomUUID(); payment = randomUUID(); expense = randomUUID();
  await db.query('insert into public.members(id,name,grade,role) values ($1,$2,2,$3)', [member, 'テスト部員', '部員']);
  await db.query("insert into public.billing_events(id,title,amount,due_date,type) values ($1,$2,10000,$3,'部費・遠征費')", [event, '部費', '2026-10-31']);
  await db.query('insert into public.payments(id,billing_event_id,member_id,status,paid_amount) values ($1,$2,$3,$4,0)', [payment, event, member, '未納']);
  await db.query('insert into public.expenses(id,member_id,title,amount,category,status,settled_amount) values ($1,$2,$3,10000,$4,$5,0)', [expense, member, '燃料', '燃料・交通費', '未精算']);
  await db.exec('set role anon');
});
const call = (operation, payload) => db.query('select public.apply_club_accounting_operation($1,$2::jsonb)', [operation, JSON.stringify(payload)]);
const offset = (id = randomUUID(), amount = 3000, expected_paid = 0, expected_settled = 0) => ({ id, amount, payment_id: payment, expense_id: expense, expected_paid, expected_settled });
const balances = async () => {
  const result = await db.query('select (select paid_amount from public.payments where id=$1) paid, (select settled_amount from public.expenses where id=$2) settled, (select count(*)::integer from public.offset_transactions) offsets', [payment, expense]);
  return result.rows[0];
};

test('offset and cancellation atomically update both balances and the ledger', async () => {
  const payload = offset(); await call('create_offset', payload);
  assert.deepEqual(await balances(), { paid: 3000, settled: 3000, offsets: 1 });
  await call('cancel_offset', { id: payload.id });
  assert.deepEqual(await balances(), { paid: 0, settled: 0, offsets: 0 });
  await call('cancel_offset', { id: payload.id });
  assert.deepEqual(await balances(), { paid: 0, settled: 0, offsets: 0 });
});

test('failure after the first balance write rolls back the ledger and both balances', async () => {
  await db.exec(`reset role; create or replace function public.fail_test_write() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$;
    create trigger fail_expense_write before update on public.expenses for each row execute function public.fail_test_write(); set role anon;`);
  await assert.rejects(call('create_offset', offset()), /forced failure/);
  assert.deepEqual(await balances(), { paid: 0, settled: 0, offsets: 0 });
});

test('cancellation failure also preserves the original offset and balances', async () => {
  const payload = offset(); await call('create_offset', payload);
  await db.exec(`reset role; create or replace function public.fail_test_write() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$;
    create trigger fail_expense_write before update on public.expenses for each row execute function public.fail_test_write(); set role anon;`);
  await assert.rejects(call('cancel_offset', { id: payload.id }), /forced failure/);
  assert.deepEqual(await balances(), { paid: 3000, settled: 3000, offsets: 1 });
});

test('retrying the same offset is idempotent; a different stale request cannot overwrite it', async () => {
  const payload = offset(); await call('create_offset', payload); await call('create_offset', payload);
  await assert.rejects(call('create_offset', offset()), /残額が更新/);
  assert.deepEqual(await balances(), { paid: 3000, settled: 3000, offsets: 1 });
});

test('reject over-offset and cross-member offset without writing records', async () => {
  await assert.rejects(call('create_offset', offset(randomUUID(), 10001)), /残額を超え/);
  await db.exec('reset role');
  const other = randomUUID();
  await db.query('insert into public.members(id,name,grade) values($1,$2,1)', [other, '別部員']);
  await db.query('update public.expenses set member_id=$1 where id=$2', [other, expense]);
  await db.exec('set role anon');
  await assert.rejects(call('create_offset', offset()), /別の部員/);
  assert.deepEqual(await balances(), { paid: 0, settled: 0, offsets: 0 });
});

test('cash settlement/reset preserve existing offsets and record the cash date', async () => {
  await call('create_offset', offset());
  await call('set_payment', { id: payment, expected_paid: 3000, clear: true, method: '振込' });
  await call('set_expense', { id: expense, expected_settled: 3000, clear: true });
  assert.deepEqual(await balances(), { paid: 10000, settled: 10000, offsets: 1 });
  const dates = (await db.query('select p.paid_at,e.settled_at from public.payments p,public.expenses e')).rows[0];
  assert(dates.paid_at); assert(dates.settled_at);
  await call('set_payment', { id: payment, expected_paid: 10000, clear: false });
  await call('set_expense', { id: expense, expected_settled: 10000, clear: false });
  assert.deepEqual(await balances(), { paid: 3000, settled: 3000, offsets: 1 });
});

test('deletion checks current database values, rejecting a paid event from a stale browser', async () => {
  await call('set_payment', { id: payment, expected_paid: 0, clear: true, method: '現金' });
  await assert.rejects(call('delete_billing', { id: event }), /納入・相殺済/);
  await assert.rejects(call('delete_payment', { id: payment }), /納入・相殺済/);
  assert.equal((await balances()).paid, 10000);
});

test('billing creation rolls back the parent if inserting recipients fails', async () => {
  const id = randomUUID();
  await db.exec(`reset role; create or replace function public.fail_test_write() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$;
    create trigger fail_payment_insert before insert on public.payments for each row execute function public.fail_test_write(); set role anon;`);
  await assert.rejects(call('create_billing', { id, title: '遠征', amount: 5000, due_date: '2026-10-31', member_ids: [member] }), /forced failure/);
  assert.equal((await db.query('select count(*)::integer n from public.billing_events where id=$1', [id])).rows[0].n, 0);
});

test('receipt attachment updates an existing expense without duplicating the claim', async () => {
  await call('attach_receipt', { id: expense, receipt_url: 'https://example.invalid/receipt.jpg', expected_receipt_url: '' });
  const row = (await db.query('select receipt_url,amount from public.expenses where id=$1', [expense])).rows[0];
  assert.equal(row.receipt_url, 'https://example.invalid/receipt.jpg'); assert.equal(row.amount, 10000);
});

test('reject invalid amounts in the database as well as the browser', async () => {
  for (const amount of [0, -1, 2.5, '1e4', 'Infinity', 2147483648]) {
    await assert.rejects(call('create_club_transaction', { id: randomUUID(), title: '燃料', amount, type: '支出', payment_source: '部室現金' }), /金額/);
  }
});

test('older clients cannot bypass the transaction with direct table updates', async () => {
  await assert.rejects(db.query('update public.payments set paid_amount=10000 where id=$1', [payment]), /更新後のアプリ/);
  assert.equal((await balances()).paid, 0);
});

test('snapshot includes more than 1000 records and is still governed by RLS', async () => {
  await db.exec(`reset role; insert into public.club_transactions(type,title,amount,category,payment_source) select '収入','寄付',1,'OB・OG寄付金','部口座振込' from generate_series(1,1250); set role anon;`);
  const snapshot = (await db.query('select public.get_club_accounting_snapshot() data')).rows[0].data;
  assert.equal(snapshot.clubTransactions.length, 1250);
  await db.exec(`reset role; alter table public.expenses enable row level security; create policy deny_expenses on public.expenses to anon using(false) with check(false); set role anon;`);
  assert.equal((await db.query('select public.get_club_accounting_snapshot() data')).rows[0].data.expenses.length, 0);
  await assert.rejects(call('create_offset', offset()), /立替が見つかりません/);
  await db.exec('reset role; drop policy deny_expenses on public.expenses; alter table public.expenses disable row level security;');
});

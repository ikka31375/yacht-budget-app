const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
let db,a,b,c,event,discount;
const migration=fs.readFileSync('supabase/migrations/202610120004_monthly_dues.sql','utf8');
const call=(op,payload)=>db.query('select public.apply_club_billing_operation($1,$2::jsonb)',[op,JSON.stringify(payload)]);
const oldCall=(op,payload)=>db.query('select public.apply_club_accounting_operation($1,$2::jsonb)',[op,JSON.stringify(payload)]);
const expected=id=>({id,expected_amount:id===discount?2000:8000,expected_kind:'dues',expected_month:'2026-04'});
const snapshot=async()=> (await db.query('select public.get_club_accounting_snapshot() data')).rows[0].data;
before(async()=>{
  db=await PGlite.create();
  await db.exec(fs.readFileSync('tests/fixtures/schema.sql','utf8'));
  for(const file of ['202610050001_safe_accounting.sql','202610050002_require_safe_writes.sql','202610050003_accounting_dates.sql'])await db.exec(fs.readFileSync(`supabase/migrations/${file}`,'utf8'));
  // Realistic legacy import: partial payment and cash date different from dues month.
  const m=randomUUID(),e=randomUUID();
  await db.query('insert into public.members(id,name,grade) values($1,$2,2)',[m,'履歴']);
  await db.query("insert into public.billing_events(id,title,amount,due_date,type) values($1,'2026年4月部費',8000,'2026-05-10','部費・遠征費')",[e]);
  await db.query("insert into public.payments(member_id,billing_event_id,status,paid_amount,paid_on,review_note) values($1,$2,'一部納入',4000,'2026-05-01','日付要確認')",[m,e]);
  const before=await snapshot();
  await db.exec(migration);await db.exec(migration);
  const after=await snapshot();
  const strip=data=>JSON.parse(JSON.stringify(data), (key,val)=>['billing_kind','billing_month','dues_month','dues_excluded_months'].includes(key)?undefined:val);
  assert.deepEqual(strip(after),strip(before));
  assert.equal(after.events[0].billing_month,'2026-04-01');
  assert.equal(after.payments[0].dues_month,'2026-04-01');
});
after(async()=>await db?.close());
beforeEach(async()=>{
  await db.exec('reset role; truncate public.offset_transactions,public.payments,public.expenses,public.club_transactions,public.billing_events,public.members;');
  a=randomUUID();b=randomUUID();c=randomUUID();event=randomUUID();discount=randomUUID();
  for(const [id,name,active] of [[a,'納入済',true],[b,'追加部員',true],[c,'退部',false]]) await db.query('insert into public.members(id,name,grade,is_active) values($1,$2,2,$3)',[id,name,active]);
  await db.exec('set role anon');
  await call('create_billing',{id:event,title:'2026年4月部費',amount:8000,due_date:'2026-04-30',billing_kind:'dues',billing_month:'2026-04',member_ids:[a]});
  const p=(await db.query('select id from public.payments where member_id=$1',[a])).rows[0].id;
  await oldCall('set_payment',{id:p,expected_paid:0,clear:true,method:'振込',paid_on:'2026-05-01'});
  await db.exec('reset role');
  await db.query("insert into public.billing_events(id,title,amount,due_date,type,billing_kind,billing_month) values($1,'割引部費',2000,'2026-04-30','部費・遠征費','dues','2026-04-01')",[discount]);
  await db.exec('set role anon');
});
test('adding recipients and retrying preserves all paid records and creates only one unpaid row',async()=>{
  const before=await snapshot();
  await call('add_billing_members',{...expected(event),member_ids:[a,b,b]});
  await call('add_billing_members',{...expected(event),member_ids:[b]});
  const after=await snapshot();
  assert.deepEqual(after.payments.find(p=>p.member_id===a),before.payments[0]);
  assert.equal(after.payments.length,2);assert.equal(after.payments.find(p=>p.member_id===b).paid_amount,0);
  assert.deepEqual(after.events,before.events);assert.deepEqual(after.offsetTransactions,before.offsetTransactions);
  assert.deepEqual(after.expenses,before.expenses);assert.deepEqual(after.clubTransactions,before.clubTransactions);
});
test('duplicate month across discount tiers rejects an entire batch; unrelated charges remain possible',async()=>{
  await assert.rejects(call('add_billing_members',{...expected(discount),member_ids:[a,b]}),/同じ月/);
  assert.equal((await snapshot()).payments.length,1);
  const id=randomUUID();
  await call('create_billing',{id,title:'遠征費',amount:5000,due_date:'2026-04-30',billing_kind:'other',member_ids:[a,b]});
  assert.equal((await snapshot()).payments.length,3);
});
test('recipient additions preserve partial offsets, settlements and cash reporting inputs',async()=>{
  await call('add_billing_members',{...expected(event),member_ids:[b]});
  const payment=(await snapshot()).payments.find(p=>p.member_id===b),expense=randomUUID(),d=randomUUID();
  await oldCall('create_expense',{id:expense,member_id:b,title:'立替',amount:5000,category:'その他',incurred_on:'2026-04-01'});
  await oldCall('create_offset',{id:randomUUID(),payment_id:payment.id,expense_id:expense,amount:2500,expected_paid:0,expected_settled:0});
  await db.exec('reset role');await db.query('insert into public.members(id,name,grade) values($1,$2,1)',[d,'新規部員']);await db.exec('set role anon');
  const before=await snapshot();
  await call('add_billing_members',{...expected(event),member_ids:[d]});
  const after=await snapshot();
  for(const p of before.payments)assert.deepEqual(after.payments.find(x=>x.id===p.id),p);
  assert.deepEqual(after.offsetTransactions,before.offsetTransactions);assert.deepEqual(after.expenses,before.expenses);
  assert.equal(after.payments.find(p=>p.member_id===b).status,'一部納入');
});
test('concurrent recipient requests cannot create duplicate monthly claims',async()=>{
  const results=await Promise.allSettled([call('add_billing_members',{...expected(event),member_ids:[b]}),call('add_billing_members',{...expected(discount),member_ids:[b]})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await snapshot()).payments.filter(p=>p.member_id===b).length,1);
});
test('stale amounts, retired members and mixed invalid batches cannot write anything',async()=>{
  await assert.rejects(call('add_billing_members',{...expected(event),expected_amount:2000,member_ids:[b]}),/更新/);
  await assert.rejects(call('add_billing_members',{...expected(event),member_ids:[b,c]}),/退部/);
  await assert.rejects(call('add_billing_members',{...expected(event),member_ids:[b,randomUUID()]}),/存在しない/);
  assert.equal((await snapshot()).payments.length,1);
});
test('confirmed exclusions require explicit removal before billing and cannot hide existing claims',async()=>{
  const payload={member_id:b,billing_month:'2026-04',reason:'入部前',expected_reason:''};
  await call('set_dues_exclusion',payload);
  await assert.rejects(call('set_dues_exclusion',{...payload,reason:'免除'}),/更新/);
  await assert.rejects(call('add_billing_members',{...expected(event),member_ids:[b]}),/対象外/);
  await assert.rejects(call('set_dues_exclusion',{...payload,member_id:a}),/請求が登録済み/);
  await call('set_dues_exclusion',{...payload,reason:'',expected_reason:'入部前'});
  await call('add_billing_members',{...expected(event),member_ids:[b]});
});
test('legacy creation and new creation both enforce uniqueness and roll back parent on failure',async()=>{
  const id=randomUUID();
  await assert.rejects(oldCall('create_billing',{id,title:'2026年4月部費（割引）',amount:2000,due_date:'2026-05-31',member_ids:[b,a]}),/unique/);
  assert.equal((await snapshot()).events.some(e=>e.id===id),false);
  await assert.rejects(call('create_billing',{id,title:'部費',amount:8000,due_date:'2026-04-30',billing_kind:'dues',billing_month:'2026-13',member_ids:[b]}),/対象月/);
  const payload={id,title:'部費',amount:8000,due_date:'2026-04-30',billing_kind:'dues',billing_month:'2027-04',member_ids:[a]};
  await call('create_billing',payload);await call('create_billing',payload);
  assert.equal((await snapshot()).events.filter(e=>e.id===id).length,1);
});
test('classification preserves money, refuses conflicting month and survives migration reapplication',async()=>{
  const before=await snapshot();
  await call('classify_billing',{...expected(event),billing_kind:'dues',billing_month:'2026-05'});
  const after=await snapshot();
  assert.equal(after.payments[0].paid_amount,before.payments[0].paid_amount);
  assert.equal(after.payments[0].paid_on,before.payments[0].paid_on);
  assert.equal(after.payments[0].dues_month,'2026-05-01');
  await assert.rejects(call('add_billing_members',{...expected(event),member_ids:[b]}),/更新/);
  await call('classify_billing',{...expected(event),expected_month:'2026-05',billing_kind:'other'});
  await db.exec('reset role');await db.exec(migration);await db.exec('set role anon');
  assert.equal((await snapshot()).events.find(e=>e.id===event).billing_kind,'other');
});

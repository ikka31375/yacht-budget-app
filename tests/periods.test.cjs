const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadAccounting}=require('./helpers.cjs');
const {parseDate,fiscalYear,periodBounds,cashEntries,summarizeEntries}=loadAccounting();
test('Japanese fiscal year switches on April 1 and month end crosses a calendar year',()=>{
  assert.equal(fiscalYear('2026-03-31'),2025);assert.equal(fiscalYear('2026-04-01'),2026);
  assert.equal(JSON.stringify(periodBounds('year','2026')),JSON.stringify({start:'2026-04-01',end:'2027-04-01'}));
  assert.equal(periodBounds('month','2026-12').end,'2027-01-01');
  assert.equal(parseDate('2024-02-29'),'2024-02-29');
  for(const date of ['2026-02-29','2026-04-31','0000-01-01','2026-1-1']) assert.throws(()=>parseDate(date));
});
test('cash period uses actual cash day, excludes offsets, and retains provisional records',()=>{
  const data={members:[{id:'m',name:'部員'}],events:[{id:'b',title:'11月部費',amount:8000,due_date:'2026-11-30'}],
    payments:[{id:'p',member_id:'m',billing_event_id:'b',paid_amount:8000,paid_on:'2026-03-31',date_provisional:true}],
    expenses:[{id:'e',member_id:'m',amount:6000,settled_amount:6000,settled_on:'2026-04-01',category:'工具',settlement_provisional:true}],
    offsetTransactions:[{id:'o',member_id:'m',payment_id:'p',expense_id:'e',amount:2000}],clubTransactions:[{id:'t',type:'支出',amount:500,payment_source:'不明',source_reference:'Excel',date_provisional:true}]};
  const entries=cashEntries(data);assert.equal(entries.length,3);
  const payment=entries.find(e=>e.kind==='payment');assert.equal(payment.amount,6000);assert.equal(fiscalYear(payment.date),2025);assert.equal(payment.dateProvisional,true);
  assert.equal(entries.find(e=>e.kind==='expense').amount,4000);
  assert.equal(entries.find(e=>e.kind==='club').date,null);
  assert.equal(summarizeEntries(entries).net,1500);
});

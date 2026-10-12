const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {loadAccounting}=require('./helpers.cjs');
const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/dues.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:()=>loadAccounting()});
const {monthlyDues,fiscalMonths,eligibleMembers,eventDuesMonth,duesMonth}=mod.exports;
const member={id:'a',name:'部員',is_active:true};
const event={id:'normal',title:'4月の部費',amount:8000,billing_kind:'dues',billing_month:'2026-04-01',due_date:'2026-05-31'};
const data={members:[member],events:[event],payments:[],expenses:[],clubTransactions:[],offsetTransactions:[]};

test('dues follow their assigned month, never the cash date or deadline',()=>{
  const paid={id:'p',member_id:'a',billing_event_id:'normal',paid_amount:8000,status:'支払済',paid_on:'2026-05-01'};
  assert.equal(monthlyDues({...data,payments:[paid]},member,'2026-04').state,'納入済');
  assert.equal(monthlyDues({...data,payments:[paid]},member,'2026-05').state,'要確認');
  assert.equal(fiscalMonths(2026).join(','),'2026-04,2026-05,2026-06,2026-07,2026-08,2026-09,2026-10,2026-11,2026-12,2027-01,2027-02,2027-03');
  assert.throws(()=>duesMonth('2026-13'));
});
test('missing, excluded, unpaid, partial and fully offset months stay distinct',()=>{
  assert.equal(monthlyDues(data,member,'2026-04').state,'要確認');
  assert.equal(monthlyDues(data,{...member,dues_excluded_months:{'2026-04':'入部前'}},'2026-04').state,'対象外');
  for(const [paid,state,left] of [[0,'未納',8000],[3000,'一部納入',5000],[8000,'納入済',0]]){
    const snapshot={...data,payments:[{id:'p',member_id:'a',billing_event_id:'normal',paid_amount:paid}],offsetTransactions:[{payment_id:'p',amount:paid}]};
    assert.equal(monthlyDues(snapshot,member,'2026-04').state,state);
    assert.equal(monthlyDues(snapshot,member,'2026-04').remaining,left);
  }
});
test('discount tiers share month eligibility; retired and excluded members cannot be selected',()=>{
  const discount={...event,id:'discount',amount:2000};
  const members=[member,{id:'b',is_active:true},{id:'c',is_active:false},{id:'d',dues_excluded_months:{'2026-04':'免除'}}];
  assert.equal(eligibleMembers(members,[{member_id:'a',billing_event_id:'discount'}],[event,discount],event).map(m=>m.id).join(','),'b');
  assert.equal(eventDuesMonth({...event,billing_kind:'other',billing_month:null}),null);
  assert.equal(eventDuesMonth({title:'2026年4月部費（免除残金）',due_date:'2026-08-02'}),'2026-04');
  assert.equal(eventDuesMonth({title:'10月部費',due_date:'2026-09-02'}),null);
});

'use client';

import {useState} from 'react';
import type {BillingEvent, Member} from '@/types';
import type {ClubData} from '@/lib/accounting';
import {billingKind, eligibleMembers, eventDuesMonth} from '@/lib/dues';

export type BillingSave = (operation: string, payload: Record<string, unknown>, done: () => void) => void;
export const expectedBilling = (event: BillingEvent) => ({id:event.id, expected_amount:event.amount, expected_kind:billingKind(event), expected_month:eventDuesMonth(event)||''});
const money = (amount:number) => `¥${amount.toLocaleString()}`;

export function AddBillingMembers({data,event,initialMember,disabled,onSave,onClose}:{data:ClubData;event:BillingEvent;initialMember?:Member;disabled:boolean;onSave:BillingSave;onClose:()=>void}) {
  const candidates = eligibleMembers(data.members,data.payments,data.events,event);
  const [ids,setIds] = useState<string[]>(initialMember && candidates.some(m=>m.id===initialMember.id)?[initialMember.id]:[]);
  const [preview,setPreview] = useState(false);
  const selected = candidates.filter(m=>ids.includes(m.id));
  return <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4"><section role="dialog" aria-modal="true" aria-label="請求対象者の追加" className="bg-white rounded-3xl p-5 w-full max-w-md max-h-[90vh] overflow-auto space-y-4">
    <h3 className="font-black text-lg">請求対象者の追加</h3>
    <div className="rounded-xl bg-blue-50 p-3 text-sm"><p className="font-bold">{event.title}</p><p>{eventDuesMonth(event)?`${eventDuesMonth(event)}月分の部費`:'その他の請求'} · 1人 {money(event.amount)}</p></div>
    <p className="text-xs text-slate-500">既に登録済みの人・退部した人・対象外の人は表示しません。部費は金額が違う請求も含め、同じ月には重ねて追加できません。</p>
    {!preview ? <fieldset disabled={disabled} className="space-y-2">
      {candidates.length===0 && <p className="text-sm py-4">追加できる部員はいません。</p>}
      {candidates.map(m=><label key={m.id} className="flex gap-3 items-center bg-slate-50 rounded-xl p-3 text-sm"><input type="checkbox" checked={ids.includes(m.id)} onChange={e=>setIds(e.target.checked?[...ids,m.id]:ids.filter(id=>id!==m.id))}/>{m.grade}年 {m.name}</label>)}
    </fieldset>:<div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2 text-sm"><p className="font-bold">次の内容で未納の請求を追加します</p><p>{selected.map(m=>m.name).join('、')}</p><p>{selected.length}名 × {money(event.amount)} = {money(selected.length*event.amount)}</p><p className="text-xs">既存の納入・相殺・出納の記録は変更されません。</p></div>}
    <div className="flex gap-2"><button disabled={disabled} onClick={()=>preview?setPreview(false):onClose()} className="flex-1 p-3 border rounded-xl text-sm font-bold">{preview?'選び直す':'閉じる'}</button><button disabled={disabled||selected.length===0} onClick={()=>preview?onSave('add_billing_members',{...expectedBilling(event),member_ids:selected.map(m=>m.id)},onClose):setPreview(true)} className="flex-1 p-3 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-40">{preview?'確認して追加':'追加内容を確認'}</button></div>
  </section></div>;
}

export default function BillingManager({data,disabled,onAdd,onDelete,onSave,onClose,onCreate}:{data:ClubData;disabled:boolean;onAdd:(event:BillingEvent)=>void;onDelete:(event:BillingEvent)=>void;onSave:BillingSave;onClose:()=>void;onCreate:(kind:'dues'|'other')=>void}) {
  const [kind,setKind] = useState<'dues'|'other'>('dues');
  const [editing,setEditing] = useState<BillingEvent|null>(null);
  const [newKind,setNewKind] = useState<'dues'|'other'>('dues');
  const [month,setMonth] = useState('');
  const events = data.events.filter(e=>billingKind(e)===kind).sort((a,b)=>(eventDuesMonth(b)||b.due_date).localeCompare(eventDuesMonth(a)||a.due_date));
  return <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"><section role="dialog" aria-modal="true" aria-label="請求管理" className="bg-white rounded-3xl p-5 w-full max-w-lg space-y-4 max-h-[90vh] overflow-auto">
    <div className="flex justify-between items-center"><h3 className="font-black text-lg">請求管理</h3><button aria-label="閉じる" onClick={onClose} className="p-2">✕</button></div>
    <div className="grid grid-cols-2 bg-slate-100 rounded-xl p-1">{(['dues','other'] as const).map(k=><button key={k} onClick={()=>setKind(k)} className={`p-2 rounded-lg font-bold text-sm ${kind===k?'bg-white text-blue-700 shadow-sm':'text-slate-500'}`}>{k==='dues'?'毎月の部費':'その他の請求'}</button>)}</div>
    <p className="text-xs text-slate-500">{kind==='dues'?'納入済みの人数は、登録された請求対象者の中での人数です。未登録の部員は「部費一覧」で確認できます。':'合宿費・遠征費など、毎月の部費以外を管理します。'}</p>
    <button disabled={disabled} onClick={()=>onCreate(kind)} className="w-full rounded-xl bg-slate-900 p-3 text-sm text-white font-bold">{kind==='dues'?'部費の請求を作成':'その他の請求を作成'}</button>
    {events.length===0 && <p className="text-sm text-slate-500 text-center py-6">請求はありません。</p>}
    {events.map(event=>{
      const payments=data.payments.filter(p=>p.billing_event_id===event.id);
      const full=payments.filter(p=>p.paid_amount>=event.amount).length;
      const partial=payments.filter(p=>p.paid_amount>0&&p.paid_amount<event.amount).length;
      const canDelete=payments.every(p=>!p.paid_amount&&p.status==='未納')&&!data.offsetTransactions.some(o=>payments.some(p=>p.id===o.payment_id));
      return <article key={event.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
        <div className="flex justify-between gap-3"><div><h4 className="font-bold text-sm">{event.title}</h4><p className="text-xs text-slate-500">{eventDuesMonth(event)&&`${eventDuesMonth(event)}分 · `}期日 {event.due_date}</p></div><b className="text-sm whitespace-nowrap">{money(event.amount)}</b></div>
        <p className="text-xs">対象 {payments.length}名 · 納入済 {full}名 · 一部納入 {partial}名 · 未納 {payments.length-full-partial}名</p>
        <div className="flex flex-wrap gap-2 text-xs font-bold"><button disabled={disabled} onClick={()=>onAdd(event)} className="px-3 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-40">対象者を追加</button><button disabled={disabled} onClick={()=>{setEditing(event);setNewKind(billingKind(event));setMonth(eventDuesMonth(event)||'');}} className="px-3 py-2 rounded-lg border">種類・対象月</button><button disabled={disabled||!canDelete} onClick={()=>onDelete(event)} className="px-3 py-2 rounded-lg text-rose-600 border disabled:opacity-30">削除</button></div>
      </article>;
    })}
    {editing && <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4"><form onSubmit={e=>{e.preventDefault();onSave('classify_billing',{...expectedBilling(editing),billing_kind:newKind,billing_month:newKind==='dues'?month:null},()=>setEditing(null));}} className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-4"><h4 className="font-bold">種類・対象月を設定</h4><p className="text-sm">{editing.title} · {money(editing.amount)}</p><p className="text-xs text-slate-500">請求金額・納入状況・実際の入金日は変更しません。同じ部員の同月請求と重なる変更は保存できません。</p><fieldset disabled={disabled} className="space-y-3"><label className="block text-sm">種類<select value={newKind} onChange={e=>setNewKind(e.target.value as 'dues'|'other')} className="block w-full border p-3 rounded-xl"><option value="dues">毎月の部費</option><option value="other">その他の請求</option></select></label>{newKind==='dues'&&<label className="block text-sm">対象月<input required type="month" value={month} onChange={e=>setMonth(e.target.value)} className="block w-full border p-3 rounded-xl"/></label>}<div className="flex gap-2"><button type="button" onClick={()=>setEditing(null)} className="flex-1 p-3 border rounded-xl">戻る</button><button className="flex-1 p-3 bg-blue-600 text-white rounded-xl">保存</button></div></fieldset></form></div>}
  </section></div>;
}

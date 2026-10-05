'use client';

import {useState} from 'react';
import type {ClubTransaction, Expense, Payment} from '@/types';
import {expenseSettlementDate,paymentDate,transactionDate} from '@/lib/accounting';

export type DateEditTarget = {kind:'payment';record:Payment;title:string}|{kind:'expense';record:Expense;title:string}|{kind:'club';record:ClubTransaction;title:string};

export default function RecordDateEditor({target,disabled,onClose,onSave}:{target:DateEditTarget;disabled:boolean;onClose:()=>void;onSave:(payload:Record<string,unknown>)=>Promise<void>}) {
  const [cashDate,setCashDate]=useState((target.kind==='payment'?paymentDate(target.record):target.kind==='expense'?expenseSettlementDate(target.record):transactionDate(target.record))||'');
  const [incurred,setIncurred]=useState(target.kind==='expense'?target.record.incurred_on||'':'');
  const [note,setNote]=useState(target.record.review_note||'');
  const [confirmed,setConfirmed]=useState(!target.record.date_provisional);
  const [source,setSource]=useState(target.kind==='club'?target.record.payment_source:'不明');
  return <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"><div className="bg-white rounded-3xl p-5 w-full max-w-sm max-h-[90vh] overflow-y-auto space-y-4">
    <h3 className="font-black text-lg">日付・確認メモの編集</h3><p className="font-bold">{target.title}</p>
    <form onSubmit={async e=>{e.preventDefault();await onSave({kind:target.kind,id:target.record.id,cash_date:cashDate||null,incurred_on:target.kind==='expense'?incurred||null:undefined,review_note:note.trim(),date_provisional:!confirmed,payment_source:target.kind==='club'?source:undefined,expected_date_provisional:target.record.date_provisional||false,expected_payment_source:target.kind==='club'?target.record.payment_source:undefined,expected_cash_date:target.kind==='payment'?target.record.paid_on||null:target.kind==='expense'?target.record.settled_on||null:target.record.transaction_date||null,expected_incurred_on:target.kind==='expense'?target.record.incurred_on||null:undefined,expected_review_note:target.record.review_note||null,expected_paid:target.kind==='payment'?target.record.paid_amount:undefined,expected_settled:target.kind==='expense'?target.record.settled_amount:undefined});}}>
      <fieldset disabled={disabled} className="space-y-3">
        {target.kind==='expense'&&<label className="block text-xs font-bold">領収書・購入日<input type="date" value={incurred} onChange={e=>setIncurred(e.target.value)} className="block w-full p-3 border rounded-xl mt-1"/></label>}
        <label className="block text-xs font-bold">{target.kind==='payment'?'納入日':target.kind==='expense'?'立替精算日':'出納日'}<input type="date" value={cashDate} onChange={e=>setCashDate(e.target.value)} required={confirmed} className="block w-full p-3 border rounded-xl mt-1"/></label>
        <label className="flex gap-2 text-xs items-center"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>日付を確認済みにする</label>
        {target.kind==='club'&&<label className="block text-xs font-bold">出納元<select value={source} onChange={e=>setSource(e.target.value as ClubTransaction['payment_source'])} className="block w-full p-3 border rounded-xl mt-1">{['不明','部口座振込','部室現金'].map(s=><option key={s}>{s}</option>)}</select></label>}
        <label className="block text-xs font-bold">確認メモ<textarea value={note} onChange={e=>setNote(e.target.value)} rows={4} className="block w-full p-3 border rounded-xl mt-1"/></label>
        {target.record.source_reference&&<p className="text-xs text-slate-500">元資料: {target.record.source_reference}</p>}
        <div className="flex gap-2"><button type="button" onClick={onClose} className="flex-1 p-3 border rounded-xl font-bold text-xs">戻る</button><button type="submit" className="flex-1 p-3 bg-slate-900 text-white rounded-xl font-bold text-xs">保存する</button></div>
      </fieldset>
    </form>
  </div></div>;
}

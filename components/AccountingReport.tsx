'use client';

import { useState } from 'react';
import { cashEntries, createCsv, fiscalYear, japanDate, periodBounds, summarizeEntries, type CashEntry, type ClubData } from '@/lib/accounting';

export default function AccountingReport({data, disabled, onCreate, onEdit, onRevert, onConfirm}: {
  data: ClubData; disabled: boolean; onCreate: () => void; onEdit: (entry: CashEntry) => void;
  onRevert: (id: string) => void; onConfirm: (id: string) => void;
}) {
  const [mode,setMode] = useState<'all' | 'month' | 'year'>('all');
  const [month,setMonth] = useState(japanDate().slice(0,7));
  const [year,setYear] = useState(String(fiscalYear(japanDate())));
  const [view,setView] = useState<'all' | '収入' | '支出' | 'review'>('all');
  const entries=cashEntries(data);
  const bounds=periodBounds(mode,mode==='year'?year:month);
  const inPeriod=entries.filter(e => !bounds || (e.date && e.date>=bounds.start && e.date<bounds.end));
  const totals=summarizeEntries(inPeriod);
  const unknown=entries.filter(e => !e.date);
  const years=[...new Set([fiscalYear(japanDate()),...entries.filter(e=>e.date).map(e=>fiscalYear(e.date!))])].sort((a,b)=>b-a);
  const label=mode==='all'?'全期間':mode==='year'?`${year}年度（4月〜翌年3月）`:month.replace('-','年')+'月';
  const monthly=[...new Set(inPeriod.filter(e=>e.date).map(e=>e.date!.slice(0,7)))].sort();
  const yearly=[...new Set(entries.filter(e=>e.date).map(e=>fiscalYear(e.date!)))].sort((a,b)=>b-a);
  const visible=inPeriod.filter(e=>view==='all'||(view==='review'?(e.dateProvisional||e.settlementProvisional||e.party==='不明'):e.direction===view));
  const categoryTotals: Record<string,{income:number;expense:number}>={};
  for (const e of inPeriod) {
    categoryTotals[e.category] ||= {income:0,expense:0};
    categoryTotals[e.category][e.direction==='収入'?'income':'expense']+=e.amount;
  }
  const exportPeriod=() => {
    const rows=[['日付','種別','分類','品名・内容','部員・出納元','金額','確認状況','メモ','元資料'],
      ...inPeriod.map(e=>[e.date||'',e.direction,e.category,e.title,e.party,String(e.amount),[e.dateProvisional?'日付仮登録':'',e.settlementProvisional?'精算仮登録':'',e.party==='不明'?'出納元不明':''].filter(Boolean).join('・'),e.reviewNote,e.sourceReference])];
    const url=URL.createObjectURL(new Blob([createCsv(rows)],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a'); link.href=url; link.download=`会計_${label}.csv`; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <div className="space-y-4">
    <section className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
      <div className="flex flex-wrap justify-between gap-2 items-center">
        <h2 className="font-black text-lg">会計の期間</h2>
        <button disabled={disabled} onClick={exportPeriod} className="border rounded-lg px-3 py-2 text-xs font-bold">表示期間をCSVにする</button>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {(['all','month','year'] as const).map((m,i)=><button key={m} onClick={()=>setMode(m)} aria-pressed={mode===m} className={`rounded-xl px-4 py-2 font-bold ${mode===m?'bg-slate-900 text-white':'bg-slate-100'}`}>{['全期間','月別','年度別'][i]}</button>)}
        {mode==='month' && <label className="text-xs">対象月 <input aria-label="集計対象月" type="month" required value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}} className="border rounded-lg p-2"/></label>}
        {mode==='year' && <label className="text-xs">対象年度 <select aria-label="集計対象年度" value={year} onChange={e=>setYear(e.target.value)} className="border rounded-lg p-2">{years.map(y=><option key={y} value={y}>{y}年度</option>)}</select></label>}
      </div>
      <p className="text-xs text-slate-500">納入日・立替精算日・出納日で集計します。年度は4月1日〜翌年3月31日です。</p>
    </section>
    <section className="bg-slate-900 text-white p-6 rounded-3xl space-y-4">
      <h2 className="text-sm text-slate-300">{label}の記録収支</h2>
      <p className="text-3xl font-black tabular-nums">¥{totals.net.toLocaleString()}</p>
      <div className="grid grid-cols-2 gap-3 border-t border-slate-700 pt-3">
        <div><p className="text-xs text-slate-300">入金（現金・振込）</p><p className="text-emerald-300 font-bold">¥{totals.income.toLocaleString()}</p></div>
        <div><p className="text-xs text-slate-300">出金（部支出・立替精算）</p><p className="text-rose-300 font-bold">¥{totals.expense.toLocaleString()}</p></div>
      </div>
      <p className="text-xs text-slate-300">相殺は入出金に含めません。繰越残高は未設定のため、口座・現金の実残高とは異なる場合があります。</p>
    </section>
    <button disabled={disabled} onClick={onCreate} className="w-full p-3.5 bg-emerald-700 text-white rounded-xl font-bold">出納を記録</button>
    {unknown.length>0 && <p className="p-3 rounded-xl bg-amber-50 text-amber-900 text-xs">日付不明の入出金が{unknown.length}件あります。月別・年度別には含めません。全期間の明細から日付を設定してください。</p>}
    <section className="bg-white rounded-2xl border p-4 space-y-3">
      <h3 className="font-black">{mode==='all'?'年度別の収支':'月別の収支'}</h3>
      <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b text-slate-500"><th className="text-left py-2">期間</th><th className="text-right">入金</th><th className="text-right">出金</th><th className="text-right">収支</th></tr></thead><tbody>
        {(mode==='all'?yearly.map(String):monthly).map(p=>{
          const rows=mode==='all'?entries.filter(e=>e.date&&String(fiscalYear(e.date))===p):inPeriod.filter(e=>e.date?.startsWith(p));
          const t=summarizeEntries(rows);
          return <tr key={p} className="border-b border-slate-100"><td className="py-3"><button className="text-blue-700 font-bold underline" onClick={()=>{if(mode==='all'){setYear(p);setMode('year');}else{setMonth(p);setMode('month');}}}>{mode==='all'?`${p}年度`:p}</button></td><td className="text-right">¥{t.income.toLocaleString()}</td><td className="text-right">¥{t.expense.toLocaleString()}</td><td className="text-right font-bold">¥{t.net.toLocaleString()}</td></tr>;
        })}
      </tbody></table></div>
      {inPeriod.length===0 && <p className="text-xs text-slate-500">この期間の入出金はありません。</p>}
    </section>
    <section className="bg-white rounded-2xl border p-4 space-y-3"><h3 className="font-black">カテゴリ別</h3>
      {Object.entries(categoryTotals).map(([category,t])=><div key={category} className="flex flex-wrap justify-between text-xs gap-2"><span>{category}</span><span>入金 ¥{t.income.toLocaleString()} ／ 出金 ¥{t.expense.toLocaleString()}</span></div>)}
    </section>
    <section className="bg-white rounded-2xl border p-4 space-y-3">
      <h3 className="font-black">{label}の入出金明細</h3>
      <div className="flex flex-wrap gap-2">{(['all','収入','支出','review'] as const).map((v,i)=><button key={v} onClick={()=>setView(v)} aria-pressed={view===v} className={`px-3 py-2 rounded-lg text-xs font-bold ${view===v?'bg-blue-100 text-blue-800':'bg-slate-100'}`}>{['すべて','入金','出金','要確認'][i]}</button>)}</div>
      {visible.map(e=><article key={e.id} className="border rounded-xl p-3 space-y-2">
        <div className="flex justify-between gap-2"><div><p className="text-xs text-slate-500">{e.date||'日付不明'} ／ {e.party}</p><p className="font-bold">{e.title}</p></div><p className={`font-black whitespace-nowrap ${e.direction==='収入'?'text-emerald-700':'text-rose-700'}`}>{e.direction==='収入'?'+':'−'}¥{e.amount.toLocaleString()}</p></div>
        <p className="text-xs text-slate-500">{e.category}</p>
        <div className="flex flex-wrap gap-1 text-xs text-amber-900">{e.dateProvisional&&<span className="bg-amber-100 rounded px-2 py-1">日付は仮登録</span>}{e.settlementProvisional&&<span className="bg-amber-100 rounded px-2 py-1">精算済みとして仮登録・要確認</span>}{e.party==='不明'&&<span className="bg-amber-100 rounded px-2 py-1">出納元不明</span>}</div>
        {e.reviewNote&&<p className="text-xs text-slate-600 whitespace-pre-wrap">{e.reviewNote}</p>}
        {e.sourceReference&&<p className="text-xs text-slate-400">元資料: {e.sourceReference}</p>}
        <div className="flex flex-wrap gap-2"><button disabled={disabled} onClick={()=>onEdit(e)} className="text-xs text-blue-700 underline py-1">日付・確認メモを編集</button>
          {e.kind==='expense'&&e.settlementProvisional&&<><button disabled={disabled} onClick={()=>onConfirm(e.recordId)} className="text-xs text-emerald-700 underline py-1">精算済みを確認</button><button disabled={disabled} onClick={()=>onRevert(e.recordId)} className="text-xs text-rose-700 underline py-1">未精算に戻す</button></>}
        </div>
      </article>)}
      {visible.length===0&&<p className="text-xs text-slate-500 py-4">該当する入出金はありません。</p>}
    </section>
  </div>;
}

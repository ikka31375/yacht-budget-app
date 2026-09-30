'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Member, Payment, Expense, BillingEvent } from '@/types';

export default function Home() {
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // 初回データ読み込み
  useEffect(() => {
    fetchData();
    const saved = localStorage.getItem('selectedMemberId');
    if (saved) setSelectedMemberId(saved);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: mData } = await supabase.from('members').select('*');
    const { data: pData } = await supabase.from('payments').select('*');
    const { data: eData } = await supabase.from('expenses').select('*');
    const { data: bData } = await supabase.from('billing_events').select('*');

    if (mData) setMembers(mData);
    if (pData) setPayments(pData);
    if (eData) setExpenses(eData);
    if (bData) setEvents(bData);
    setLoading(false);
  };

  const handleMemberChange = (id: string) => {
    setSelectedMemberId(id);
    localStorage.setItem('selectedMemberId', id);
  };

  // 収支バランス計算（立替未受取額 - 未納額）
  const calculateBalance = (memberId: string) => {
    const unpaidSum = payments
      .filter((p) => p.member_id === memberId && p.status === '未納')
      .reduce((sum, p) => {
        const ev = events.find((e) => e.id === p.billing_event_id);
        return sum + (ev?.amount || 0);
      }, 0);

    const unreimbursedSum = expenses
      .filter((e) => e.member_id === memberId && e.status === '未精算')
      .reduce((sum, e) => sum + e.amount, 0);

    return unreimbursedSum - unpaidSum;
  };

  // 支払いステータス切り替え
  const togglePayment = async (paymentId: string, currentStatus: string) => {
    const nextStatus = currentStatus === '未納' ? '支払済' : '未納';
    await supabase.from('payments').update({ status: nextStatus }).eq('id', paymentId);
    fetchData();
  };

  return (
    <main className="max-w-md mx-auto p-4 space-y-6 pb-20 min-h-screen bg-white">
      <header className="border-b pb-3">
        <h1 className="text-xl font-bold text-gray-800">⛵ ヨット部 部費管理</h1>
        <div className="mt-3">
          <label className="text-xs text-gray-500 font-medium">ログイン不要：あなたの名前を選択</label>
          <select
            value={selectedMemberId}
            onChange={(e) => handleMemberChange(e.target.value)}
            className="w-full mt-1 p-2 border border-gray-300 rounded-md bg-gray-50 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">-- 部員を選択してください --</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.grade}年 {m.name} ({m.role})
              </option>
            ))}
          </select>
        </div>
      </header>

      {loading ? (
        <p className="text-sm text-gray-500 text-center py-8">データを読み込み中...</p>
      ) : (
        <>
          {/* 部員別 収支バランス（負債 / 前払い状況） */}
          <section className="space-y-3">
            <h2 className="font-semibold text-sm text-gray-700">部員別 収支バランス</h2>
            <div className="space-y-2">
              {members.map((m) => {
                const balance = calculateBalance(m.id);
                return (
                  <div key={m.id} className="flex justify-between items-center p-3 bg-gray-50 border border-gray-100 rounded-lg text-sm">
                    <span className="font-medium text-gray-800">{m.grade}年 {m.name}</span>
                    <span className={`font-bold ${balance < 0 ? 'text-red-600' : balance > 0 ? 'text-blue-600' : 'text-gray-500'}`}>
                      {balance < 0 
                        ? `負債: ¥${Math.abs(balance).toLocaleString()}` 
                        : balance > 0 
                        ? `立替/前払: +¥${balance.toLocaleString()}` 
                        : '±¥0'}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 請求・支払い一覧 */}
          <section className="space-y-3">
            <h2 className="font-semibold text-sm text-gray-700">請求・納入ステータス</h2>
            {payments.length === 0 ? (
              <p className="text-xs text-gray-400 p-3 bg-gray-50 rounded-lg border text-center">請求データはまだありません</p>
            ) : (
              payments.map((p) => {
                const ev = events.find((e) => e.id === p.billing_event_id);
                const member = members.find((m) => m.id === p.member_id);
                return (
                  <div key={p.id} className="flex justify-between items-center p-3 border border-gray-200 rounded-lg">
                    <div>
                      <p className="font-medium text-sm text-gray-800">{ev?.title || '部費'}</p>
                      <p className="text-xs text-gray-500">{member?.name} | ¥{ev?.amount.toLocaleString()}</p>
                    </div>
                    <button
                      onClick={() => togglePayment(p.id, p.status)}
                      className={`text-xs px-3 py-1.5 rounded-full font-bold transition shadow-sm ${
                        p.status === '支払済' 
                          ? 'bg-green-100 text-green-700 border border-green-300' 
                          : 'bg-red-100 text-red-600 border border-red-300'
                      }`}
                    >
                      {p.status}
                    </button>
                  </div>
                );
              })
            )}
          </section>
        </>
      )}
    </main>
  );
}

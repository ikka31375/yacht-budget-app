'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Member, Payment, Expense, BillingEvent } from '@/types';

export default function Home() {
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // モーダル管理
  const [showEventModal, setShowEventModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showOffsetModal, setShowOffsetModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);

  // フォーム用State: 請求作成（部員選択チェックボックス対応）
  const [eventTitle, setEventTitle] = useState('');
  const [eventAmount, setEventAmount] = useState('');
  const [eventDueDate, setEventDueDate] = useState('');
  const [targetMemberIds, setTargetMemberIds] = useState<string[]>([]);

  // フォーム用State: 立替申請
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('ガソリン代');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // フォーム用State: デポジット入金
  const [depositAmount, setDepositAmount] = useState('');

  // フォーム用State: 相殺処理
  const [selectedExpenseForOffset, setSelectedExpenseForOffset] = useState<Expense | null>(null);
  const [targetPaymentIdForOffset, setTargetPaymentIdForOffset] = useState<string>('');

  // フォーム用State: 差戻し
  const [targetExpenseForReject, setTargetExpenseForReject] = useState<Expense | null>(null);
  const [rejectReasonText, setRejectReasonText] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchData();
    const saved = localStorage.getItem('selectedMemberId');
    if (saved) setSelectedMemberId(saved);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: mData } = await supabase.from('members').select('*').order('grade', { ascending: true });
    const { data: pData } = await supabase.from('payments').select('*');
    const { data: eData } = await supabase.from('expenses').select('*').order('id', { ascending: false });
    const { data: bData } = await supabase.from('billing_events').select('*').order('created_at', { ascending: false });

    if (mData) {
      setMembers(mData);
      if (targetMemberIds.length === 0) setTargetMemberIds(mData.map((m) => m.id));
    }
    if (pData) setPayments(pData);
    if (eData) setExpenses(eData);
    if (bData) setEvents(bData);
    setLoading(false);
  };

  const handleMemberChange = (id: string) => {
    setSelectedMemberId(id);
    localStorage.setItem('selectedMemberId', id);
  };

  const currentMember = members.find((m) => m.id === selectedMemberId);

  // 未納部費合計の計算
  const getUnpaidTotal = (memberId: string) => {
    return payments
      .filter((p) => p.member_id === memberId && p.status === '未納')
      .reduce((sum, p) => {
        const ev = events.find((e) => e.id === p.billing_event_id);
        return sum + (ev?.amount || 0);
      }, 0);
  };

  // 未精算立替合計の計算
  const getUnreimbursedTotal = (memberId: string) => {
    return expenses
      .filter((e) => e.member_id === memberId && e.status === '未精算')
      .reduce((sum, e) => sum + e.amount, 0);
  };

  // 画像圧縮ユーティリティ
  const compressImage = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSide = 1200;
        let width = img.width;
        let height = img.height;
        if (width > height && width > maxSide) {
          height = Math.round((height * maxSide) / width);
          width = maxSide;
        } else if (height > maxSide) {
          width = Math.round((width * maxSide) / height);
          height = maxSide;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('圧縮エラー'))), 'image/jpeg', 0.7);
      };
      img.onerror = (err) => reject(err);
    });
  };

  // 1. 請求イベント作成（対象部員の選択可能）
  const handleCreateBillingEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventTitle || !eventAmount || targetMemberIds.length === 0) {
      alert('請求名、金額、および対象部員を1人以上選択してください');
      return;
    }
    setIsSubmitting(true);

    const { data: eventData, error: evError } = await supabase
      .from('billing_events')
      .insert({
        title: eventTitle,
        amount: parseInt(eventAmount, 10),
        due_date: eventDueDate || new Date().toISOString().split('T')[0],
        type: '部費・遠征費',
      })
      .select()
      .single();

    if (evError || !eventData) {
      alert('請求作成に失敗しました');
      setIsSubmitting(false);
      return;
    }

    const paymentRecords = targetMemberIds.map((mId) => ({
      billing_event_id: eventData.id,
      member_id: mId,
      status: '未納',
      payment_method: '現金/振込',
    }));

    await supabase.from('payments').insert(paymentRecords);

    setEventTitle('');
    setEventAmount('');
    setEventDueDate('');
    setShowEventModal(false);
    setIsSubmitting(false);
    fetchData();
  };

  // 2. 立替申請
  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMemberId) {
      alert('ヘッダーであなたの名前を選択してください');
      return;
    }
    if (!expenseTitle || !expenseAmount) return;

    setIsSubmitting(true);
    let receiptUrl = '';

    if (receiptFile) {
      try {
        const compressedBlob = await compressImage(receiptFile);
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('receipts')
          .upload(fileName, compressedBlob, { contentType: 'image/jpeg' });

        if (!uploadError) {
          const { data: publicUrlData } = supabase.storage.from('receipts').getPublicUrl(fileName);
          receiptUrl = publicUrlData.publicUrl;
        }
      } catch (err) {
        console.error('画像アップロード失敗:', err);
      }
    }

    await supabase.from('expenses').insert({
      member_id: selectedMemberId,
      title: expenseTitle,
      amount: parseInt(expenseAmount, 10),
      category: expenseCategory,
      receipt_url: receiptUrl,
      status: '未精算',
    });

    setExpenseTitle('');
    setExpenseAmount('');
    setReceiptFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setShowExpenseModal(false);
    setIsSubmitting(false);
    fetchData();
  };

  // 3. デポジット（前払い金）チャージ
  const handleAddDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMemberId || !depositAmount) return;
    setIsSubmitting(true);

    const currentBalance = currentMember?.deposit_balance || 0;
    const addVal = parseInt(depositAmount, 10);

    await supabase
      .from('members')
      .update({ deposit_balance: currentBalance + addVal })
      .eq('id', selectedMemberId);

    setDepositAmount('');
    setShowDepositModal(false);
    setIsSubmitting(false);
    fetchData();
  };

  // 4. デポジットから部費を充当（即時完済）
  const handlePayWithDeposit = async (paymentId: string, requiredAmount: number) => {
    if (!currentMember) return;
    if (currentMember.deposit_balance < requiredAmount) {
      alert(`デポジット残高が不足しています（現在: ¥${currentMember.deposit_balance.toLocaleString()}）`);
      return;
    }
    if (!confirm(`デポジットから ¥${requiredAmount.toLocaleString()} を引き落として支払済にしますか？`)) return;

    // 残高減算
    await supabase
      .from('members')
      .update({ deposit_balance: currentMember.deposit_balance - requiredAmount })
      .eq('id', currentMember.id);

    // 請求を支払済に更新
    await supabase
      .from('payments')
      .update({ status: '支払済', payment_method: 'デポジット' })
      .eq('id', paymentId);

    fetchData();
  };

  // 5. 立替金を未納部費へ相殺（バーター精算）
  const handleExecuteOffset = async () => {
    if (!selectedExpenseForOffset || !targetPaymentIdForOffset) return;
    setIsSubmitting(true);

    const targetPayment = payments.find((p) => p.id === targetPaymentIdForOffset);
    const targetEvent = events.find((e) => e.id === targetPayment?.billing_event_id);
    const paymentAmount = targetEvent?.amount || 0;
    const expenseAmountVal = selectedExpenseForOffset.amount;

    if (expenseAmountVal < paymentAmount) {
      alert('立替金額が請求額より小さいため、このバージョンの相殺は立替額≧請求額のみ対応しています。');
      setIsSubmitting(false);
      return;
    }

    // 請求を支払済（相殺）に
    await supabase
      .from('payments')
      .update({
        status: '支払済',
        payment_method: '相殺',
        offset_expense_id: selectedExpenseForOffset.id,
      })
      .eq('id', targetPaymentIdForOffset);

    // 立替を精算済（相殺）に
    await supabase
      .from('expenses')
      .update({
        status: '精算済',
        offset_payment_id: targetPaymentIdForOffset,
      })
      .eq('id', selectedExpenseForOffset.id);

    // もし立替のほうが大きい場合は差額をデポジットへ加算
    const diff = expenseAmountVal - paymentAmount;
    if (diff > 0) {
      const mem = members.find((m) => m.id === selectedExpenseForOffset.member_id);
      if (mem) {
        await supabase
          .from('members')
          .update({ deposit_balance: mem.deposit_balance + diff })
          .eq('id', mem.id);
        alert(`相殺完了！差額 ¥${diff.toLocaleString()} は部員のデポジット（預かり金）に自動加算されました。`);
      }
    } else {
      alert('相殺処理が正常に完了しました！');
    }

    setShowOffsetModal(false);
    setSelectedExpenseForOffset(null);
    setTargetPaymentIdForOffset('');
    setIsSubmitting(false);
    fetchData();
  };

  // 6. 立替の差戻し処理
  const handleExecuteReject = async () => {
    if (!targetExpenseForReject) return;
    setIsSubmitting(true);

    await supabase
      .from('expenses')
      .update({
        status: '差戻し',
        reject_reason: rejectReasonText,
      })
      .eq('id', targetExpenseForReject.id);

    setShowRejectModal(false);
    setTargetExpenseForReject(null);
    setRejectReasonText('');
    setIsSubmitting(false);
    fetchData();
  };

  // 通常ステータス切り替え
  const togglePaymentNormal = async (paymentId: string, currentStatus: string) => {
    const nextStatus = currentStatus === '未納' ? '支払済' : '未納';
    await supabase.from('payments').update({ status: nextStatus, payment_method: '現金/振込' }).eq('id', paymentId);
    fetchData();
  };

  const toggleExpenseNormal = async (expenseId: string, currentStatus: string) => {
    const nextStatus = currentStatus === '未精算' ? '精算済' : '未精算';
    await supabase.from('expenses').update({ status: nextStatus }).eq('id', expenseId);
    fetchData();
  };

  // CSVダウンロード
  const exportToCSV = () => {
    const header = ['種別', '対象者', '品名/請求名', '金額', 'ステータス', '支払手段/備考', '日付'];
    const rows: string[][] = [];

    payments.forEach((p) => {
      const ev = events.find((e) => e.id === p.billing_event_id);
      const mem = members.find((m) => m.id === p.member_id);
      rows.push(['請求(部費)', mem?.name || '', ev?.title || '', String(ev?.amount || 0), p.status, p.payment_method || '', ev?.due_date || '']);
    });

    expenses.forEach((e) => {
      const mem = members.find((m) => m.id === e.member_id);
      rows.push(['支出(立替)', mem?.name || '', e.title, String(e.amount), e.status, e.reject_reason || '', e.created_at?.split('T')[0] || '']);
    });

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [header.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `yacht_club_budget_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <main className="max-w-md mx-auto p-4 space-y-6 pb-24 min-h-screen bg-slate-50 text-slate-800">
      {/* ヘッダー & 部員セレクター */}
      <header className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 space-y-3">
        <div className="flex justify-between items-center">
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-1.5">⛵ ヨット部 会計管理</h1>
          <button onClick={exportToCSV} className="text-xs bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded text-slate-700 font-medium">
            📥 CSV出力
          </button>
        </div>
        <div>
          <label className="text-[11px] text-slate-500 font-medium">ログイン不要：あなたの名前を選択</label>
          <select
            value={selectedMemberId}
            onChange={(e) => handleMemberChange(e.target.value)}
            className="w-full mt-1 p-2 border border-slate-200 rounded-lg bg-slate-50 text-sm font-semibold"
          >
            <option value="">-- 部員を選択してください --</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.grade}年 {m.name} ({m.role})
              </option>
            ))}
          </select>
        </div>

        {/* 自分の個別ダッシュボード（選択時のみ表示） */}
        {currentMember && (
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center">
            <div className="bg-red-50 p-2 rounded-lg">
              <span className="text-[10px] text-red-600 block">未納部費</span>
              <span className="text-xs font-bold text-red-700">¥{getUnpaidTotal(currentMember.id).toLocaleString()}</span>
            </div>
            <div className="bg-blue-50 p-2 rounded-lg">
              <span className="text-[10px] text-blue-600 block">未精算立替</span>
              <span className="text-xs font-bold text-blue-700">¥{getUnreimbursedTotal(currentMember.id).toLocaleString()}</span>
            </div>
            <div className="bg-emerald-50 p-2 rounded-lg flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-emerald-600 block">預かり金(前払)</span>
                <span className="text-xs font-bold text-emerald-700">¥{currentMember.deposit_balance.toLocaleString()}</span>
              </div>
              <button
                onClick={() => setShowDepositModal(true)}
                className="mt-1 text-[9px] bg-emerald-600 text-white rounded px-1 py-0.5"
              >
                + チャージ
              </button>
            </div>
          </div>
        )}
      </header>

      {/* アクションボタン */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setShowExpenseModal(true)}
          className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-sm flex items-center justify-center gap-1"
        >
          <span>📸</span> 立替を申請する
        </button>
        <button
          onClick={() => {
            setTargetMemberIds(members.map((m) => m.id));
            setShowEventModal(true);
          }}
          className="p-3 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold text-xs shadow-sm flex items-center justify-center gap-1"
        >
          <span>📋</span> 請求を作成（部費等）
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-slate-400 text-center py-8">データを読み込み中...</p>
      ) : (
        <>
          {/* ① 部員別 収支状況一覧（独立表示） */}
          <section className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 space-y-2">
            <h2 className="font-bold text-xs text-slate-500 uppercase tracking-wider">部員別 サマリー一覧</h2>
            <div className="space-y-1.5">
              {members.map((m) => {
                const unpaid = getUnpaidTotal(m.id);
                const unreimbursed = getUnreimbursedTotal(m.id);
                const canOffset = unpaid > 0 && unreimbursed > 0;

                return (
                  <div key={m.id} className="flex justify-between items-center p-2.5 bg-slate-50 rounded-lg text-xs">
                    <div>
                      <span className="font-semibold text-slate-800">{m.grade}年 {m.name}</span>
                      {canOffset && (
                        <span className="ml-2 text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">
                          相殺可能
                        </span>
                      )}
                    </div>
                    <div className="text-right space-x-2 text-[11px]">
                      <span className={unpaid > 0 ? 'text-red-600 font-bold' : 'text-slate-400'}>
                        未納: ¥{unpaid.toLocaleString()}
                      </span>
                      <span className={unreimbursed > 0 ? 'text-blue-600 font-bold' : 'text-slate-400'}>
                        立替: ¥{unreimbursed.toLocaleString()}
                      </span>
                      {m.deposit_balance > 0 && (
                        <span className="text-emerald-600 font-bold">
                          預り: ¥{m.deposit_balance.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ② 請求・納入ステータス */}
          <section className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 space-y-3">
            <h2 className="font-bold text-xs text-slate-500 uppercase tracking-wider">請求・部費納入リスト</h2>
            {payments.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">請求はありません</p>
            ) : (
              payments.map((p) => {
                const ev = events.find((e) => e.id === p.billing_event_id);
                const member = members.find((m) => m.id === p.member_id);
                const evAmount = ev?.amount || 0;
                const hasDeposit = (member?.deposit_balance || 0) >= evAmount;

                return (
                  <div key={p.id} className="p-3 border border-slate-100 rounded-lg bg-white flex justify-between items-center">
                    <div>
                      <p className="font-bold text-xs text-slate-800">{ev?.title}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {member?.name} | <span className="font-semibold text-slate-700">¥{evAmount.toLocaleString()}</span>
                      </p>
                      {p.payment_method && p.status === '支払済' && (
                        <span className="inline-block mt-1 text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded">
                          {p.payment_method}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {p.status === '未納' && hasDeposit && (
                        <button
                          onClick={() => handlePayWithDeposit(p.id, evAmount)}
                          className="text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1.5 rounded-lg font-bold shadow-sm"
                        >
                          預り金充当
                        </button>
                      )}
                      <button
                        onClick={() => togglePaymentNormal(p.id, p.status)}
                        className={`text-xs px-3 py-1.5 rounded-lg font-bold transition shadow-sm ${
                          p.status === '支払済'
                            ? 'bg-green-100 text-green-700 border border-green-300'
                            : 'bg-red-50 text-red-600 border border-red-200'
                        }`}
                      >
                        {p.status}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </section>

          {/* ③ 立替・経費申請リスト */}
          <section className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 space-y-3">
            <h2 className="font-bold text-xs text-slate-500 uppercase tracking-wider">立替・経費リスト</h2>
            {expenses.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">立替申請はありません</p>
            ) : (
              expenses.map((e) => {
                const member = members.find((m) => m.id === e.member_id);
                const memberUnpaidPayments = payments.filter(
                  (p) => p.member_id === e.member_id && p.status === '未納'
                );

                return (
                  <div key={e.id} className="p-3 border border-slate-100 rounded-lg bg-white space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                          {e.category}
                        </span>
                        <p className="font-bold text-sm text-slate-800 mt-1">{e.title}</p>
                        <p className="text-xs text-slate-500">
                          {member?.name} | <span className="font-bold text-slate-800">¥{e.amount.toLocaleString()}</span>
                        </p>
                      </div>

                      {/* ステータスバッジ */}
                      <span
                        className={`text-xs px-2.5 py-1 rounded-md font-bold ${
                          e.status === '精算済'
                            ? 'bg-slate-100 text-slate-500'
                            : e.status === '差戻し'
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {e.status}
                      </span>
                    </div>

                    {/* 差戻し理由の表示 */}
                    {e.status === '差戻し' && e.reject_reason && (
                      <div className="p-2 bg-orange-50 border border-orange-100 rounded text-[11px] text-orange-800">
                        ⚠️ 差戻し理由: {e.reject_reason}
                      </div>
                    )}

                    {/* レシートリンク */}
                    {e.receipt_url && (
                      <a href={e.receipt_url} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-blue-600 underline">
                        📄 レシート画像を表示
                      </a>
                    )}

                    {/* 未精算時の操作アクション群 */}
                    {e.status === '未精算' && (
                      <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
                        {memberUnpaidPayments.length > 0 && (
                          <button
                            onClick={() => {
                              setSelectedExpenseForOffset(e);
                              setTargetPaymentIdForOffset(memberUnpaidPayments[0].id);
                              setShowOffsetModal(true);
                            }}
                            className="text-[11px] bg-amber-500 hover:bg-amber-600 text-white font-bold px-2.5 py-1 rounded shadow-sm"
                          >
                            🔄 部費へ相殺
                          </button>
                        )}
                        <button
                          onClick={() => toggleExpenseNormal(e.id, e.status)}
                          className="text-[11px] bg-slate-700 hover:bg-slate-800 text-white font-bold px-2.5 py-1 rounded shadow-sm"
                        >
                          現金で精算済
                        </button>
                        <button
                          onClick={() => {
                            setTargetExpenseForReject(e);
                            setShowRejectModal(true);
                          }}
                          className="text-[11px] bg-rose-50 text-rose-600 border border-rose-200 px-2 py-1 rounded"
                        >
                          差戻し
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </section>
        </>
      )}

      {/* モーダル: 請求作成（部員選択チェックボックス付き） */}
      {showEventModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-base text-slate-800">請求イベント作成</h3>
            <form onSubmit={handleCreateBillingEvent} className="space-y-3">
              <div>
                <label className="text-xs text-slate-600 font-medium">請求タイトル</label>
                <input
                  type="text"
                  placeholder="例: 10月度部費、秋インカレ遠征費"
                  required
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 font-medium">金額 (1人あたり)</label>
                <input
                  type="number"
                  placeholder="5000"
                  required
                  value={eventAmount}
                  onChange={(e) => setEventAmount(e.target.value)}
                  className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 font-medium">支払期日</label>
                <input
                  type="date"
                  value={eventDueDate}
                  onChange={(e) => setEventDueDate(e.target.value)}
                  className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>

              {/* 対象部員選択（チェックボックス） */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs text-slate-600 font-medium">対象部員 ({targetMemberIds.length}名)</label>
                  <button
                    type="button"
                    onClick={() => {
                      if (targetMemberIds.length === members.length) setTargetMemberIds([]);
                      else setTargetMemberIds(members.map((m) => m.id));
                    }}
                    className="text-[10px] text-blue-600 underline"
                  >
                    全選択/解除
                  </button>
                </div>
                <div className="max-h-36 overflow-y-auto border border-slate-100 rounded-lg p-2 space-y-1 bg-slate-50">
                  {members.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={targetMemberIds.includes(m.id)}
                        onChange={(e) => {
                          if (e.target.checked) setTargetMemberIds([...targetMemberIds, m.id]);
                          else setTargetMemberIds(targetMemberIds.filter((id) => id !== m.id));
                        }}
                      />
                      {m.grade}年 {m.name}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowEventModal(false)} className="flex-1 py-2 text-xs border rounded-lg">
                  キャンセル
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2 text-xs bg-slate-900 text-white font-bold rounded-lg">
                  {isSubmitting ? '作成中...' : '作成する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* モーダル: 立替申請 */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4">
            <h3 className="font-bold text-base text-slate-800">立替金の申請</h3>
            <form onSubmit={handleCreateExpense} className="space-y-3">
              <div>
                <label className="text-xs text-slate-600 font-medium">品名・用途</label>
                <input
                  type="text"
                  placeholder="例: ガソリン代、救命ロープ購入"
                  required
                  value={expenseTitle}
                  onChange={(e) => setExpenseTitle(e.target.value)}
                  className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 font-medium">金額</label>
                <input
                  type="number"
                  placeholder="3000"
                  required
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 font-medium">カテゴリ</label>
                <select
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value)}
                  className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm"
                >
                  <option value="ガソリン代">ガソリン代</option>
                  <option value="艇体・修繕費">艇体・修繕費</option>
                  <option value="消耗品">消耗品</option>
                  <option value="合宿・遠征費">合宿・遠征費</option>
                  <option value="その他">その他</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-600 font-medium">レシート写真（自動圧縮）</label>
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                  className="w-full mt-1 text-xs text-slate-500"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowExpenseModal(false)} className="flex-1 py-2 text-xs border rounded-lg">
                  キャンセル
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2 text-xs bg-blue-600 text-white font-bold rounded-lg">
                  {isSubmitting ? '送信中...' : '申請する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* モーダル: デポジット入金 */}
      {showDepositModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-5 w-full max-w-xs space-y-4">
            <h3 className="font-bold text-base text-slate-800">前払い金（デポジット）チャージ</h3>
            <p className="text-xs text-slate-500">部員がまとめて口座に振り込んできた際などに入金処理を行います。</p>
            <form onSubmit={handleAddDeposit} className="space-y-3">
              <div>
                <label className="text-xs text-slate-600 font-medium">チャージ金額</label>
                <input
                  type="number"
                  placeholder="20000"
                  required
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowDepositModal(false)} className="flex-1 py-2 text-xs border rounded-lg">
                  キャンセル
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2 text-xs bg-emerald-600 text-white font-bold rounded-lg">
                  {isSubmitting ? '入金中...' : '入金する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* モーダル: 相殺精算 */}
      {showOffsetModal && selectedExpenseForOffset && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-5 w-full max-w-xs space-y-4">
            <h3 className="font-bold text-base text-slate-800">立替金を部費へ充当（相殺）</h3>
            <div className="bg-amber-50 p-3 rounded-lg text-xs space-y-1 text-amber-900">
              <p>対象立替: <span className="font-bold">{selectedExpenseForOffset.title}</span> (¥{selectedExpenseForOffset.amount.toLocaleString()})</p>
            </div>
            <div>
              <label className="text-xs text-slate-600 font-medium">充当先の未納請求を選択</label>
              <select
                value={targetPaymentIdForOffset}
                onChange={(e) => setTargetPaymentIdForOffset(e.target.value)}
                className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-xs"
              >
                {payments
                  .filter((p) => p.member_id === selectedExpenseForOffset.member_id && p.status === '未納')
                  .map((p) => {
                    const ev = events.find((e) => e.id === p.billing_event_id);
                    return (
                      <option key={p.id} value={p.id}>
                        {ev?.title} (¥{ev?.amount.toLocaleString()})
                      </option>
                    );
                  })}
              </select>
            </div>
            <p className="text-[10px] text-slate-400">※立替額が請求額を超える場合、差額はデポジットに自動プールされます。</p>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowOffsetModal(false)} className="flex-1 py-2 text-xs border rounded-lg">
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleExecuteOffset}
                disabled={isSubmitting}
                className="flex-1 py-2 text-xs bg-amber-500 text-white font-bold rounded-lg"
              >
                {isSubmitting ? '処理中...' : '相殺を実行'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* モーダル: 差戻し入力 */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-5 w-full max-w-xs space-y-4">
            <h3 className="font-bold text-base text-slate-800">立替の差戻し</h3>
            <p className="text-xs text-slate-500">部員に修正してもらう理由を入力してください。</p>
            <div>
              <textarea
                placeholder="例: レシートの品目と金額が一致していません。私用のお菓子代を引いて再申請してください。"
                value={rejectReasonText}
                onChange={(e) => setRejectReasonText(e.target.value)}
                rows={3}
                className="w-full p-2 border border-slate-200 rounded-lg text-xs"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowRejectModal(false)} className="flex-1 py-2 text-xs border rounded-lg">
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleExecuteReject}
                disabled={isSubmitting}
                className="flex-1 py-2 text-xs bg-rose-600 text-white font-bold rounded-lg"
              >
                {isSubmitting ? '処理中...' : '差戻す'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

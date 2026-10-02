'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Member, Payment, Expense, BillingEvent, ClubTransaction } from '@/types';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'personal' | 'club' | 'members'>('personal');
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [clubTransactions, setClubTransactions] = useState<ClubTransaction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // フィルター
  const [paymentFilter, setPaymentFilter] = useState<'unpaid' | 'paid' | 'all'>('unpaid');
  const [expenseFilter, setExpenseFilter] = useState<'unsettled' | 'settled' | 'all'>('unsettled');

  // モーダル
  const [showEventModal, setShowEventModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showClubTxModal, setShowClubTxModal] = useState(false);
  const [showOffsetModal, setShowOffsetModal] = useState(false);
  const [selectedMemberDetail, setSelectedMemberDetail] = useState<Member | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // 納入ステータス変更
  const [confirmPaymentTarget, setConfirmPaymentTarget] = useState<Payment | null>(null);
  const [confirmPaymentMethod, setConfirmPaymentMethod] = useState<'現金' | '振込'>('振込');

  // フォーム: 請求作成
  const [eventTitle, setEventTitle] = useState('');
  const [eventAmount, setEventAmount] = useState('');
  const [eventDueDate, setEventDueDate] = useState('');
  const [targetMemberIds, setTargetMemberIds] = useState<string[]>([]);

  // フォーム: 立替申請
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('ガソリン代');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // フォーム: 部費出納
  const [txType, setTxType] = useState<'支出' | '収入'>('支出');
  const [txTitle, setTxTitle] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState('艇体・セール・艤装費');
  const [txSource, setTxSource] = useState<'部口座振込' | '部室現金'>('部口座振込');
  const [txEventTag, setTxEventTag] = useState('');

  // フォーム: 相殺
  const [selectedExpenseForOffset, setSelectedExpenseForOffset] = useState<Expense | null>(null);
  const [targetPaymentIdForOffset, setTargetPaymentIdForOffset] = useState<string>('');

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
    const { data: eData } = await supabase.from('expenses').select('*').order('created_at', { ascending: false });
    const { data: bData } = await supabase.from('billing_events').select('*').order('created_at', { ascending: false });
    const { data: cData } = await supabase.from('club_transactions').select('*').order('created_at', { ascending: false });

    if (mData) {
      setMembers(mData);
      if (targetMemberIds.length === 0) setTargetMemberIds(mData.map((m) => m.id));
    }
    if (pData) setPayments(pData);
    if (eData) setExpenses(eData);
    if (bData) setEvents(bData);
    if (cData) setClubTransactions(cData);
    setLoading(false);
  };

  const handleMemberChange = (id: string) => {
    setSelectedMemberId(id);
    localStorage.setItem('selectedMemberId', id);
  };

  const currentMember = members.find((m) => m.id === selectedMemberId);

  // 金額計算
  const getUnpaidTotal = (memberId: string) => {
    return payments
      .filter((p) => p.member_id === memberId && p.status !== '支払済')
      .reduce((sum, p) => {
        const ev = events.find((e) => e.id === p.billing_event_id);
        const total = ev?.amount || 0;
        const paid = p.paid_amount || 0;
        return sum + Math.max(0, total - paid);
      }, 0);
  };

  const getUnreimbursedTotal = (memberId: string) => {
    return expenses
      .filter((e) => e.member_id === memberId && e.status === '未精算')
      .reduce((sum, e) => sum + e.amount, 0);
  };

  const totalCollectedDues = payments
    .filter((p) => p.payment_method !== '相殺')
    .reduce((sum, p) => sum + (p.paid_amount || 0), 0);

  const totalClubDonations = clubTransactions
    .filter((t) => t.type === '収入')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalDirectClubExpenses = clubTransactions
    .filter((t) => t.type === '支出')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalReimbursedExpenses = expenses
    .filter((e) => e.status === '精算済' && !e.offset_payment_id)
    .reduce((sum, e) => sum + e.amount, 0);

  const estimatedClubTreasury =
    totalCollectedDues + totalClubDonations - totalDirectClubExpenses - totalReimbursedExpenses;

  const categorySpendingMap: { [cat: string]: number } = {};
  clubTransactions
    .filter((t) => t.type === '支出')
    .forEach((t) => {
      categorySpendingMap[t.category] = (categorySpendingMap[t.category] || 0) + t.amount;
    });
  expenses
    .filter((e) => e.status === '精算済')
    .forEach((e) => {
      categorySpendingMap[e.category] = (categorySpendingMap[e.category] || 0) + e.amount;
    });

  const totalAllExpenses = Object.values(categorySpendingMap).reduce((a, b) => a + b, 0);

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
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('圧縮失敗'))), 'image/jpeg', 0.7);
      };
      img.onerror = (err) => reject(err);
    });
  };

  // 1. 請求作成
  const handleCreateBillingEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventTitle || !eventAmount || targetMemberIds.length === 0) {
      alert('請求名、金額、対象部員を入力してください');
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
      alert('作成に失敗しました');
      setIsSubmitting(false);
      return;
    }

    const paymentRecords = targetMemberIds.map((mId) => ({
      billing_event_id: eventData.id,
      member_id: mId,
      status: '未納',
      paid_amount: 0,
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
      alert('部員を選択してください');
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
        console.error('画像保存エラー:', err);
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

  // 3. 部費出納登録
  const handleCreateClubTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!txTitle || !txAmount) return;
    setIsSubmitting(true);

    await supabase.from('club_transactions').insert({
      type: txType,
      title: txTitle,
      amount: parseInt(txAmount, 10),
      category: txCategory,
      payment_source: txSource,
      event_tag: txEventTag || null,
    });

    setTxTitle('');
    setTxAmount('');
    setTxEventTag('');
    setShowClubTxModal(false);
    setIsSubmitting(false);
    fetchData();
  };

  // 4. 請求ステータス変更（双方向連動対応）
  const executePaymentStatusChange = async () => {
    if (!confirmPaymentTarget) return;
    setIsSubmitting(true);

    const ev = events.find((e) => e.id === confirmPaymentTarget.billing_event_id);
    const totalAmount = ev?.amount || 0;
    const isClearing = confirmPaymentTarget.status !== '支払済';

    if (isClearing) {
      await supabase
        .from('payments')
        .update({
          status: '支払済',
          paid_amount: totalAmount,
          payment_method: confirmPaymentMethod,
        })
        .eq('id', confirmPaymentTarget.id);
    } else {
      // 未納へ戻す場合: 相殺立替を未精算へ復元
      const linkedExpense = expenses.find(
        (e) => e.offset_payment_id === confirmPaymentTarget.id || e.id === confirmPaymentTarget.offset_expense_id
      );

      if (linkedExpense) {
        await supabase
          .from('expenses')
          .update({
            status: '未精算',
            offset_payment_id: null,
            reject_reason: '',
          })
          .eq('id', linkedExpense.id);
      }

      await supabase
        .from('payments')
        .update({
          status: '未納',
          paid_amount: 0,
          payment_method: '現金/振込',
          offset_expense_id: null,
        })
        .eq('id', confirmPaymentTarget.id);
    }

    setConfirmPaymentTarget(null);
    setIsSubmitting(false);
    fetchData();
  };

  // 5. 相殺実行（双方向キーを相互保持）
  const handleExecuteOffset = async () => {
    if (!selectedExpenseForOffset || !targetPaymentIdForOffset) return;
    setIsSubmitting(true);

    const targetPayment = payments.find((p) => p.id === targetPaymentIdForOffset);
    const targetEvent = events.find((e) => e.id === targetPayment?.billing_event_id);
    if (!targetPayment || !targetEvent) {
      setIsSubmitting(false);
      return;
    }

    const currentPaid = targetPayment.paid_amount || 0;
    const remainingToPay = targetEvent.amount - currentPaid;
    const expenseAmountVal = selectedExpenseForOffset.amount;
    const expenseItemName = selectedExpenseForOffset.title;

    if (expenseAmountVal >= remainingToPay) {
      // 請求完済
      await supabase
        .from('payments')
        .update({
          status: '支払済',
          paid_amount: targetEvent.amount,
          payment_method: '相殺',
          offset_expense_id: selectedExpenseForOffset.id,
        })
        .eq('id', targetPayment.id);

      await supabase
        .from('expenses')
        .update({
          status: '精算済',
          offset_payment_id: targetPayment.id,
          reject_reason: `相殺: ${targetEvent.title}`,
        })
        .eq('id', selectedExpenseForOffset.id);

      const diff = expenseAmountVal - remainingToPay;
      if (diff > 0) {
        await supabase.from('expenses').insert({
          member_id: selectedExpenseForOffset.member_id,
          title: `${expenseItemName} (残額)`,
          amount: diff,
          category: selectedExpenseForOffset.category,
          receipt_url: selectedExpenseForOffset.receipt_url || '',
          status: '未精算',
          reject_reason: `元申請 ¥${expenseAmountVal.toLocaleString()}`,
        });
      }
      alert('相殺しました');
    } else {
      // 一部納入
      const newPaidAmount = currentPaid + expenseAmountVal;
      await supabase
        .from('payments')
        .update({
          status: '一部納入',
          paid_amount: newPaidAmount,
          payment_method: `相殺 (${expenseItemName})`,
          offset_expense_id: selectedExpenseForOffset.id,
        })
        .eq('id', targetPayment.id);

      await supabase
        .from('expenses')
        .update({
          status: '精算済',
          offset_payment_id: targetPayment.id,
          reject_reason: `一部相殺: ${targetEvent.title}`,
        })
        .eq('id', selectedExpenseForOffset.id);

      alert(`相殺しました（残額: ¥${(targetEvent.amount - newPaidAmount).toLocaleString()}）`);
    }

    setShowOffsetModal(false);
    setSelectedExpenseForOffset(null);
    setTargetPaymentIdForOffset('');
    setIsSubmitting(false);
    fetchData();
  };

  // 6. 現金精算
  const handleCashSettle = async (expense: Expense) => {
    if (!confirm(`「${expense.title}」を現金精算済にしますか？`)) return;
    await supabase
      .from('expenses')
      .update({
        status: '精算済',
        reject_reason: '現金精算',
      })
      .eq('id', expense.id);
    fetchData();
  };

  // 7. 立替削除
  const handleDeleteExpense = async (expense: Expense) => {
    if (!confirm(`「${expense.title}」を削除しますか？`)) return;
    await supabase.from('expenses').delete().eq('id', expense.id);
    fetchData();
  };

  // 8. 立替取消（双方向巻き戻し）
  const handleRevertExpense = async (expense: Expense) => {
    if (!confirm(`「${expense.title}」を未精算に戻しますか？\n（相殺されていた請求も連動して未納に戻ります）`)) {
      return;
    }

    // 紐づく請求を探す
    const linkedPayment = payments.find(
      (p) => p.id === expense.offset_payment_id || p.offset_expense_id === expense.id
    );

    if (linkedPayment) {
      const ev = events.find((e) => e.id === linkedPayment.billing_event_id);
      const total = ev?.amount || 0;
      const revertedPaid = Math.max(0, (linkedPayment.paid_amount || 0) - expense.amount);
      const nextStatus = revertedPaid === 0 ? '未納' : revertedPaid >= total ? '支払済' : '一部納入';

      await supabase
        .from('payments')
        .update({
          status: nextStatus,
          paid_amount: revertedPaid,
          payment_method: nextStatus === '未納' ? '現金/振込' : linkedPayment.payment_method,
          offset_expense_id: nextStatus === '未納' ? null : linkedPayment.offset_expense_id,
        })
        .eq('id', linkedPayment.id);
    }

    await supabase
      .from('expenses')
      .update({
        status: '未精算',
        reject_reason: '',
        offset_payment_id: null,
      })
      .eq('id', expense.id);

    fetchData();
  };

  // CSVダウンロード
  const exportToCSV = () => {
    const header = ['分類', '項目', '対象者/出納元', '品名・使途', '金額', '既納額', '残額', '状態', '日付'];
    const rows: string[][] = [];

    payments.forEach((p) => {
      const ev = events.find((e) => e.id === p.billing_event_id);
      const mem = members.find((m) => m.id === p.member_id);
      const total = ev?.amount || 0;
      const paid = p.paid_amount || 0;
      rows.push([
        '請求',
        '部費',
        mem?.name || '',
        ev?.title || '',
        String(total),
        String(paid),
        String(Math.max(0, total - paid)),
        `${p.status} (${p.payment_method || ''})`,
        ev?.due_date || '',
      ]);
    });

    clubTransactions.forEach((t) => {
      rows.push([
        '出納',
        t.category,
        t.payment_source,
        t.title,
        String(t.amount),
        '-',
        '-',
        t.type,
        t.created_at?.split('T')[0] || '',
      ]);
    });

    expenses.forEach((e) => {
      const mem = members.find((m) => m.id === e.member_id);
      rows.push([
        '立替',
        e.category,
        mem?.name || '',
        e.title,
        String(e.amount),
        '-',
        '-',
        `${e.status} ${e.reject_reason || ''}`,
        e.created_at?.split('T')[0] || '',
      ]);
    });

    rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [header.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');

    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `会計明細_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 pb-28">
      {/* ヘッダー */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3">
        <div className="w-full flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex justify-between items-center">
            <h1 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>⛵</span> ヨット部 会計
            </h1>
            <button
              onClick={exportToCSV}
              className="text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-slate-700 font-bold transition"
            >
              CSV出力
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium shrink-0">部員:</span>
            <select
              value={selectedMemberId}
              onChange={(e) => handleMemberChange(e.target.value)}
              className="w-full md:w-64 p-2 border border-slate-300 rounded-xl bg-white text-xs font-bold text-slate-800 shadow-sm"
            >
              <option value="">-- 全体 --</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.grade}年 {m.name} ({m.role})
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* メイン */}
      <main className="w-full px-4 py-4 max-w-7xl mx-auto space-y-4">
        {loading ? (
          <p className="text-xs text-slate-400 text-center py-20 font-medium">読み込み中...</p>
        ) : (
          <>
            {/* TAB 1: マイページ / 個人 */}
            {activeTab === 'personal' && (
              <div className="space-y-4">
                {currentMember ? (
                  <div className="grid grid-cols-2 gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="bg-red-50 p-3 rounded-xl border border-red-100">
                      <span className="text-xs text-red-600 font-bold block">未納部費</span>
                      <span className="text-lg font-black text-red-700 tabular-nums">
                        ¥{getUnpaidTotal(currentMember.id).toLocaleString()}
                      </span>
                    </div>
                    <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                      <span className="text-xs text-blue-600 font-bold block">未精算立替</span>
                      <span className="text-lg font-black text-blue-700 tabular-nums">
                        ¥{getUnreimbursedTotal(currentMember.id).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 text-center">
                    部員を選択すると個人の申請や残高を確認できます
                  </div>
                )}

                {/* ボタン */}
                <div className="grid grid-cols-2 gap-3">
                  {currentMember ? (
                    <button
                      onClick={() => setShowExpenseModal(true)}
                      className="p-3.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-2xl font-bold text-xs shadow-md transition"
                    >
                      立替を申請
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowClubTxModal(true)}
                      className="p-3.5 bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white rounded-2xl font-bold text-xs shadow-md transition"
                    >
                      部費の出納を記録
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setTargetMemberIds(members.map((m) => m.id));
                      setShowEventModal(true);
                    }}
                    className="p-3.5 bg-slate-900 hover:bg-black active:scale-[0.98] text-white rounded-2xl font-bold text-xs shadow-md transition"
                  >
                    請求を作成
                  </button>
                </div>

                {/* 一覧 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* 請求一覧 */}
                  <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                    <div className="flex justify-between items-center">
                      <h2 className="font-black text-xs text-slate-500 uppercase">
                        {currentMember ? `${currentMember.name}の請求` : '請求状況'}
                      </h2>
                      {/* 請求フィルター */}
                      <div className="flex bg-slate-100 p-0.5 rounded-lg text-[10px] font-bold">
                        <button
                          onClick={() => setPaymentFilter('unpaid')}
                          className={`px-2 py-1 rounded-md transition ${paymentFilter === 'unpaid' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                        >
                          未納
                        </button>
                        <button
                          onClick={() => setPaymentFilter('paid')}
                          className={`px-2 py-1 rounded-md transition ${paymentFilter === 'paid' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                        >
                          支払済
                        </button>
                        <button
                          onClick={() => setPaymentFilter('all')}
                          className={`px-2 py-1 rounded-md transition ${paymentFilter === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                        >
                          すべて
                        </button>
                      </div>
                    </div>

                    {payments
                      .filter((p) => !currentMember || p.member_id === currentMember.id)
                      .filter((p) => {
                        if (paymentFilter === 'unpaid') return p.status !== '支払済';
                        if (paymentFilter === 'paid') return p.status === '支払済';
                        return true;
                      })
                      .length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-6">該当データはありません</p>
                    ) : (
                      payments
                        .filter((p) => !currentMember || p.member_id === currentMember.id)
                        .filter((p) => {
                          if (paymentFilter === 'unpaid') return p.status !== '支払済';
                          if (paymentFilter === 'paid') return p.status === '支払済';
                          return true;
                        })
                        .map((p) => {
                          const ev = events.find((e) => e.id === p.billing_event_id);
                          const member = members.find((m) => m.id === p.member_id);
                          const evAmount = ev?.amount || 0;
                          const paidAmount = p.paid_amount || 0;
                          const remainingAmount = Math.max(0, evAmount - paidAmount);

                          return (
                            <div
                              key={p.id}
                              className="p-3 border border-slate-100 rounded-xl bg-slate-50 flex justify-between items-center"
                            >
                              <div className="space-y-0.5">
                                <p className="font-bold text-xs text-slate-800">{ev?.title}</p>
                                <p className="text-[11px] text-slate-500">
                                  {member?.name} | ¥{evAmount.toLocaleString()}
                                </p>
                                {p.status === '一部納入' && (
                                  <p className="text-[10px] text-amber-700 font-bold">
                                    残: ¥{remainingAmount.toLocaleString()} (納入済: ¥{paidAmount.toLocaleString()})
                                  </p>
                                )}
                                {p.payment_method && p.status !== '未納' && (
                                  <span className="inline-block mt-0.5 text-[9px] bg-white border border-slate-200 text-slate-600 px-1.5 py-0.2 rounded font-medium">
                                    {p.payment_method}
                                  </span>
                                )}
                              </div>

                              <button
                                onClick={() => setConfirmPaymentTarget(p)}
                                className={`text-xs px-3 py-1.5 rounded-lg font-bold transition shadow-sm ${
                                  p.status === '支払済'
                                    ? 'bg-green-100 text-green-700 border border-green-300'
                                    : p.status === '一部納入'
                                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                    : 'bg-red-50 text-red-600 border border-red-200'
                                }`}
                              >
                                {p.status === '一部納入' ? `残 ¥${remainingAmount.toLocaleString()}` : p.status}
                              </button>
                            </div>
                          );
                        })
                    )}
                  </section>

                  {/* 立替一覧 */}
                  <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                    <div className="flex justify-between items-center">
                      <h2 className="font-black text-xs text-slate-500 uppercase">
                        {currentMember ? `${currentMember.name}の立替` : '立替一覧'}
                      </h2>
                      {/* 立替フィルター */}
                      <div className="flex bg-slate-100 p-0.5 rounded-lg text-[10px] font-bold">
                        <button
                          onClick={() => setExpenseFilter('unsettled')}
                          className={`px-2 py-1 rounded-md transition ${expenseFilter === 'unsettled' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                        >
                          未精算
                        </button>
                        <button
                          onClick={() => setExpenseFilter('settled')}
                          className={`px-2 py-1 rounded-md transition ${expenseFilter === 'settled' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                        >
                          精算済
                        </button>
                        <button
                          onClick={() => setExpenseFilter('all')}
                          className={`px-2 py-1 rounded-md transition ${expenseFilter === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                        >
                          すべて
                        </button>
                      </div>
                    </div>

                    {expenses
                      .filter((e) => !currentMember || e.member_id === currentMember.id)
                      .filter((e) => {
                        if (expenseFilter === 'unsettled') return e.status === '未精算';
                        if (expenseFilter === 'settled') return e.status === '精算済';
                        return true;
                      })
                      .length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-6">該当データはありません</p>
                    ) : (
                      expenses
                        .filter((e) => !currentMember || e.member_id === currentMember.id)
                        .filter((e) => {
                          if (expenseFilter === 'unsettled') return e.status === '未精算';
                          if (expenseFilter === 'settled') return e.status === '精算済';
                          return true;
                        })
                        .map((e) => {
                          const member = members.find((m) => m.id === e.member_id);
                          const memberUnpaid = payments.filter((p) => p.member_id === e.member_id && p.status !== '支払済');
                          const canOffset = memberUnpaid.length > 0;

                          return (
                            <div key={e.id} className="p-3 border border-slate-100 rounded-xl bg-slate-50 space-y-2.5">
                              <div className="flex gap-3 items-center">
                                {e.receipt_url ? (
                                  <div
                                    onClick={() => setPreviewImageUrl(e.receipt_url || null)}
                                    className="w-14 h-14 rounded-lg bg-slate-200 shrink-0 overflow-hidden border border-slate-200 cursor-pointer"
                                  >
                                    <img
                                      src={e.receipt_url}
                                      alt="レシート"
                                      className="w-full h-full object-cover"
                                    />
                                  </div>
                                ) : (
                                  <div className="w-14 h-14 rounded-lg bg-slate-100 shrink-0 border border-slate-200 flex items-center justify-center text-slate-400 text-xs">
                                    無
                                  </div>
                                )}

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-bold">
                                      {e.category}
                                    </span>
                                    <span className="text-[11px] text-slate-500">{member?.name}</span>
                                  </div>
                                  <p className="font-bold text-xs text-slate-800 truncate mt-0.5">{e.title}</p>
                                  <p className="text-sm font-black text-slate-900 tabular-nums">
                                    ¥{e.amount.toLocaleString()}
                                  </p>
                                </div>

                                <div className="shrink-0 text-right">
                                  <span
                                    className={`text-[10px] px-2 py-1 rounded-md font-black ${
                                      e.status === '精算済'
                                        ? 'bg-slate-200 text-slate-600'
                                        : 'bg-amber-100 text-amber-800 border border-amber-200'
                                    }`}
                                  >
                                    {e.status}
                                  </span>
                                </div>
                              </div>

                              {e.reject_reason && (
                                <div className="p-2 rounded-lg text-[10px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                                  {e.reject_reason}
                                </div>
                              )}

                              {e.status === '未精算' && (
                                <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-200">
                                  <button
                                    onClick={() => {
                                      if (!canOffset) return;
                                      setSelectedExpenseForOffset(e);
                                      setTargetPaymentIdForOffset(memberUnpaid[0].id);
                                      setShowOffsetModal(true);
                                    }}
                                    disabled={!canOffset}
                                    className={`py-1.5 text-[11px] font-bold rounded-lg transition ${
                                      canOffset
                                        ? 'bg-amber-500 hover:bg-amber-600 text-white'
                                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                    }`}
                                  >
                                    相殺
                                  </button>

                                  <button
                                    onClick={() => handleCashSettle(e)}
                                    className="py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-bold rounded-lg transition"
                                  >
                                    現金精算
                                  </button>

                                  <button
                                    onClick={() => handleDeleteExpense(e)}
                                    className="py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-[11px] font-bold rounded-lg transition"
                                  >
                                    削除
                                  </button>
                                </div>
                              )}

                              {e.status === '精算済' && (
                                <div className="flex justify-end pt-1">
                                  <button
                                    onClick={() => handleRevertExpense(e)}
                                    className="text-[10px] text-slate-400 hover:text-slate-600 font-medium underline"
                                  >
                                    未精算に戻す
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })
                    )}
                  </section>
                </div>
              </div>
            )}

            {/* TAB 2: 全体会計 */}
            {activeTab === 'club' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2 bg-slate-900 text-white p-5 rounded-3xl shadow-lg space-y-3">
                    <span className="text-xs text-slate-400">部の資金残高</span>
                    <div className="text-3xl sm:text-4xl font-black tabular-nums">
                      ¥{estimatedClubTreasury.toLocaleString()}
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-800 text-xs">
                      <div>
                        <span className="text-slate-400 text-[10px] block">総入金</span>
                        <span className="font-bold text-emerald-400 tabular-nums">
                          +¥{(totalCollectedDues + totalClubDonations).toLocaleString()}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] block">総支出</span>
                        <span className="font-bold text-rose-400 tabular-nums">
                          -¥{(totalDirectClubExpenses + totalReimbursedExpenses).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-center">
                    <p className="text-xs text-slate-500 font-medium">部費出納</p>
                    <p className="text-[11px] text-slate-400 mt-1 mb-3">エントリー費・係留料・寄付など</p>
                    <button
                      onClick={() => setShowClubTxModal(true)}
                      className="w-full p-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold text-xs transition"
                    >
                      出納を記録
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* カテゴリ別 */}
                  <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                    <div className="flex justify-between items-center">
                      <h2 className="font-black text-xs text-slate-500 uppercase">支出カテゴリ別</h2>
                      <span className="text-xs font-bold text-slate-700 tabular-nums">
                        計: ¥{totalAllExpenses.toLocaleString()}
                      </span>
                    </div>
                    {totalAllExpenses === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-6">データはありません</p>
                    ) : (
                      <div className="space-y-3">
                        {Object.entries(categorySpendingMap).map(([cat, amt]) => {
                          const percent = Math.round((amt / totalAllExpenses) * 100);
                          return (
                            <div key={cat} className="space-y-1">
                              <div className="flex justify-between text-xs font-semibold">
                                <span className="text-slate-700">{cat}</span>
                                <span className="text-slate-900 tabular-nums">
                                  ¥{amt.toLocaleString()} ({percent}%)
                                </span>
                              </div>
                              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${percent}%` }}></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {/* 明細 */}
                  <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                    <h2 className="font-black text-xs text-slate-500 uppercase">支出明細</h2>
                    <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                      {clubTransactions
                        .filter((t) => t.type === '支出')
                        .map((t) => (
                          <div key={t.id} className="p-3 border border-slate-100 rounded-xl bg-slate-50 flex justify-between items-center">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-bold">
                                  部費出納
                                </span>
                                <span className="text-xs font-bold text-slate-800">{t.title}</span>
                              </div>
                              <p className="text-[10px] text-slate-500 mt-1">
                                {t.category} | {t.payment_source}
                              </p>
                            </div>
                            <span className="text-xs font-black tabular-nums text-slate-800">
                              -¥{t.amount.toLocaleString()}
                            </span>
                          </div>
                        ))}

                      {expenses
                        .filter((e) => e.status === '精算済')
                        .map((e) => {
                          const mem = members.find((m) => m.id === e.member_id);
                          return (
                            <div key={e.id} className="p-3 border border-slate-100 rounded-xl bg-slate-50 flex justify-between items-center">
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[9px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-bold">
                                    立替精算
                                  </span>
                                  <span className="text-xs font-bold text-slate-800">{e.title}</span>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-1">
                                  {e.category} | {mem?.name}
                                </p>
                              </div>
                              <span className="text-xs font-black tabular-nums text-slate-800">
                                -¥{e.amount.toLocaleString()}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </section>
                </div>
              </div>
            )}

            {/* TAB 3: 部員カルテ */}
            {activeTab === 'members' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">部員を選択すると個別の履歴を確認できます</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {members.map((m) => {
                    const unpaid = getUnpaidTotal(m.id);
                    const unreimbursed = getUnreimbursedTotal(m.id);
                    const canOffset = unpaid > 0 && unreimbursed > 0;

                    return (
                      <div
                        key={m.id}
                        onClick={() => setSelectedMemberDetail(m)}
                        className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm hover:border-blue-400 transition cursor-pointer flex flex-col justify-between space-y-3"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-bold text-sm text-slate-900">
                              {m.grade}年 {m.name}
                            </span>
                            <span className="ml-2 text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                              {m.role}
                            </span>
                          </div>
                          {canOffset && (
                            <span className="text-[9px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-black border border-amber-200">
                              相殺可
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-center">
                          <div className="bg-slate-50 p-2 rounded-xl">
                            <span className="text-[10px] text-slate-400 block font-medium">未納部費</span>
                            <span
                              className={`text-xs font-bold tabular-nums ${
                                unpaid > 0 ? 'text-red-600' : 'text-slate-400'
                              }`}
                            >
                              ¥{unpaid.toLocaleString()}
                            </span>
                          </div>
                          <div className="bg-slate-50 p-2 rounded-xl">
                            <span className="text-[10px] text-slate-400 block font-medium">未精算立替</span>
                            <span
                              className={`text-xs font-bold tabular-nums ${
                                unreimbursed > 0 ? 'text-blue-600' : 'text-slate-400'
                              }`}
                            >
                              ¥{unreimbursed.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ボトムナビ */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 shadow-2xl">
        <div className="max-w-md mx-auto grid grid-cols-3 h-16">
          <button
            onClick={() => setActiveTab('personal')}
            className={`flex flex-col items-center justify-center gap-1 transition ${
              activeTab === 'personal' ? 'text-blue-600 font-black' : 'text-slate-400 font-medium'
            }`}
          >
            <span className="text-xl">👤</span>
            <span className="text-[11px]">マイページ</span>
          </button>
          <button
            onClick={() => setActiveTab('club')}
            className={`flex flex-col items-center justify-center gap-1 transition ${
              activeTab === 'club' ? 'text-blue-600 font-black' : 'text-slate-400 font-medium'
            }`}
          >
            <span className="text-xl">📊</span>
            <span className="text-[11px]">全体会計</span>
          </button>
          <button
            onClick={() => setActiveTab('members')}
            className={`flex flex-col items-center justify-center gap-1 transition ${
              activeTab === 'members' ? 'text-blue-600 font-black' : 'text-slate-400 font-medium'
            }`}
          >
            <span className="text-xl">👥</span>
            <span className="text-[11px]">部員一覧</span>
          </button>
        </div>
      </nav>

      {/* モーダル: 納入確認 */}
      {confirmPaymentTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-xs space-y-4 shadow-2xl">
            <h3 className="font-black text-base text-slate-900">納入状況の変更</h3>
            {(() => {
              const ev = events.find((e) => e.id === confirmPaymentTarget.billing_event_id);
              const mem = members.find((m) => m.id === confirmPaymentTarget.member_id);
              const totalAmount = ev?.amount || 0;
              const paidAmount = confirmPaymentTarget.paid_amount || 0;
              const remainingAmount = Math.max(0, totalAmount - paidAmount);
              const isClearing = confirmPaymentTarget.status !== '支払済';

              return (
                <div className="space-y-3">
                  <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
                    <p className="font-bold text-slate-800">{ev?.title}</p>
                    <p className="text-slate-600">対象: {mem?.name}</p>
                    <p className="text-slate-600 font-bold">請求額: ¥{totalAmount.toLocaleString()}</p>
                    {confirmPaymentTarget.status === '一部納入' && (
                      <p className="text-amber-700 font-bold">残額: ¥{remainingAmount.toLocaleString()}</p>
                    )}
                  </div>

                  {isClearing && (
                    <div>
                      <label className="text-xs text-slate-600 font-medium">納入方法</label>
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <button
                          type="button"
                          onClick={() => setConfirmPaymentMethod('振込')}
                          className={`py-1.5 text-xs font-bold rounded-lg border ${
                            confirmPaymentMethod === '振込'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-slate-700 border-slate-200'
                          }`}
                        >
                          口座振込
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmPaymentMethod('現金')}
                          className={`py-1.5 text-xs font-bold rounded-lg border ${
                            confirmPaymentMethod === '現金'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-slate-700 border-slate-200'
                          }`}
                        >
                          現金
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setConfirmPaymentTarget(null)}
                      className="flex-1 py-2 text-xs border border-slate-200 rounded-xl"
                    >
                      戻る
                    </button>
                    <button
                      type="button"
                      onClick={executePaymentStatusChange}
                      disabled={isSubmitting}
                      className="flex-1 py-2 text-xs bg-slate-900 text-white font-bold rounded-xl shadow-md"
                    >
                      {isClearing ? '支払済にする' : '未納に戻す'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* モーダル: レシート画像 */}
      {previewImageUrl && (
        <div
          onClick={() => setPreviewImageUrl(null)}
          className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 cursor-pointer"
        >
          <img src={previewImageUrl} alt="レシート" className="max-h-[80vh] w-auto rounded-xl object-contain" />
        </div>
      )}

      {/* モーダル: 部員カルテ */}
      {selectedMemberDetail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4 max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-start border-b pb-3">
              <h3 className="font-black text-base text-slate-800">
                {selectedMemberDetail.grade}年 {selectedMemberDetail.name} ({selectedMemberDetail.role})
              </h3>
              <button onClick={() => setSelectedMemberDetail(null)} className="text-slate-400 hover:text-slate-600 font-bold text-lg">
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-600">納入履歴</h4>
              {payments.filter((p) => p.member_id === selectedMemberDetail.id).length === 0 ? (
                <p className="text-[11px] text-slate-400">データはありません</p>
              ) : (
                payments
                  .filter((p) => p.member_id === selectedMemberDetail.id)
                  .map((p) => {
                    const ev = events.find((e) => e.id === p.billing_event_id);
                    return (
                      <div key={p.id} className="p-2.5 bg-slate-50 rounded-xl text-xs flex justify-between items-center">
                        <div>
                          <p className="font-semibold text-slate-800">{ev?.title}</p>
                          <p className="text-[10px] text-slate-500">
                            {ev?.due_date} | {p.payment_method}
                          </p>
                        </div>
                        <span className={`font-bold ${p.status === '支払済' ? 'text-green-600' : p.status === '一部納入' ? 'text-amber-600' : 'text-red-500'}`}>
                          {p.status}
                        </span>
                      </div>
                    );
                  })
              )}

              <h4 className="text-xs font-bold text-slate-600 pt-2">立替履歴</h4>
              {expenses.filter((e) => e.member_id === selectedMemberDetail.id).length === 0 ? (
                <p className="text-[11px] text-slate-400">データはありません</p>
              ) : (
                expenses
                  .filter((e) => e.member_id === selectedMemberDetail.id)
                  .map((e) => (
                    <div key={e.id} className="p-2.5 bg-slate-50 rounded-xl text-xs flex justify-between items-center">
                      <div>
                        <p className="font-semibold text-slate-800">
                          {e.title} (¥{e.amount.toLocaleString()})
                        </p>
                        <p className="text-[10px] text-slate-500">{e.category}</p>
                      </div>
                      <span className="font-bold text-slate-600">{e.status}</span>
                    </div>
                  ))
              )}
            </div>

            <button
              onClick={() => setSelectedMemberDetail(null)}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* モーダル: 請求作成 */}
      {showEventModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl">
            <h3 className="font-black text-base text-slate-800">新規請求の作成</h3>
            <form onSubmit={handleCreateBillingEvent} className="space-y-3">
              <div>
                <label className="text-xs text-slate-600 font-medium">請求タイトル</label>
                <input
                  type="text"
                  placeholder="例: 10月度部費"
                  required
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  className="w-full mt-1 p-2.5 border border-slate-200 rounded-xl text-xs"
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
                  className="w-full mt-1 p-2.5 border border-slate-200 rounded-xl text-xs"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 font-medium">支払期日</label>
                <input
                  type="date"
                  value={eventDueDate}
                  onChange={(e) => setEventDueDate(e.target.value)}
                  className="w-full mt-1 p-2.5 border border-slate-200 rounded-xl text-xs"
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs text-slate-600 font-medium">対象部員 ({targetMemberIds.length}名)</label>
                  <button
                    type="button"
                    onClick={() => {
                      if (targetMemberIds.length === members.length) setTargetMemberIds([]);
                      else setTargetMemberIds(members.map((m) => m.id));
                    }}
                    className="text-[10px] text-blue-600 underline font-bold"
                  >
                    全選択/解除
                  </button>
                </div>
                <div className="max-h-32 overflow-y-auto border border-slate-100 rounded-xl p-2 space-y-1 bg-slate-50">
                  {members.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer p-0.5">
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
                <button type="button" onClick={() => setShowEventModal(false)} className="flex-1 py-2.5 text-xs border rounded-xl">
                  戻る
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 text-xs bg-slate-900 text-white font-bold rounded-xl shadow-md">
                  作成
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* モーダル: 立替申請 */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4 shadow-2xl">
            <h3 className="font-black text-base text-slate-800">立替金の申請</h3>
            <form onSubmit={handleCreateExpense} className="space-y-3">
              <div>
                <label className="text-xs text-slate-600 font-medium">用途・品名</label>
                <input
                  type="text"
                  placeholder="例: ガソリン代"
                  required
                  value={expenseTitle}
                  onChange={(e) => setExpenseTitle(e.target.value)}
                  className="w-full mt-1 p-2.5 border border-slate-200 rounded-xl text-xs"
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
                  className="w-full mt-1 p-2.5 border border-slate-200 rounded-xl text-xs"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 font-medium">カテゴリ</label>
                <select
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value)}
                  className="w-full mt-1 p-2.5 border border-slate-200 rounded-xl text-xs"
                >
                  <option value="ガソリン代">ガソリン代</option>
                  <option value="艇体・修繕費">艇体・修繕費</option>
                  <option value="消耗品">消耗品</option>
                  <option value="合宿・遠征費">合宿・遠征費</option>
                  <option value="その他">その他</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-600 font-medium">レシート写真</label>
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                  className="w-full mt-1 text-xs text-slate-500"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowExpenseModal(false)} className="flex-1 py-2.5 text-xs border rounded-xl">
                  戻る
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 text-xs bg-blue-600 text-white font-bold rounded-xl shadow-md">
                  申請
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* モーダル: 部費出納 */}
      {showClubTxModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4 shadow-2xl">
            <h3 className="font-black text-base text-slate-800">部費出納の記録</h3>
            <form onSubmit={handleCreateClubTransaction} className="space-y-3">
              <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setTxType('支出')}
                  className={`py-1.5 rounded-lg ${txType === '支出' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-600'}`}
                >
                  支出
                </button>
                <button
                  type="button"
                  onClick={() => setTxType('収入')}
                  className={`py-1.5 rounded-lg ${txType === '収入' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-600'}`}
                >
                  収入
                </button>
              </div>

              <div>
                <label className="text-xs text-slate-600 font-medium">品名・内容</label>
                <input
                  type="text"
                  placeholder="例: インカレ参加料"
                  required
                  value={txTitle}
                  onChange={(e) => setTxTitle(e.target.value)}
                  className="w-full mt-1 p-2.5 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="text-xs text-slate-600 font-medium">金額</label>
                <input
                  type="number"
                  placeholder="50000"
                  required
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  className="w-full mt-1 p-2.5 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="text-xs text-slate-600 font-medium">カテゴリ</label>
                <select
                  value={txCategory}
                  onChange={(e) => setTxCategory(e.target.value)}
                  className="w-full mt-1 p-2.5 border border-slate-200 rounded-xl text-xs"
                >
                  {txType === '支出' ? (
                    <>
                      <option value="エントリー費・学連登録">エントリー費・学連登録</option>
                      <option value="艇体・セール・艤装費">艇体・セール・艤装費</option>
                      <option value="ハーバー係留・スロープ料">ハーバー係留・スロープ料</option>
                      <option value="合宿所・施設利用料">合宿所・施設利用料</option>
                      <option value="その他">その他</option>
                    </>
                  ) : (
                    <>
                      <option value="OB寄付金">OB寄付金</option>
                      <option value="大学助成金">大学助成金</option>
                      <option value="その他">その他</option>
                    </>
                  )}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-600 font-medium">出納元</label>
                  <select
                    value={txSource}
                    onChange={(e) => setTxSource(e.target.value as any)}
                    className="w-full mt-1 p-2.5 border border-slate-200 rounded-xl text-xs"
                  >
                    <option value="部口座振込">部口座振込</option>
                    <option value="部室現金">部室現金</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-600 font-medium">タグ (任意)</label>
                  <input
                    type="text"
                    placeholder="例: 秋インカレ"
                    value={txEventTag}
                    onChange={(e) => setTxEventTag(e.target.value)}
                    className="w-full mt-1 p-2.5 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowClubTxModal(false)} className="flex-1 py-2.5 text-xs border rounded-xl">
                  戻る
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 text-xs bg-slate-900 text-white font-bold rounded-xl shadow-md">
                  登録
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* モーダル: 相殺 */}
      {showOffsetModal && selectedExpenseForOffset && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-xs space-y-4 shadow-2xl">
            <h3 className="font-black text-base text-slate-800">立替金を部費へ相殺</h3>
            <div className="bg-amber-50 p-3 rounded-xl text-xs text-amber-900 border border-amber-200 space-y-0.5">
              <p>立替: <span className="font-bold">{selectedExpenseForOffset.title}</span></p>
              <p className="font-bold">金額: ¥{selectedExpenseForOffset.amount.toLocaleString()}</p>
            </div>

            <div>
              <label className="text-xs text-slate-600 font-medium">充当先の未納請求</label>
              <select
                value={targetPaymentIdForOffset}
                onChange={(e) => setTargetPaymentIdForOffset(e.target.value)}
                className="w-full mt-1 p-2 border border-slate-200 rounded-xl text-xs font-semibold"
              >
                {payments
                  .filter((p) => p.member_id === selectedExpenseForOffset.member_id && p.status !== '支払済')
                  .map((p) => {
                    const ev = events.find((e) => e.id === p.billing_event_id);
                    const remaining = (ev?.amount || 0) - (p.paid_amount || 0);
                    return (
                      <option key={p.id} value={p.id}>
                        {ev?.title} (残: ¥{remaining.toLocaleString()})
                      </option>
                    );
                  })}
              </select>
            </div>

            {/* 結果プレビュー */}
            {(() => {
              const targetP = payments.find((p) => p.id === targetPaymentIdForOffset);
              const targetE = events.find((e) => e.id === targetP?.billing_event_id);
              if (!targetE) return null;
              const remainingToPay = targetE.amount - (targetP?.paid_amount || 0);
              const eAmt = selectedExpenseForOffset.amount;
              const diff = eAmt - remainingToPay;

              return (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                  <p className="font-bold text-slate-700">結果:</p>
                  {diff >= 0 ? (
                    <>
                      <p className="text-green-600 font-bold">・請求: 完済</p>
                      {diff > 0 && <p className="text-blue-700 font-bold">・立替残額: ¥{diff.toLocaleString()}</p>}
                    </>
                  ) : (
                    <p className="text-amber-700 font-bold">・請求残額: ¥{Math.abs(diff).toLocaleString()}</p>
                  )}
                </div>
              );
            })()}

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowOffsetModal(false)} className="flex-1 py-2.5 text-xs border rounded-xl">
                戻る
              </button>
              <button
                type="button"
                onClick={handleExecuteOffset}
                disabled={isSubmitting}
                className="flex-1 py-2.5 text-xs bg-amber-500 text-white font-bold rounded-xl shadow-md"
              >
                相殺を実行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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

  // モーダル管理
  const [showEventModal, setShowEventModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showOffsetModal, setShowOffsetModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showClubTxModal, setShowClubTxModal] = useState(false);
  const [selectedMemberDetail, setSelectedMemberDetail] = useState<Member | null>(null);

  // フォーム用State: 請求作成
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

  // フォーム用State: 相殺
  const [selectedExpenseForOffset, setSelectedExpenseForOffset] = useState<Expense | null>(null);
  const [targetPaymentIdForOffset, setTargetPaymentIdForOffset] = useState<string>('');

  // フォーム用State: 差戻し
  const [targetExpenseForReject, setTargetExpenseForReject] = useState<Expense | null>(null);
  const [rejectReasonText, setRejectReasonText] = useState('');

  // フォーム用State: 部全体出納
  const [txType, setTxType] = useState<'支出' | '収入'>('支出');
  const [txTitle, setTxTitle] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState('エントリー費・学連登録');
  const [txSource, setTxSource] = useState<'部口座振込' | '部室現金'>('部口座振込');
  const [txEventTag, setTxEventTag] = useState('');

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
      .filter((p) => p.member_id === memberId && p.status === '未納')
      .reduce((sum, p) => {
        const ev = events.find((e) => e.id === p.billing_event_id);
        return sum + (ev?.amount || 0);
      }, 0);
  };

  const getUnreimbursedTotal = (memberId: string) => {
    return expenses
      .filter((e) => e.member_id === memberId && e.status === '未精算')
      .reduce((sum, e) => sum + e.amount, 0);
  };

  // 部全体の金庫・収支計算
  const totalCollectedDues = payments
    .filter((p) => p.status === '支払済' && p.payment_method !== '相殺')
    .reduce((sum, p) => {
      const ev = events.find((e) => e.id === p.billing_event_id);
      return sum + (ev?.amount || 0);
    }, 0);

  const totalDeposits = members.reduce((sum, m) => sum + (m.deposit_balance || 0), 0);

  const totalClubDonations = clubTransactions
    .filter((t) => t.type === '収入')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalDirectClubExpenses = clubTransactions
    .filter((t) => t.type === '支出')
    .reduce((sum, t) => sum + t.amount, 0);

  // 現金精算（相殺でもデポジット振替でもない精算）のみ金庫から出金扱いとする
  const totalReimbursedExpenses = expenses
    .filter((e) => e.status === '精算済' && !e.offset_payment_id && e.reject_reason !== 'デポジット振替')
    .reduce((sum, e) => sum + e.amount, 0);

  // 金庫の推定保有純現金
  const estimatedClubTreasury =
    totalCollectedDues + totalDeposits + totalClubDonations - totalDirectClubExpenses - totalReimbursedExpenses;

  // カテゴリ別支出集計
  const categorySpendingMap: { [cat: string]: number } = {};
  clubTransactions
    .filter((t) => t.type === '支出')
    .forEach((t) => {
      categorySpendingMap[t.category] = (categorySpendingMap[t.category] || 0) + t.amount;
    });
  expenses
    .filter((e) => e.status !== '差戻し')
    .forEach((e) => {
      categorySpendingMap[e.category] = (categorySpendingMap[e.category] || 0) + e.amount;
    });

  const totalAllExpenses = Object.values(categorySpendingMap).reduce((a, b) => a + b, 0);

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

  // 請求作成
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

  // 立替申請
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

  // 部全体の直接出納の登録
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

  // デポジットチャージ
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

  // デポジットから充当
  const handlePayWithDeposit = async (paymentId: string, requiredAmount: number) => {
    if (!currentMember) return;
    if (currentMember.deposit_balance < requiredAmount) {
      alert(`デポジット残高が不足しています（現在: ¥${currentMember.deposit_balance.toLocaleString()}）`);
      return;
    }
    if (!confirm(`デポジットから ¥${requiredAmount.toLocaleString()} を引き落として支払済にしますか？`)) return;

    await supabase
      .from('members')
      .update({ deposit_balance: currentMember.deposit_balance - requiredAmount })
      .eq('id', currentMember.id);

    await supabase
      .from('payments')
      .update({ status: '支払済', payment_method: 'デポジット' })
      .eq('id', paymentId);

    fetchData();
  };

  // 立替金を部費へ相殺
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

    await supabase
      .from('payments')
      .update({
        status: '支払済',
        payment_method: '相殺',
        offset_expense_id: selectedExpenseForOffset.id,
      })
      .eq('id', targetPaymentIdForOffset);

    await supabase
      .from('expenses')
      .update({
        status: '精算済',
        offset_payment_id: targetPaymentIdForOffset,
      })
      .eq('id', selectedExpenseForOffset.id);

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

  // ★ 新機能: 立替金をデポジット残高へ振り替え
  const handleConvertToDeposit = async (expense: Expense) => {
    const mem = members.find((m) => m.id === expense.member_id);
    if (!mem) return;

    if (!confirm(`立替金 ¥${expense.amount.toLocaleString()} を返金せず、${mem.name} さんのデポジット（預かり金）に移行しますか？`)) {
      return;
    }

    // 1. 立替を精算済（デポジット振替）に更新
    await supabase
      .from('expenses')
      .update({
        status: '精算済',
        reject_reason: 'デポジット振替',
      })
      .eq('id', expense.id);

    // 2. 部員のデポジット残高に加算
    await supabase
      .from('members')
      .update({
        deposit_balance: (mem.deposit_balance || 0) + expense.amount,
      })
      .eq('id', mem.id);

    alert(`¥${expense.amount.toLocaleString()} を ${mem.name} さんのデポジット残高に移行しました！`);
    fetchData();
  };

  // 差戻し処理
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
    const header = ['大分類', '種別', '対象者/支払元', '品名/タイトル', '金額', 'ステータス/備考', '日付'];
    const rows: string[][] = [];

    payments.forEach((p) => {
      const ev = events.find((e) => e.id === p.billing_event_id);
      const mem = members.find((m) => m.id === p.member_id);
      rows.push(['部費請求', '請求', mem?.name || '', ev?.title || '', String(ev?.amount || 0), `${p.status} (${p.payment_method || ''})`, ev?.due_date || '']);
    });

    expenses.forEach((e) => {
      const mem = members.find((m) => m.id === e.member_id);
      rows.push(['個人立替', e.category, mem?.name || '', e.title, String(e.amount), `${e.status} ${e.reject_reason || ''}`, e.created_at?.split('T')[0] || '']);
    });

    clubTransactions.forEach((t) => {
      rows.push(['部直接出納', t.type, t.payment_source, t.title, String(t.amount), t.event_tag || t.category, t.created_at?.split('T')[0] || '']);
    });

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [header.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `yacht_club_full_report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <main className="max-w-md mx-auto p-4 space-y-5 pb-24 min-h-screen bg-slate-50 text-slate-800">
      {/* ナビゲーションヘッダー */}
      <header className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
        <div className="flex justify-between items-center">
          <h1 className="text-base font-extrabold text-slate-900 flex items-center gap-1.5">
            ⛵ ヨット部 会計システム
          </h1>
          <button onClick={exportToCSV} className="text-[11px] bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg text-slate-700 font-semibold">
            📥 全CSV出力
          </button>
        </div>

        {/* 3タブ切り替えトグル */}
        <div className="grid grid-cols-3 bg-slate-100 p-1 rounded-xl text-xs font-bold text-slate-600">
          <button
            onClick={() => setActiveTab('personal')}
            className={`py-1.5 rounded-lg transition ${activeTab === 'personal' ? 'bg-white text-blue-600 shadow-sm' : ''}`}
          >
            👤 マイページ
          </button>
          <button
            onClick={() => setActiveTab('club')}
            className={`py-1.5 rounded-lg transition ${activeTab === 'club' ? 'bg-white text-blue-600 shadow-sm' : ''}`}
          >
            📊 全体会計
          </button>
          <button
            onClick={() => setActiveTab('members')}
            className={`py-1.5 rounded-lg transition ${activeTab === 'members' ? 'bg-white text-blue-600 shadow-sm' : ''}`}
          >
            👥 部員カルテ
          </button>
        </div>

        {/* 部員セレクター */}
        <div>
          <select
            value={selectedMemberId}
            onChange={(e) => handleMemberChange(e.target.value)}
            className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50 text-xs font-semibold text-slate-800"
          >
            <option value="">-- 表示・申請する部員を選択 --</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.grade}年 {m.name} ({m.role})
              </option>
            ))}
          </select>
        </div>
      </header>

      {loading ? (
        <p className="text-xs text-slate-400 text-center py-10">データを読み込み中...</p>
      ) : (
        <>
          {/* ============================================================== */}
          {/* TAB 1: 👤 個人マイページ                                      */}
          {/* ============================================================== */}
          {activeTab === 'personal' && (
            <div className="space-y-4">
              {currentMember ? (
                <div className="grid grid-cols-3 gap-2 bg-white p-3 rounded-2xl border border-slate-100 shadow-sm text-center">
                  <div className="bg-red-50 p-2.5 rounded-xl">
                    <span className="text-[10px] text-red-600 font-medium block">未納部費</span>
                    <span className="text-xs font-black text-red-700">¥{getUnpaidTotal(currentMember.id).toLocaleString()}</span>
                  </div>
                  <div className="bg-blue-50 p-2.5 rounded-xl">
                    <span className="text-[10px] text-blue-600 font-medium block">未精算立替</span>
                    <span className="text-xs font-black text-blue-700">¥{getUnreimbursedTotal(currentMember.id).toLocaleString()}</span>
                  </div>
                  <div className="bg-emerald-50 p-2.5 rounded-xl flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] text-emerald-600 font-medium block">デポジット</span>
                      <span className="text-xs font-black text-emerald-700">¥{currentMember.deposit_balance.toLocaleString()}</span>
                    </div>
                    <button
                      onClick={() => setShowDepositModal(true)}
                      className="mt-1 text-[9px] bg-emerald-600 text-white rounded-md py-0.5 font-bold"
                    >
                      + 入金
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 text-center">
                  上部のプルダウンからあなたの名前を選択してください
                </div>
              )}

              {/* クイックアクション */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShowExpenseModal(true)}
                  className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-sm flex items-center justify-center gap-1.5"
                >
                  <span>📸</span> 立替を申請する
                </button>
                <button
                  onClick={() => {
                    setTargetMemberIds(members.map((m) => m.id));
                    setShowEventModal(true);
                  }}
                  className="p-3 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold text-xs shadow-sm flex items-center justify-center gap-1.5"
                >
                  <span>📋</span> 請求を作成する
                </button>
              </div>

              {/* 自分の請求・支払いリスト */}
              <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
                <h2 className="font-extrabold text-xs text-slate-500 uppercase tracking-wider">
                  {currentMember ? `${currentMember.name} さんの請求状況` : '全員の請求一覧'}
                </h2>
                {payments
                  .filter((p) => !currentMember || p.member_id === currentMember.id)
                  .map((p) => {
                    const ev = events.find((e) => e.id === p.billing_event_id);
                    const member = members.find((m) => m.id === p.member_id);
                    const evAmount = ev?.amount || 0;
                    const hasDeposit = (member?.deposit_balance || 0) >= evAmount;

                    return (
                      <div key={p.id} className="p-3 border border-slate-100 rounded-xl bg-slate-50/50 flex justify-between items-center">
                        <div>
                          <p className="font-bold text-xs text-slate-800">{ev?.title}</p>
                          <p className="text-[11px] text-slate-500">
                            {member?.name} | <span className="font-semibold text-slate-700">¥{evAmount.toLocaleString()}</span>
                          </p>
                          {p.payment_method && p.status === '支払済' && (
                            <span className="inline-block mt-0.5 text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-medium">
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
                            className={`text-xs px-2.5 py-1.5 rounded-lg font-bold transition shadow-sm ${
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
                  })}
              </section>

              {/* 自分の立替リスト */}
              <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
                <h2 className="font-extrabold text-xs text-slate-500 uppercase tracking-wider">
                  {currentMember ? `${currentMember.name} さんの立替申請` : '全員の立替申請'}
                </h2>
                {expenses
                  .filter((e) => !currentMember || e.member_id === currentMember.id)
                  .map((e) => {
                    const memberUnpaid = payments.filter((p) => p.member_id === e.member_id && p.status === '未納');
                    return (
                      <div key={e.id} className="p-3 border border-slate-100 rounded-xl bg-slate-50/50 space-y-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[9px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-bold">
                              {e.category}
                            </span>
                            <p className="font-bold text-xs text-slate-800 mt-1">{e.title}</p>
                            <p className="text-[11px] text-slate-500">¥{e.amount.toLocaleString()}</p>
                          </div>
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-md font-bold ${
                              e.status === '精算済'
                                ? 'bg-slate-100 text-slate-500'
                                : e.status === '差戻し'
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {e.status} {e.reject_reason === 'デポジット振替' && '(デポジット)'}
                          </span>
                        </div>

                        {e.status === '差戻し' && e.reject_reason && (
                          <div className="p-2 bg-orange-50 border border-orange-100 rounded-lg text-[10px] text-orange-800">
                            ⚠️ 差戻し理由: {e.reject_reason}
                          </div>
                        )}

                        {e.receipt_url && (
                          <a href={e.receipt_url} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-blue-600 underline">
                            📄 レシート画像を表示
                          </a>
                        )}

                        {e.status === '未精算' && (
                          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
                            {memberUnpaid.length > 0 && (
                              <button
                                onClick={() => {
                                  setSelectedExpenseForOffset(e);
                                  setTargetPaymentIdForOffset(memberUnpaid[0].id);
                                  setShowOffsetModal(true);
                                }}
                                className="text-[10px] bg-amber-500 hover:bg-amber-600 text-white font-bold px-2 py-1 rounded-md"
                              >
                                🔄 部費へ相殺
                              </button>
                            )}
                            {/* ★ デポジットへ移行ボタン */}
                            <button
                              onClick={() => handleConvertToDeposit(e)}
                              className="text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-2 py-1 rounded-md shadow-sm"
                            >
                              💰 デポジットへ移行
                            </button>
                            <button
                              onClick={() => toggleExpenseNormal(e.id, e.status)}
                              className="text-[10px] bg-slate-700 hover:bg-slate-800 text-white font-bold px-2 py-1 rounded-md"
                            >
                              現金精算済
                            </button>
                            <button
                              onClick={() => {
                                setTargetExpenseForReject(e);
                                setShowRejectModal(true);
                              }}
                              className="text-[10px] bg-rose-50 text-rose-600 border border-rose-200 px-2 py-1 rounded-md"
                            >
                              差戻し
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </section>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: 📊 全体会計・金庫・支出内訳                            */}
          {/* ============================================================== */}
          {activeTab === 'club' && (
            <div className="space-y-4">
              <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 rounded-3xl shadow-md space-y-3">
                <div className="flex justify-between items-center text-xs text-slate-400">
                  <span>部の推定総資金（口座＋現金箱）</span>
                  <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full font-bold">健全</span>
                </div>
                <div className="text-3xl font-black tracking-tight text-white">
                  ¥{estimatedClubTreasury.toLocaleString()}
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/60 text-xs">
                  <div>
                    <span className="text-slate-400 text-[10px] block">総入金額（部費+寄付）</span>
                    <span className="font-bold text-emerald-400">+¥{(totalCollectedDues + totalClubDonations).toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">総実支出（直接+精算立替）</span>
                    <span className="font-bold text-rose-400">-¥{(totalDirectClubExpenses + totalReimbursedExpenses).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowClubTxModal(true)}
                className="w-full p-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-xl font-bold text-xs shadow-sm flex items-center justify-center gap-1.5"
              >
                <span>➕</span> 部口座/金庫からの出費・寄付を記録
              </button>

              <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
                <div className="flex justify-between items-center">
                  <h2 className="font-extrabold text-xs text-slate-500 uppercase tracking-wider">支出カテゴリ別 内訳</h2>
                  <span className="text-[11px] font-bold text-slate-700">総支出: ¥{totalAllExpenses.toLocaleString()}</span>
                </div>
                {totalAllExpenses === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">支出データはありません</p>
                ) : (
                  <div className="space-y-2.5">
                    {Object.entries(categorySpendingMap).map(([cat, amt]) => {
                      const percent = Math.round((amt / totalAllExpenses) * 100);
                      return (
                        <div key={cat} className="space-y-1">
                          <div className="flex justify-between text-xs font-semibold">
                            <span className="text-slate-700">{cat}</span>
                            <span className="text-slate-900">¥{amt.toLocaleString()} ({percent}%)</span>
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

              <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
                <h2 className="font-extrabold text-xs text-slate-500 uppercase tracking-wider">部の直接出納履歴</h2>
                {clubTransactions.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">直接出納の記録はありません</p>
                ) : (
                  clubTransactions.map((tx) => (
                    <div key={tx.id} className="p-3 border border-slate-100 rounded-xl bg-slate-50/50 flex justify-between items-center">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-black ${
                              tx.type === '収入' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {tx.type}
                          </span>
                          <span className="text-xs font-bold text-slate-800">{tx.title}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">
                          {tx.category} | {tx.payment_source} {tx.event_tag && `[${tx.event_tag}]`}
                        </p>
                      </div>
                      <span className={`text-xs font-extrabold ${tx.type === '収入' ? 'text-emerald-600' : 'text-slate-800'}`}>
                        {tx.type === '収入' ? '+' : '-'}¥{tx.amount.toLocaleString()}
                      </span>
                    </div>
                  ))
                )}
              </section>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: 👥 部員別カルテ・サマリー                               */}
          {/* ============================================================== */}
          {activeTab === 'members' && (
            <div className="space-y-3">
              <p className="text-[11px] text-slate-500 px-1">部員をタップすると、これまでの全納入・立替履歴（カルテ）を確認できます。</p>
              {members.map((m) => {
                const unpaid = getUnpaidTotal(m.id);
                const unreimbursed = getUnreimbursedTotal(m.id);
                const canOffset = unpaid > 0 && unreimbursed > 0;

                return (
                  <div
                    key={m.id}
                    onClick={() => setSelectedMemberDetail(m)}
                    className="p-3.5 bg-white border border-slate-100 rounded-2xl shadow-sm hover:border-blue-300 transition cursor-pointer flex justify-between items-center"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-800">{m.grade}年 {m.name}</span>
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-medium">{m.role}</span>
                        {canOffset && (
                          <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-black">
                            相殺可
                          </span>
                        )}
                      </div>
                      <div className="flex gap-3 text-xs mt-1">
                        <span className={unpaid > 0 ? 'text-red-600 font-bold' : 'text-slate-400'}>
                          未納: ¥{unpaid.toLocaleString()}
                        </span>
                        <span className={unreimbursed > 0 ? 'text-blue-600 font-bold' : 'text-slate-400'}>
                          立替: ¥{unreimbursed.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      {m.deposit_balance > 0 ? (
                        <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
                          預り ¥{m.deposit_balance.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-sm">›</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* モーダル: 部員詳細カルテ */}
      {selectedMemberDetail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b pb-3">
              <div>
                <h3 className="font-black text-base text-slate-800">
                  {selectedMemberDetail.grade}年 {selectedMemberDetail.name} ({selectedMemberDetail.role})
                </h3>
                <p className="text-xs text-slate-500">デポジット残高: ¥{selectedMemberDetail.deposit_balance.toLocaleString()}</p>
              </div>
              <button onClick={() => setSelectedMemberDetail(null)} className="text-slate-400 hover:text-slate-600 font-bold text-lg">✕</button>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-600">納入履歴</h4>
              {payments.filter((p) => p.member_id === selectedMemberDetail.id).length === 0 ? (
                <p className="text-[11px] text-slate-400">履歴はありません</p>
              ) : (
                payments.filter((p) => p.member_id === selectedMemberDetail.id).map((p) => {
                  const ev = events.find((e) => e.id === p.billing_event_id);
                  return (
                    <div key={p.id} className="p-2 bg-slate-50 rounded-lg text-xs flex justify-between items-center">
                      <div>
                        <p className="font-semibold text-slate-800">{ev?.title}</p>
                        <p className="text-[10px] text-slate-500">{ev?.due_date} | {p.payment_method}</p>
                      </div>
                      <span className={`font-bold ${p.status === '支払済' ? 'text-green-600' : 'text-red-500'}`}>{p.status}</span>
                    </div>
                  );
                })
              )}

              <h4 className="text-xs font-bold text-slate-600 pt-2">立替履歴</h4>
              {expenses.filter((e) => e.member_id === selectedMemberDetail.id).length === 0 ? (
                <p className="text-[11px] text-slate-400">立替はありません</p>
              ) : (
                expenses.filter((e) => e.member_id === selectedMemberDetail.id).map((e) => (
                  <div key={e.id} className="p-2 bg-slate-50 rounded-lg text-xs flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-slate-800">{e.title} (¥{e.amount.toLocaleString()})</p>
                      <p className="text-[10px] text-slate-500">{e.category} {e.reject_reason && `(${e.reject_reason})`}</p>
                    </div>
                    <span className="font-bold text-slate-600">{e.status}</span>
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => setSelectedMemberDetail(null)}
              className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* モーダル: 部全体の直接出納の登録 */}
      {showClubTxModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4">
            <h3 className="font-black text-base text-slate-800">部の直接出納・寄付の記録</h3>
            <form onSubmit={handleCreateClubTransaction} className="space-y-3">
              <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setTxType('支出')}
                  className={`py-1.5 rounded-lg ${txType === '支出' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-600'}`}
                >
                  部口座からの支出
                </button>
                <button
                  type="button"
                  onClick={() => setTxType('収入')}
                  className={`py-1.5 rounded-lg ${txType === '収入' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-600'}`}
                >
                  寄付・助成金収入
                </button>
              </div>

              <div>
                <label className="text-xs text-slate-600 font-medium">品名・内容</label>
                <input
                  type="text"
                  placeholder={txType === '支出' ? '例: インカレ参加料、ハーバー年間係留料' : '例: OB〇〇先輩からの寄付、大学助成金'}
                  required
                  value={txTitle}
                  onChange={(e) => setTxTitle(e.target.value)}
                  className="w-full mt-1 p-2 border border-slate-200 rounded-xl text-xs"
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
                  className="w-full mt-1 p-2 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="text-xs text-slate-600 font-medium">カテゴリ</label>
                <select
                  value={txCategory}
                  onChange={(e) => setTxCategory(e.target.value)}
                  className="w-full mt-1 p-2 border border-slate-200 rounded-xl text-xs"
                >
                  {txType === '支出' ? (
                    <>
                      <option value="エントリー費・学連登録">エントリー費・学連登録</option>
                      <option value="ハーバー係留・スロープ料">ハーバー係留・スロープ料</option>
                      <option value="艇体・セール共同購入">艇体・セール共同購入</option>
                      <option value="合宿所・施設利用料">合宿所・施設利用料</option>
                      <option value="その他部の直接支出">その他部の直接支出</option>
                    </>
                  ) : (
                    <>
                      <option value="OB・OG寄付金">OB・OG寄付金</option>
                      <option value="大学助成金・支援費">大学助成金・支援費</option>
                      <option value="備品売却等その他収入">備品売却等その他収入</option>
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
                    className="w-full mt-1 p-2 border border-slate-200 rounded-xl text-xs"
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
                    className="w-full mt-1 p-2 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowClubTxModal(false)} className="flex-1 py-2 text-xs border rounded-xl">
                  キャンセル
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2 text-xs bg-slate-900 text-white font-bold rounded-xl">
                  {isSubmitting ? '登録中...' : '登録する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* モーダル: 請求作成 */}
      {showEventModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-black text-base text-slate-800">新規請求の作成</h3>
            <form onSubmit={handleCreateBillingEvent} className="space-y-3">
              <div>
                <label className="text-xs text-slate-600 font-medium">請求タイトル</label>
                <input
                  type="text"
                  placeholder="例: 10月度部費、秋インカレ遠征費"
                  required
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  className="w-full mt-1 p-2 border border-slate-200 rounded-xl text-xs"
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
                  className="w-full mt-1 p-2 border border-slate-200 rounded-xl text-xs"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 font-medium">支払期日</label>
                <input
                  type="date"
                  value={eventDueDate}
                  onChange={(e) => setEventDueDate(e.target.value)}
                  className="w-full mt-1 p-2 border border-slate-200 rounded-xl text-xs"
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
                    className="text-[10px] text-blue-600 underline"
                  >
                    全選択/解除
                  </button>
                </div>
                <div className="max-h-32 overflow-y-auto border border-slate-100 rounded-xl p-2 space-y-1 bg-slate-50">
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
                <button type="button" onClick={() => setShowEventModal(false)} className="flex-1 py-2 text-xs border rounded-xl">
                  キャンセル
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2 text-xs bg-slate-900 text-white font-bold rounded-xl">
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
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4">
            <h3 className="font-black text-base text-slate-800">立替金の申請</h3>
            <form onSubmit={handleCreateExpense} className="space-y-3">
              <div>
                <label className="text-xs text-slate-600 font-medium">品名・用途</label>
                <input
                  type="text"
                  placeholder="例: レスキュー艇給油代、ロープ購入"
                  required
                  value={expenseTitle}
                  onChange={(e) => setExpenseTitle(e.target.value)}
                  className="w-full mt-1 p-2 border border-slate-200 rounded-xl text-xs"
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
                  className="w-full mt-1 p-2 border border-slate-200 rounded-xl text-xs"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 font-medium">カテゴリ</label>
                <select
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value)}
                  className="w-full mt-1 p-2 border border-slate-200 rounded-xl text-xs"
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
                <button type="button" onClick={() => setShowExpenseModal(false)} className="flex-1 py-2 text-xs border rounded-xl">
                  キャンセル
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2 text-xs bg-blue-600 text-white font-bold rounded-xl">
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
          <div className="bg-white rounded-3xl p-5 w-full max-w-xs space-y-4">
            <h3 className="font-black text-base text-slate-800">デポジット（前払い金）入金</h3>
            <form onSubmit={handleAddDeposit} className="space-y-3">
              <div>
                <label className="text-xs text-slate-600 font-medium">入金額</label>
                <input
                  type="number"
                  placeholder="20000"
                  required
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full mt-1 p-2 border border-slate-200 rounded-xl text-xs"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowDepositModal(false)} className="flex-1 py-2 text-xs border rounded-xl">
                  キャンセル
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2 text-xs bg-emerald-600 text-white font-bold rounded-xl">
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
          <div className="bg-white rounded-3xl p-5 w-full max-w-xs space-y-4">
            <h3 className="font-black text-base text-slate-800">立替金を部費へ充当（相殺）</h3>
            <div className="bg-amber-50 p-3 rounded-xl text-xs text-amber-900">
              対象立替: <span className="font-bold">{selectedExpenseForOffset.title}</span> (¥{selectedExpenseForOffset.amount.toLocaleString()})
            </div>
            <div>
              <label className="text-xs text-slate-600 font-medium">充当先の未納請求を選択</label>
              <select
                value={targetPaymentIdForOffset}
                onChange={(e) => setTargetPaymentIdForOffset(e.target.value)}
                className="w-full mt-1 p-2 border border-slate-200 rounded-xl text-xs"
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
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowOffsetModal(false)} className="flex-1 py-2 text-xs border rounded-xl">
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleExecuteOffset}
                disabled={isSubmitting}
                className="flex-1 py-2 text-xs bg-amber-500 text-white font-bold rounded-xl"
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
          <div className="bg-white rounded-3xl p-5 w-full max-w-xs space-y-4">
            <h3 className="font-black text-base text-slate-800">立替の差戻し</h3>
            <textarea
              placeholder="例: 私用の買い物代が含まれています。差し引いて再申請してください。"
              value={rejectReasonText}
              onChange={(e) => setRejectReasonText(e.target.value)}
              rows={3}
              className="w-full p-2 border border-slate-200 rounded-xl text-xs"
            />
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowRejectModal(false)} className="flex-1 py-2 text-xs border rounded-xl">
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleExecuteReject}
                disabled={isSubmitting}
                className="flex-1 py-2 text-xs bg-rose-600 text-white font-bold rounded-xl"
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

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

  // モーダル・ポップオーバー管理
  const [showEventModal, setShowEventModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showOffsetModal, setShowOffsetModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showClubTxModal, setShowClubTxModal] = useState(false);
  const [selectedMemberDetail, setSelectedMemberDetail] = useState<Member | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [activeMenuExpenseId, setActiveMenuExpenseId] = useState<string | null>(null);

  // フォームState
  const [eventTitle, setEventTitle] = useState('');
  const [eventAmount, setEventAmount] = useState('');
  const [eventDueDate, setEventDueDate] = useState('');
  const [targetMemberIds, setTargetMemberIds] = useState<string[]>([]);

  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('ガソリン代');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [depositAmount, setDepositAmount] = useState('');

  const [selectedExpenseForOffset, setSelectedExpenseForOffset] = useState<Expense | null>(null);
  const [targetPaymentIdForOffset, setTargetPaymentIdForOffset] = useState<string>('');

  const [targetExpenseForReject, setTargetExpenseForReject] = useState<Expense | null>(null);
  const [rejectReasonText, setRejectReasonText] = useState('');

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

  const totalReimbursedExpenses = expenses
    .filter((e) => e.status === '精算済' && !e.offset_payment_id && e.reject_reason !== 'デポジット振替')
    .reduce((sum, e) => sum + e.amount, 0);

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

  // 立替金をデポジット残高へ振り替え
  const handleConvertToDeposit = async (expense: Expense) => {
    const mem = members.find((m) => m.id === expense.member_id);
    if (!mem) return;

    if (!confirm(`立替金 ¥${expense.amount.toLocaleString()} を返金せず、${mem.name} さんのデポジット（預かり金）に移行しますか？`)) {
      return;
    }

    await supabase
      .from('expenses')
      .update({
        status: '精算済',
        reject_reason: 'デポジット振替',
      })
      .eq('id', expense.id);

    await supabase
      .from('members')
      .update({
        deposit_balance: (mem.deposit_balance || 0) + expense.amount,
      })
      .eq('id', mem.id);

    setActiveMenuExpenseId(null);
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
    setActiveMenuExpenseId(null);
    setIsSubmitting(false);
    fetchData();
  };

  const togglePaymentNormal = async (paymentId: string, currentStatus: string) => {
    const nextStatus = currentStatus === '未納' ? '支払済' : '未納';
    await supabase.from('payments').update({ status: nextStatus, payment_method: '現金/振込' }).eq('id', paymentId);
    fetchData();
  };

  const toggleExpenseNormal = async (expenseId: string, currentStatus: string) => {
    const nextStatus = currentStatus === '未精算' ? '精算済' : '未精算';
    await supabase.from('expenses').update({ status: nextStatus }).eq('id', expenseId);
    setActiveMenuExpenseId(null);
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
    <div className="min-h-screen bg-slate-100 text-slate-800 pb-28">
      {/* トップヘッダー（画面幅いっぱいにフィット） */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3">
        <div className="w-full flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex justify-between items-center">
            <h1 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span className="text-xl">⛵</span> ヨット部 会計システム
            </h1>
            <button onClick={exportToCSV} className="text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-slate-700 font-bold transition flex items-center gap-1">
              <span>📥</span> CSV出力
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium shrink-0">表示部員:</span>
            <select
              value={selectedMemberId}
              onChange={(e) => handleMemberChange(e.target.value)}
              className="w-full md:w-64 p-2 border border-slate-300 rounded-xl bg-white text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
            >
              <option value="">-- 全体表示（未選択） --</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.grade}年 {m.name} ({m.role})
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* メインコンテンツ領域（横幅フル活用レスポンシブ） */}
      <main className="w-full px-4 py-4 max-w-7xl mx-auto space-y-5">
        {loading ? (
          <p className="text-xs text-slate-400 text-center py-20 font-medium">データを読み込み中...</p>
        ) : (
          <>
            {/* ============================================================== */}
            {/* TAB 1: 👤 個人マイページ                                      */}
            {/* ============================================================== */}
            {activeTab === 'personal' && (
              <div className="space-y-4">
                {currentMember ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="bg-red-50 p-3 rounded-xl border border-red-100">
                      <span className="text-xs text-red-600 font-bold block">未納部費</span>
                      <span className="text-lg font-black text-red-700 tabular-nums">¥{getUnpaidTotal(currentMember.id).toLocaleString()}</span>
                    </div>
                    <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                      <span className="text-xs text-blue-600 font-bold block">未精算立替</span>
                      <span className="text-lg font-black text-blue-700 tabular-nums">¥{getUnreimbursedTotal(currentMember.id).toLocaleString()}</span>
                    </div>
                    <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-emerald-600 font-bold block">デポジット残高</span>
                        <span className="text-lg font-black text-emerald-700 tabular-nums">¥{currentMember.deposit_balance.toLocaleString()}</span>
                      </div>
                      <button
                        onClick={() => setShowDepositModal(true)}
                        className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg px-2.5 py-1.5 shadow-sm transition"
                      >
                        + 入金
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 text-center font-medium">
                    ヘッダーのプルダウンからあなたの名前を選択すると、個人の収支状況や専用操作が表示されます。
                  </div>
                )}

                {/* クイックアクション */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setShowExpenseModal(true)}
                    className="p-3.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-2xl font-bold text-xs shadow-md transition flex items-center justify-center gap-2"
                  >
                    <span className="text-base">📸</span> 立替を申請する
                  </button>
                  <button
                    onClick={() => {
                      setTargetMemberIds(members.map((m) => m.id));
                      setShowEventModal(true);
                    }}
                    className="p-3.5 bg-slate-900 hover:bg-black active:scale-[0.98] text-white rounded-2xl font-bold text-xs shadow-md transition flex items-center justify-center gap-2"
                  >
                    <span className="text-base">📋</span> 請求を作成する
                  </button>
                </div>

                {/* 2カラムレイアウト（タブレット・PC以上で横並び） */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* 請求・支払いリスト */}
                  <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                    <h2 className="font-black text-xs text-slate-500 uppercase tracking-wider">
                      {currentMember ? `${currentMember.name} さんの請求一覧` : '部費・請求状況'}
                    </h2>
                    {payments
                      .filter((p) => !currentMember || p.member_id === currentMember.id)
                      .length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-6">該当する請求はありません</p>
                      ) : (
                        payments
                          .filter((p) => !currentMember || p.member_id === currentMember.id)
                          .map((p) => {
                            const ev = events.find((e) => e.id === p.billing_event_id);
                            const member = members.find((m) => m.id === p.member_id);
                            const evAmount = ev?.amount || 0;
                            const hasDeposit = (member?.deposit_balance || 0) >= evAmount;

                            return (
                              <div key={p.id} className="p-3 border border-slate-100 rounded-xl bg-slate-50 flex justify-between items-center hover:bg-slate-100/70 transition">
                                <div>
                                  <p className="font-bold text-xs text-slate-800">{ev?.title}</p>
                                  <p className="text-[11px] text-slate-500">
                                    {member?.name} | <span className="font-bold text-slate-700 tabular-nums">¥{evAmount.toLocaleString()}</span>
                                  </p>
                                  {p.payment_method && p.status === '支払済' && (
                                    <span className="inline-block mt-1 text-[9px] bg-white border border-slate-200 text-slate-600 px-1.5 py-0.2 rounded font-medium">
                                      {p.payment_method}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {p.status === '未納' && hasDeposit && (
                                    <button
                                      onClick={() => handlePayWithDeposit(p.id, evAmount)}
                                      className="text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg font-bold shadow-sm transition"
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

                  {/* 立替リスト（★ サムネイル ＋ ⋯メニューで整理） */}
                  <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                    <h2 className="font-black text-xs text-slate-500 uppercase tracking-wider">
                      {currentMember ? `${currentMember.name} さんの立替申請` : '立替・経費一覧'}
                    </h2>
                    {expenses
                      .filter((e) => !currentMember || e.member_id === currentMember.id)
                      .length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-6">該当する立替申請はありません</p>
                      ) : (
                        expenses
                          .filter((e) => !currentMember || e.member_id === currentMember.id)
                          .map((e) => {
                            const member = members.find((m) => m.id === e.member_id);
                            const memberUnpaid = payments.filter((p) => p.member_id === e.member_id && p.status === '未納');
                            const isMenuOpen = activeMenuExpenseId === e.id;

                            return (
                              <div key={e.id} className="p-3 border border-slate-100 rounded-xl bg-slate-50 space-y-2.5 relative">
                                <div className="flex gap-3 items-center">
                                  {/* レシートサムネイル */}
                                  {e.receipt_url ? (
                                    <div
                                      onClick={() => setPreviewImageUrl(e.receipt_url || null)}
                                      className="w-14 h-14 rounded-lg bg-slate-200 shrink-0 overflow-hidden border border-slate-200 cursor-pointer relative group"
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={e.receipt_url}
                                        alt="レシート"
                                        className="w-full h-full object-cover group-hover:scale-105 transition"
                                      />
                                      <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition text-[9px] text-white font-bold">
                                        拡大
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="w-14 h-14 rounded-lg bg-slate-100 shrink-0 border border-slate-200 flex flex-col items-center justify-center text-slate-400 text-[10px]">
                                      <span>📄</span>
                                      <span>無</span>
                                    </div>
                                  )}

                                  {/* 立替情報 */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[9px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-bold">
                                        {e.category}
                                      </span>
                                      <span className="text-[11px] text-slate-500">{member?.name}</span>
                                    </div>
                                    <p className="font-bold text-xs text-slate-800 truncate mt-0.5">{e.title}</p>
                                    <p className="text-sm font-black text-slate-900 tabular-nums">¥{e.amount.toLocaleString()}</p>
                                  </div>

                                  {/* ステータスバッジ */}
                                  <div className="shrink-0 text-right">
                                    <span
                                      className={`text-[10px] px-2 py-1 rounded-md font-black ${
                                        e.status === '精算済'
                                          ? 'bg-slate-200 text-slate-600'
                                          : e.status === '差戻し'
                                          ? 'bg-orange-100 text-orange-800 border border-orange-200'
                                          : 'bg-amber-100 text-amber-800 border border-amber-200'
                                      }`}
                                    >
                                      {e.status} {e.reject_reason === 'デポジット振替' && '(デポ)'}
                                    </span>
                                  </div>
                                </div>

                                {e.status === '差戻し' && e.reject_reason && (
                                  <div className="p-2 bg-orange-50 border border-orange-200 rounded-lg text-[10px] text-orange-800">
                                    ⚠️ 差戻し理由: {e.reject_reason}
                                  </div>
                                )}

                                {/* 未精算時の整理されたアクションボタン */}
                                {e.status === '未精算' && (
                                  <div className="flex items-center gap-1.5 pt-2 border-t border-slate-200">
                                    {/* プライマリアクション：デポジットへ移行 */}
                                    <button
                                      onClick={() => handleConvertToDeposit(e)}
                                      className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white text-[11px] font-bold rounded-lg shadow-sm transition flex items-center justify-center gap-1"
                                    >
                                      <span>💰</span> デポジットへ移行
                                    </button>

                                    {/* 相殺ボタン（未納がある場合のみ主ボタン化） */}
                                    {memberUnpaid.length > 0 && (
                                      <button
                                        onClick={() => {
                                          setSelectedExpenseForOffset(e);
                                          setTargetPaymentIdForOffset(memberUnpaid[0].id);
                                          setShowOffsetModal(true);
                                        }}
                                        className="py-1.5 px-2.5 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold rounded-lg shadow-sm transition"
                                      >
                                        🔄 部費相殺
                                      </button>
                                    )}

                                    {/* ⋯ その他のメニューボタントグル */}
                                    <div className="relative">
                                      <button
                                        onClick={() => setActiveMenuExpenseId(isMenuOpen ? null : e.id)}
                                        className="p-1.5 px-2.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg font-bold text-xs"
                                      >
                                        ⋯
                                      </button>

                                      {/* ポップオーバーメニュー */}
                                      {isMenuOpen && (
                                        <div className="absolute right-0 bottom-8 z-30 w-36 bg-white rounded-xl shadow-xl border border-slate-200 py-1 text-xs">
                                          <button
                                            onClick={() => toggleExpenseNormal(e.id, e.status)}
                                            className="w-full text-left px-3 py-2 text-slate-700 hover:bg-slate-50 font-medium"
                                          >
                                            💵 現金精算済にする
                                          </button>
                                          <button
                                            onClick={() => {
                                              setTargetExpenseForReject(e);
                                              setShowRejectModal(true);
                                            }}
                                            className="w-full text-left px-3 py-2 text-rose-600 hover:bg-rose-50 font-medium border-t border-slate-100"
                                          >
                                            ⚠️️ 差戻す
                                          </button>
                                        </div>
                                      )}
                                    </div>
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

            {/* ============================================================== */}
            {/* TAB 2: 📊 全体会計・金庫・支出内訳                            */}
            {/* ============================================================== */}
            {activeTab === 'club' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white p-5 rounded-3xl shadow-lg space-y-3">
                    <div className="flex justify-between items-center text-xs text-slate-400">
                      <span>部の推定総資金（口座＋現金箱）</span>
                      <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full font-bold">健全</span>
                    </div>
                    <div className="text-3xl sm:text-4xl font-black tracking-tight text-white tabular-nums">
                      ¥{estimatedClubTreasury.toLocaleString()}
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-800 text-xs">
                      <div>
                        <span className="text-slate-400 text-[10px] block">総入金額（部費+寄付）</span>
                        <span className="font-bold text-emerald-400 tabular-nums">+¥{(totalCollectedDues + totalClubDonations).toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] block">総実支出（直接+精算立替）</span>
                        <span className="font-bold text-rose-400 tabular-nums">-¥{(totalDirectClubExpenses + totalReimbursedExpenses).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-center">
                    <p className="text-xs text-slate-500 font-medium">直接出納・寄付の登録</p>
                    <p className="text-[11px] text-slate-400 mt-1 mb-3">エントリー費や係留料、OB寄付金などを記録</p>
                    <button
                      onClick={() => setShowClubTxModal(true)}
                      className="w-full p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-sm transition flex items-center justify-center gap-1.5"
                    >
                      <span>➕</span> 収支レコードを追加
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* カテゴリ別プログレス */}
                  <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                    <div className="flex justify-between items-center">
                      <h2 className="font-black text-xs text-slate-500 uppercase tracking-wider">支出カテゴリ別 内訳</h2>
                      <span className="text-xs font-bold text-slate-700 tabular-nums">総支出: ¥{totalAllExpenses.toLocaleString()}</span>
                    </div>
                    {totalAllExpenses === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-6">支出データはありません</p>
                    ) : (
                      <div className="space-y-3">
                        {Object.entries(categorySpendingMap).map(([cat, amt]) => {
                          const percent = Math.round((amt / totalAllExpenses) * 100);
                          return (
                            <div key={cat} className="space-y-1">
                              <div className="flex justify-between text-xs font-semibold">
                                <span className="text-slate-700">{cat}</span>
                                <span className="text-slate-900 tabular-nums">¥{amt.toLocaleString()} ({percent}%)</span>
                              </div>
                              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                                <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${percent}%` }}></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {/* 直接出納履歴 */}
                  <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                    <h2 className="font-black text-xs text-slate-500 uppercase tracking-wider">部の直接出納履歴</h2>
                    {clubTransactions.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-6">直接出納の記録はありません</p>
                    ) : (
                      clubTransactions.map((tx) => (
                        <div key={tx.id} className="p-3 border border-slate-100 rounded-xl bg-slate-50 flex justify-between items-center">
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
                          <span className={`text-xs font-black tabular-nums ${tx.type === '収入' ? 'text-emerald-600' : 'text-slate-800'}`}>
                            {tx.type === '収入' ? '+' : '-'}¥{tx.amount.toLocaleString()}
                          </span>
                        </div>
                      ))
                    )}
                  </section>
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB 3: 👥 部員別カルテ・サマリー                               */}
            {/* ============================================================== */}
            {activeTab === 'members' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">部員カードをタップすると、これまでの全納入・立替履歴（カルテ）を確認できます。</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {members.map((m) => {
                    const unpaid = getUnpaidTotal(m.id);
                    const unreimbursed = getUnreimbursedTotal(m.id);
                    const canOffset = unpaid > 0 && unreimbursed > 0;

                    return (
                      <div
                        key={m.id}
                        onClick={() => setSelectedMemberDetail(m)}
                        className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm hover:border-blue-400 hover:shadow-md transition cursor-pointer flex flex-col justify-between space-y-3"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-bold text-sm text-slate-900">{m.grade}年 {m.name}</span>
                            <span className="ml-2 text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">{m.role}</span>
                          </div>
                          {canOffset && (
                            <span className="text-[9px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-black border border-amber-200">
                              相殺可
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-100 text-center">
                          <div className="bg-slate-50 p-1.5 rounded-lg">
                            <span className="text-[9px] text-slate-400 block">未納</span>
                            <span className={`text-[11px] font-bold tabular-nums ${unpaid > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                              ¥{unpaid.toLocaleString()}
                            </span>
                          </div>
                          <div className="bg-slate-50 p-1.5 rounded-lg">
                            <span className="text-[9px] text-slate-400 block">立替中</span>
                            <span className={`text-[11px] font-bold tabular-nums ${unreimbursed > 0 ? 'text-blue-600' : 'text-slate-400'}`}>
                              ¥{unreimbursed.toLocaleString()}
                            </span>
                          </div>
                          <div className="bg-slate-50 p-1.5 rounded-lg">
                            <span className="text-[9px] text-slate-400 block">預り金</span>
                            <span className={`text-[11px] font-bold tabular-nums ${m.deposit_balance > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                              ¥{m.deposit_balance.toLocaleString()}
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

      {/* ============================================================== */}
      {/* 下部固定 ボトムナビゲーションバー（ネイティブアプリ風）       */}
      {/* ============================================================== */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 shadow-2xl safe-area-pb">
        <div className="max-w-md mx-auto grid grid-cols-3 h-16">
          <button
            onClick={() => setActiveTab('personal')}
            className={`flex flex-col items-center justify-center gap-1 transition ${
              activeTab === 'personal' ? 'text-blue-600 font-black' : 'text-slate-400 font-medium hover:text-slate-600'
            }`}
          >
            <span className="text-xl">👤</span>
            <span className="text-[11px]">マイページ</span>
          </button>
          <button
            onClick={() => setActiveTab('club')}
            className={`flex flex-col items-center justify-center gap-1 transition ${
              activeTab === 'club' ? 'text-blue-600 font-black' : 'text-slate-400 font-medium hover:text-slate-600'
            }`}
          >
            <span className="text-xl">📊</span>
            <span className="text-[11px]">全体会計</span>
          </button>
          <button
            onClick={() => setActiveTab('members')}
            className={`flex flex-col items-center justify-center gap-1 transition ${
              activeTab === 'members' ? 'text-blue-600 font-black' : 'text-slate-400 font-medium hover:text-slate-600'
            }`}
          >
            <span className="text-xl">👥</span>
            <span className="text-[11px]">部員カルテ</span>
          </button>
        </div>
      </nav>

      {/* ============================================================== */}
      {/* モーダル群                                                     */}
      {/* ============================================================== */}

      {/* レシート画像プレビューモーダル */}
      {previewImageUrl && (
        <div
          onClick={() => setPreviewImageUrl(null)}
          className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 cursor-pointer"
        >
          <div className="max-w-lg w-full bg-transparent flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewImageUrl} alt="拡大レシート" className="max-h-[80vh] w-auto rounded-xl object-contain shadow-2xl" />
            <button className="text-white text-xs bg-white/20 hover:bg-white/30 px-4 py-1.5 rounded-full font-bold">
              タップして閉じる
            </button>
          </div>
        </div>
      )}

      {/* 部員詳細カルテ */}
      {selectedMemberDetail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4 max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-start border-b pb-3">
              <div>
                <h3 className="font-black text-base text-slate-800">
                  {selectedMemberDetail.grade}年 {selectedMemberDetail.name} ({selectedMemberDetail.role})
                </h3>
                <p className="text-xs text-slate-500">デポジット残高: ¥{selectedMemberDetail.deposit_balance.toLocaleString()}</p>
              </div>
              <button onClick={() => setSelectedMemberDetail(null)} className="text-slate-400 hover:text-slate-600 font-bold text-lg">✕</button>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-600">納入履歴</h4>
              {payments.filter((p) => p.member_id === selectedMemberDetail.id).length === 0 ? (
                <p className="text-[11px] text-slate-400">履歴はありません</p>
              ) : (
                payments.filter((p) => p.member_id === selectedMemberDetail.id).map((p) => {
                  const ev = events.find((e) => e.id === p.billing_event_id);
                  return (
                    <div key={p.id} className="p-2.5 bg-slate-50 rounded-xl text-xs flex justify-between items-center">
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
                  <div key={e.id} className="p-2.5 bg-slate-50 rounded-xl text-xs flex justify-between items-center">
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
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl transition"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* 請求作成モーダル */}
      {showEventModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl">
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
                  キャンセル
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 text-xs bg-slate-900 text-white font-bold rounded-xl shadow-md">
                  {isSubmitting ? '作成中...' : '作成する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 立替申請モーダル */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4 shadow-2xl">
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
                <button type="button" onClick={() => setShowExpenseModal(false)} className="flex-1 py-2.5 text-xs border rounded-xl">
                  キャンセル
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 text-xs bg-blue-600 text-white font-bold rounded-xl shadow-md">
                  {isSubmitting ? '送信中...' : '申請する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* デポジット入金モーダル */}
      {showDepositModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-xs space-y-4 shadow-2xl">
            <h3 className="font-black text-base text-slate-800">デポジット入金</h3>
            <form onSubmit={handleAddDeposit} className="space-y-3">
              <div>
                <label className="text-xs text-slate-600 font-medium">入金額</label>
                <input
                  type="number"
                  placeholder="20000"
                  required
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full mt-1 p-2.5 border border-slate-200 rounded-xl text-xs"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowDepositModal(false)} className="flex-1 py-2.5 text-xs border rounded-xl">
                  キャンセル
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 text-xs bg-emerald-600 text-white font-bold rounded-xl shadow-md">
                  {isSubmitting ? '入金中...' : '入金する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 相殺モーダル */}
      {showOffsetModal && selectedExpenseForOffset && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-xs space-y-4 shadow-2xl">
            <h3 className="font-black text-base text-slate-800">立替金を部費へ充当（相殺）</h3>
            <div className="bg-amber-50 p-3 rounded-xl text-xs text-amber-900 border border-amber-200">
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
              <button type="button" onClick={() => setShowOffsetModal(false)} className="flex-1 py-2.5 text-xs border rounded-xl">
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleExecuteOffset}
                disabled={isSubmitting}
                className="flex-1 py-2.5 text-xs bg-amber-500 text-white font-bold rounded-xl shadow-md"
              >
                {isSubmitting ? '処理中...' : '相殺を実行'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 差戻し入力モーダル */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-xs space-y-4 shadow-2xl">
            <h3 className="font-black text-base text-slate-800">立替の差戻し</h3>
            <textarea
              placeholder="例: 私用の買い物代が含まれています。差し引いて再申請してください。"
              value={rejectReasonText}
              onChange={(e) => setRejectReasonText(e.target.value)}
              rows={3}
              className="w-full p-2.5 border border-slate-200 rounded-xl text-xs"
            />
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowRejectModal(false)} className="flex-1 py-2.5 text-xs border rounded-xl">
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleExecuteReject}
                disabled={isSubmitting}
                className="flex-1 py-2.5 text-xs bg-rose-600 text-white font-bold rounded-xl shadow-md"
              >
                {isSubmitting ? '処理中...' : '差戻す'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 部全体の直接出納モーダル */}
      {showClubTxModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4 shadow-2xl">
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
                  キャンセル
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 text-xs bg-slate-900 text-white font-bold rounded-xl shadow-md">
                  {isSubmitting ? '登録中...' : '登録する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

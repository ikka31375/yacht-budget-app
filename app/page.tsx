'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Member, Payment, Expense, BillingEvent, ClubTransaction, OffsetTransaction } from '@/types';

// 洗練された大分類カテゴリ（固定）
const EXPENSE_CATEGORIES = [
  '燃料・交通費',
  '艇体・艤装・修理費',
  '活動費（エントリー・遠征・施設）',
  '消耗品・部室備品',
  'その他',
];

const INCOME_CATEGORIES = [
  'OB・OG寄付金',
  '大学助成金・支援費',
  'その他収入',
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<'personal' | 'club' | 'members'>('personal');
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [clubTransactions, setClubTransactions] = useState<ClubTransaction[]>([]);
  const [offsetTransactions, setOffsetTransactions] = useState<OffsetTransaction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // フィルター
  const [paymentFilter, setPaymentFilter] = useState<'unpaid' | 'paid' | 'all'>('unpaid');
  const [expenseFilter, setExpenseFilter] = useState<'unsettled' | 'settled' | 'all'>('unsettled');

  // モーダル
  const [showEventModal, setShowEventModal] = useState(false);
  const [showEventManageModal, setShowEventManageModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showClubTxModal, setShowClubTxModal] = useState(false);
  const [showOffsetModal, setShowOffsetModal] = useState(false);
  const [showOffsetHistoryModal, setShowOffsetHistoryModal] = useState(false);
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

  // フォーム: 立替申請（画像プレビュー付き）
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [localReceiptPreview, setLocalReceiptPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // フォーム: 部費出納
  const [txType, setTxType] = useState<'支出' | '収入'>('支出');
  const [txTitle, setTxTitle] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [txSource, setTxSource] = useState<'部口座振込' | '部室現金'>('部口座振込');
  const [txEventTag, setTxEventTag] = useState('');

  // フォーム: 相殺
  const [selectedExpenseForOffset, setSelectedExpenseForOffset] = useState<Expense | null>(null);
  const [targetPaymentIdForOffset, setTargetPaymentIdForOffset] = useState<string>('');
  const [offsetCustomAmount, setOffsetCustomAmount] = useState<string>('');

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
    const { data: oData } = await supabase.from('offset_transactions').select('*').order('created_at', { ascending: false });

    if (mData) {
      setMembers(mData);
      if (targetMemberIds.length === 0) setTargetMemberIds(mData.map((m) => m.id));
    }
    if (pData) setPayments(pData);
    if (eData) setExpenses(eData);
    if (bData) setEvents(bData);
    if (cData) setClubTransactions(cData);
    if (oData) setOffsetTransactions(oData);
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
      .filter((e) => e.member_id === memberId && e.status !== '精算済')
      .reduce((sum, e) => {
        const total = e.amount;
        const settled = e.settled_amount || 0;
        return sum + Math.max(0, total - settled);
      }, 0);
  };

  // 全体会計残高計算
  const totalOffsetAmount = offsetTransactions.reduce((sum, o) => sum + o.amount, 0);

  const totalCollectedDues = payments
    .reduce((sum, p) => sum + (p.paid_amount || 0), 0) - totalOffsetAmount;

  const totalClubDonations = clubTransactions
    .filter((t) => t.type === '収入')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalDirectClubExpenses = clubTransactions
    .filter((t) => t.type === '支出')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalReimbursedExpenses = expenses
    .reduce((sum, e) => sum + (e.settled_amount || 0), 0) - totalOffsetAmount;

  const estimatedClubTreasury =
    totalCollectedDues + totalClubDonations - totalDirectClubExpenses - totalReimbursedExpenses;

  const categorySpendingMap: { [cat: string]: number } = {};
  clubTransactions
    .filter((t) => t.type === '支出')
    .forEach((t) => {
      categorySpendingMap[t.category] = (categorySpendingMap[t.category] || 0) + t.amount;
    });
  expenses
    .filter((e) => (e.settled_amount || 0) > 0)
    .forEach((e) => {
      categorySpendingMap[e.category] = (categorySpendingMap[e.category] || 0) + (e.settled_amount || 0);
    });

  const totalAllExpenses = Object.values(categorySpendingMap).reduce((a, b) => a + b, 0);

  // 画像圧縮
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setReceiptFile(file);
      setLocalReceiptPreview(URL.createObjectURL(file));
    }
  };

  const clearSelectedFile = () => {
    setReceiptFile(null);
    setLocalReceiptPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
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

  // 【新機能】請求イベント丸ごと削除（未納のみ許可する安全ガード付き）
  const handleDeleteBillingEvent = async (event: BillingEvent) => {
    const eventPayments = payments.filter((p) => p.billing_event_id === event.id);
    
    // 納入済み・一部納入があるかチェック
    const paidRecords = eventPayments.filter((p) => p.status === '支払済' || p.status === '一部納入' || (p.paid_amount || 0) > 0);
    
    // 相殺に使われているかチェック
    const isUsedInOffset = offsetTransactions.some((o) => eventPayments.some((p) => p.id === o.payment_id));

    if (paidRecords.length > 0 || isUsedInOffset) {
      const paidMemberNames = paidRecords
        .map((p) => members.find((m) => m.id === p.member_id)?.name)
        .filter(Boolean)
        .join('、');

      alert(
        `この請求は削除できません。\n既に納入または相殺を行っている部員（${paidMemberNames || '相殺履歴あり'}）がいます。\n先に「相殺履歴」の取消や「未納に戻す」操作を行ってください。`
      );
      return;
    }

    if (!confirm(`請求「${event.title}」(¥${event.amount.toLocaleString()}) を完全に削除しますか？\n（対象部員の請求レコードも一括削除されます）`)) {
      return;
    }

    setIsSubmitting(true);
    // 紐づく payments を削除
    await supabase.from('payments').delete().eq('billing_event_id', event.id);
    // billing_events を削除
    await supabase.from('billing_events').delete().eq('id', event.id);

    alert(`請求「${event.title}」を削除しました`);
    setIsSubmitting(false);
    fetchData();
  };

  // 【新機能】特定部員の請求個別除外（誤って請求対象に含めてしまった場合の解除）
  const handleDeleteIndividualPayment = async (payment: Payment) => {
    if (payment.status !== '未納' || (payment.paid_amount || 0) > 0) {
      alert('納入済または相殺済みの請求は除外できません。未納に戻してから操作してください。');
      return;
    }

    const ev = events.find((e) => e.id === payment.billing_event_id);
    const mem = members.find((m) => m.id === payment.member_id);

    if (!confirm(`${mem?.name} さんの「${ev?.title}」請求を除外（削除）しますか？`)) {
      return;
    }

    await supabase.from('payments').delete().eq('id', payment.id);
    fetchData();
  };

  // 2. 個人立替申請
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
      settled_amount: 0,
    });

    setExpenseTitle('');
    setExpenseAmount('');
    clearSelectedFile();
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

  // 4. 現金/振込による請求決済・未納リセット
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
      const linkedOffsets = offsetTransactions.filter((o) => o.payment_id === confirmPaymentTarget.id);
      if (linkedOffsets.length > 0) {
        alert('この請求には相殺履歴があります。「相殺履歴」ボタンから相殺を取り消してください。');
        setConfirmPaymentTarget(null);
        setIsSubmitting(false);
        return;
      }

      await supabase
        .from('payments')
        .update({
          status: '未納',
          paid_amount: 0,
          payment_method: '現金/振込',
        })
        .eq('id', confirmPaymentTarget.id);
    }

    setConfirmPaymentTarget(null);
    setIsSubmitting(false);
    fetchData();
  };

  // 5. 相殺実行
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
    const currentSettled = selectedExpenseForOffset.settled_amount || 0;
    const availableExpense = selectedExpenseForOffset.amount - currentSettled;

    const offsetAmount = offsetCustomAmount ? parseInt(offsetCustomAmount, 10) : Math.min(remainingToPay, availableExpense);

    if (isNaN(offsetAmount) || offsetAmount <= 0 || offsetAmount > remainingToPay || offsetAmount > availableExpense) {
      alert('相殺金額が不正です');
      setIsSubmitting(false);
      return;
    }

    const { error: offsetError } = await supabase.from('offset_transactions').insert({
      member_id: selectedExpenseForOffset.member_id,
      payment_id: targetPayment.id,
      expense_id: selectedExpenseForOffset.id,
      amount: offsetAmount,
    });

    if (offsetError) {
      alert('相殺の記録に失敗しました');
      setIsSubmitting(false);
      return;
    }

    const nextPaidAmount = currentPaid + offsetAmount;
    const nextPaymentStatus = nextPaidAmount >= targetEvent.amount ? '支払済' : '一部納入';
    await supabase
      .from('payments')
      .update({
        status: nextPaymentStatus,
        paid_amount: nextPaidAmount,
        payment_method: nextPaymentStatus === '支払済' ? '相殺' : `一部相殺`,
      })
      .eq('id', targetPayment.id);

    const nextSettledAmount = currentSettled + offsetAmount;
    const nextExpenseStatus = nextSettledAmount >= selectedExpenseForOffset.amount ? '精算済' : '一部精算';
    await supabase
      .from('expenses')
      .update({
        status: nextExpenseStatus,
        settled_amount: nextSettledAmount,
      })
      .eq('id', selectedExpenseForOffset.id);

    alert(`¥${offsetAmount.toLocaleString()} を相殺しました`);
    setShowOffsetModal(false);
    setSelectedExpenseForOffset(null);
    setTargetPaymentIdForOffset('');
    setOffsetCustomAmount('');
    setIsSubmitting(false);
    fetchData();
  };

  // 6. 相殺ログ取消
  const handleCancelOffsetTransaction = async (offsetTx: OffsetTransaction) => {
    if (!confirm(`¥${offsetTx.amount.toLocaleString()} の相殺を取り消しますか？\n（部費と立替の双方が元の残高へ戻ります）`)) {
      return;
    }
    setIsSubmitting(true);

    const payment = payments.find((p) => p.id === offsetTx.payment_id);
    const expense = expenses.find((e) => e.id === offsetTx.expense_id);
    const event = events.find((e) => e.id === payment?.billing_event_id);

    if (payment && event) {
      const revertedPaid = Math.max(0, (payment.paid_amount || 0) - offsetTx.amount);
      const nextStatus = revertedPaid === 0 ? '未納' : revertedPaid >= event.amount ? '支払済' : '一部納入';
      await supabase
        .from('payments')
        .update({
          status: nextStatus,
          paid_amount: revertedPaid,
          payment_method: nextStatus === '未納' ? '現金/振込' : payment.payment_method,
        })
        .eq('id', payment.id);
    }

    if (expense) {
      const revertedSettled = Math.max(0, (expense.settled_amount || 0) - offsetTx.amount);
      const nextStatus = revertedSettled === 0 ? '未精算' : revertedSettled >= expense.amount ? '精算済' : '一部精算';
      await supabase
        .from('expenses')
        .update({
          status: nextStatus,
          settled_amount: revertedSettled,
        })
        .eq('id', expense.id);
    }

    await supabase.from('offset_transactions').delete().eq('id', offsetTx.id);

    alert('相殺を取り消しました');
    setIsSubmitting(false);
    fetchData();
  };

  // 7. 現金精算
  const handleCashSettle = async (expense: Expense) => {
    if (!confirm(`「${expense.title}」を現金精算済にしますか？`)) return;
    await supabase
      .from('expenses')
      .update({
        status: '精算済',
        settled_amount: expense.amount,
        reject_reason: '現金精算',
      })
      .eq('id', expense.id);
    fetchData();
  };

  // 8. 立替削除
  const handleDeleteExpense = async (expense: Expense) => {
    if ((expense.settled_amount || 0) > 0) {
      alert('相殺履歴のある立替は削除できません。先に相殺を取り消してください。');
      return;
    }
    if (!confirm(`「${expense.title}」を削除しますか？`)) return;
    await supabase.from('expenses').delete().eq('id', expense.id);
    fetchData();
  };

  // 9. 立替の直接取消
  const handleRevertExpense = async (expense: Expense) => {
    const linkedOffsets = offsetTransactions.filter((o) => o.expense_id === expense.id);
    if (linkedOffsets.length > 0) {
      alert('この立替には相殺履歴があります。「相殺履歴」ボタンから該当の相殺を取り消してください。');
      return;
    }

    if (!confirm(`「${expense.title}」を未精算に戻しますか？`)) return;

    await supabase
      .from('expenses')
      .update({
        status: '未精算',
        settled_amount: 0,
        reject_reason: '',
      })
      .eq('id', expense.id);

    fetchData();
  };

  // CSVダウンロード
  const exportToCSV = () => {
    const header = ['分類', '項目', '対象者/出納元', '品名・使途', '金額', '既納額/充当額', '残額', '状態', '日付'];
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
      const total = e.amount;
      const settled = e.settled_amount || 0;
      rows.push([
        '立替',
        e.category,
        mem?.name || '',
        e.title,
        String(total),
        String(settled),
        String(Math.max(0, total - settled)),
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
    <div className="min-h-screen bg-slate-100 text-slate-800 pb-28 text-sm">
      {/* ヘッダー */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3">
        <div className="w-full flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex justify-between items-center">
            <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>⛵</span> ヨット部 会計
            </h1>
            <div className="flex gap-2">
              <button
                onClick={() => setShowEventManageModal(true)}
                className="text-xs sm:text-sm bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 px-3 py-1.5 rounded-xl font-bold transition"
              >
                請求管理
              </button>
              <button
                onClick={() => setShowOffsetHistoryModal(true)}
                className="text-xs sm:text-sm bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 px-3 py-1.5 rounded-xl font-bold transition"
              >
                相殺履歴
              </button>
              <button
                onClick={exportToCSV}
                className="text-xs sm:text-sm bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl text-slate-700 font-bold transition"
              >
                CSV
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600 font-bold shrink-0">部員:</span>
            <select
              value={selectedMemberId}
              onChange={(e) => handleMemberChange(e.target.value)}
              className="w-full md:w-64 p-2.5 border border-slate-300 rounded-xl bg-white text-sm font-bold text-slate-800 shadow-sm"
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
          <p className="text-sm text-slate-400 text-center py-20 font-medium">読み込み中...</p>
        ) : (
          <>
            {/* TAB 1: マイページ / 個人 */}
            {activeTab === 'personal' && (
              <div className="space-y-4">
                {currentMember ? (
                  <div className="grid grid-cols-2 gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="bg-red-50 p-3.5 rounded-xl border border-red-100">
                      <span className="text-xs sm:text-sm text-red-600 font-bold block mb-1">未納部費</span>
                      <span className="text-xl sm:text-2xl font-black text-red-700 tabular-nums">
                        ¥{getUnpaidTotal(currentMember.id).toLocaleString()}
                      </span>
                    </div>
                    <div className="bg-blue-50 p-3.5 rounded-xl border border-blue-100">
                      <span className="text-xs sm:text-sm text-blue-600 font-bold block mb-1">未精算立替</span>
                      <span className="text-xl sm:text-2xl font-black text-blue-700 tabular-nums">
                        ¥{getUnreimbursedTotal(currentMember.id).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800 text-center font-medium">
                    部員を選択すると個人の申請や残高を確認できます
                  </div>
                )}

                {/* ボタン */}
                <div className="grid grid-cols-2 gap-3">
                  {currentMember ? (
                    <button
                      onClick={() => setShowExpenseModal(true)}
                      className="p-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-2xl font-bold text-sm shadow-md transition flex items-center justify-center gap-2"
                    >
                      <span>📸</span> 立替を申請
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowClubTxModal(true)}
                      className="p-4 bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white rounded-2xl font-bold text-sm shadow-md transition flex items-center justify-center gap-2"
                    >
                      <span>💸</span> 部費の出納を記録
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setTargetMemberIds(members.map((m) => m.id));
                      setShowEventModal(true);
                    }}
                    className="p-4 bg-slate-900 hover:bg-black active:scale-[0.98] text-white rounded-2xl font-bold text-sm shadow-md transition flex items-center justify-center gap-2"
                  >
                    <span>📋</span> 請求を作成
                  </button>
                </div>

                {/* 一覧 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* 請求一覧 */}
                  <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                    <div className="flex justify-between items-center">
                      <h2 className="font-black text-sm text-slate-600 uppercase">
                        {currentMember ? `${currentMember.name}の請求` : '請求状況'}
                      </h2>
                      <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-bold">
                        <button
                          onClick={() => setPaymentFilter('unpaid')}
                          className={`px-2.5 py-1 rounded-md transition ${paymentFilter === 'unpaid' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                        >
                          未納
                        </button>
                        <button
                          onClick={() => setPaymentFilter('paid')}
                          className={`px-2.5 py-1 rounded-md transition ${paymentFilter === 'paid' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                        >
                          支払済
                        </button>
                        <button
                          onClick={() => setPaymentFilter('all')}
                          className={`px-2.5 py-1 rounded-md transition ${paymentFilter === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
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
                      <p className="text-sm text-slate-400 text-center py-6">該当データはありません</p>
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
                              className="p-3.5 border border-slate-100 rounded-xl bg-slate-50 flex justify-between items-center"
                            >
                              <div className="space-y-1">
                                <p className="font-bold text-sm text-slate-800">{ev?.title}</p>
                                <p className="text-xs text-slate-500">
                                  {member?.name} | <span className="font-bold text-slate-700">¥{evAmount.toLocaleString()}</span>
                                </p>
                                {p.status === '一部納入' && (
                                  <p className="text-xs text-amber-700 font-bold">
                                    残: ¥{remainingAmount.toLocaleString()} (納入済: ¥{paidAmount.toLocaleString()})
                                  </p>
                                )}
                                {p.payment_method && p.status !== '未納' && (
                                  <span className="inline-block text-[11px] bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded font-medium">
                                    {p.payment_method}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setConfirmPaymentTarget(p)}
                                  className={`text-xs sm:text-sm px-3.5 py-2 rounded-xl font-bold transition shadow-sm ${
                                    p.status === '支払済'
                                      ? 'bg-green-100 text-green-700 border border-green-300'
                                      : p.status === '一部納入'
                                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                      : 'bg-red-50 text-red-600 border border-red-200'
                                  }`}
                                >
                                  {p.status === '一部納入' ? `残 ¥${remainingAmount.toLocaleString()}` : p.status}
                                </button>

                                {/* 未納の場合のみ、個別に請求除外できるボタン */}
                                {p.status === '未納' && paidAmount === 0 && (
                                  <button
                                    onClick={() => handleDeleteIndividualPayment(p)}
                                    title="この部員の請求を除外"
                                    className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                    )}
                  </section>

                  {/* 立替一覧 */}
                  <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                    <div className="flex justify-between items-center">
                      <h2 className="font-black text-sm text-slate-600 uppercase">
                        {currentMember ? `${currentMember.name}の立替` : '立替一覧'}
                      </h2>
                      <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-bold">
                        <button
                          onClick={() => setExpenseFilter('unsettled')}
                          className={`px-2.5 py-1 rounded-md transition ${expenseFilter === 'unsettled' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                        >
                          未精算
                        </button>
                        <button
                          onClick={() => setExpenseFilter('settled')}
                          className={`px-2.5 py-1 rounded-md transition ${expenseFilter === 'settled' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                        >
                          精算済
                        </button>
                        <button
                          onClick={() => setExpenseFilter('all')}
                          className={`px-2.5 py-1 rounded-md transition ${expenseFilter === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                        >
                          すべて
                        </button>
                      </div>
                    </div>

                    {expenses
                      .filter((e) => !currentMember || e.member_id === currentMember.id)
                      .filter((e) => {
                        if (expenseFilter === 'unsettled') return e.status !== '精算済';
                        if (expenseFilter === 'settled') return e.status === '精算済';
                        return true;
                      })
                      .length === 0 ? (
                      <p className="text-sm text-slate-400 text-center py-6">該当データはありません</p>
                    ) : (
                      expenses
                        .filter((e) => !currentMember || e.member_id === currentMember.id)
                        .filter((e) => {
                          if (expenseFilter === 'unsettled') return e.status !== '精算済';
                          if (expenseFilter === 'settled') return e.status === '精算済';
                          return true;
                        })
                        .map((e) => {
                          const member = members.find((m) => m.id === e.member_id);
                          const memberUnpaid = payments.filter((p) => p.member_id === e.member_id && p.status !== '支払済');
                          const currentSettled = e.settled_amount || 0;
                          const remainingExpense = Math.max(0, e.amount - currentSettled);
                          const canOffset = memberUnpaid.length > 0 && remainingExpense > 0;

                          return (
                            <div key={e.id} className="p-3.5 border border-slate-100 rounded-xl bg-slate-50 space-y-3">
                              <div className="flex gap-3 items-center">
                                {e.receipt_url ? (
                                  <div
                                    onClick={() => setPreviewImageUrl(e.receipt_url || null)}
                                    className="w-16 h-16 rounded-xl bg-slate-200 shrink-0 overflow-hidden border border-slate-200 cursor-pointer"
                                  >
                                    <img
                                      src={e.receipt_url}
                                      alt="レシート"
                                      className="w-full h-full object-cover"
                                    />
                                  </div>
                                ) : (
                                  <div className="w-16 h-16 rounded-xl bg-slate-100 shrink-0 border border-slate-200 flex flex-col items-center justify-center text-slate-400 text-xs font-bold">
                                    <span>📄</span>
                                    <span>写真無</span>
                                  </div>
                                )}

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-md font-bold">
                                      {e.category}
                                    </span>
                                    <span className="text-xs text-slate-500 font-medium">{member?.name}</span>
                                  </div>
                                  <p className="font-bold text-sm text-slate-900 truncate mt-1">{e.title}</p>
                                  <p className="text-base font-black text-slate-900 tabular-nums">
                                    ¥{e.amount.toLocaleString()}
                                    {e.status === '一部精算' && (
                                      <span className="text-xs text-amber-700 font-bold ml-2">
                                        (残 ¥{remainingExpense.toLocaleString()})
                                      </span>
                                    )}
                                  </p>
                                </div>

                                <div className="shrink-0 text-right">
                                  <span
                                    className={`text-xs px-2.5 py-1 rounded-lg font-black ${
                                      e.status === '精算済'
                                        ? 'bg-slate-200 text-slate-600'
                                        : e.status === '一部精算'
                                        ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                        : 'bg-blue-100 text-blue-800 border border-blue-200'
                                    }`}
                                  >
                                    {e.status}
                                  </span>
                                </div>
                              </div>

                              {e.reject_reason && (
                                <div className="p-2.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                                  {e.reject_reason}
                                </div>
                              )}

                              {e.status !== '精算済' && (
                                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200">
                                  <button
                                    onClick={() => {
                                      if (!canOffset) return;
                                      setSelectedExpenseForOffset(e);
                                      setTargetPaymentIdForOffset(memberUnpaid[0].id);
                                      setOffsetCustomAmount('');
                                      setShowOffsetModal(true);
                                    }}
                                    disabled={!canOffset}
                                    className={`py-2 text-xs font-bold rounded-xl transition ${
                                      canOffset
                                        ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm'
                                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                    }`}
                                  >
                                    相殺
                                  </button>

                                  <button
                                    onClick={() => handleCashSettle(e)}
                                    className="py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition shadow-sm"
                                  >
                                    現金精算
                                  </button>

                                  <button
                                    onClick={() => handleDeleteExpense(e)}
                                    className="py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-bold rounded-xl transition"
                                  >
                                    削除
                                  </button>
                                </div>
                              )}

                              {e.status === '精算済' && (
                                <div className="flex justify-end pt-1">
                                  <button
                                    onClick={() => handleRevertExpense(e)}
                                    className="text-xs text-slate-400 hover:text-slate-600 font-medium underline"
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
                  <div className="md:col-span-2 bg-slate-900 text-white p-6 rounded-3xl shadow-lg space-y-4">
                    <span className="text-sm text-slate-400 font-medium">部の手元資金（部口座＋部室現金）</span>
                    <div className="text-3xl sm:text-4xl font-black tabular-nums tracking-tight">
                      ¥{estimatedClubTreasury.toLocaleString()}
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-800 text-sm">
                      <div>
                        <span className="text-slate-400 text-xs block">現金の総入金（部費+寄付）</span>
                        <span className="font-bold text-emerald-400 tabular-nums text-base">
                          +¥{(totalCollectedDues + totalClubDonations).toLocaleString()}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-xs block">現金の総出金（部支出+精算）</span>
                        <span className="font-bold text-rose-400 tabular-nums text-base">
                          -¥{(totalDirectClubExpenses + totalReimbursedExpenses).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-center">
                    <p className="text-sm text-slate-700 font-bold">部費出納</p>
                    <p className="text-xs text-slate-400 mt-1 mb-4">エントリー費・係留料・寄付など</p>
                    <button
                      onClick={() => setShowClubTxModal(true)}
                      className="w-full p-3.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold text-sm transition shadow-sm"
                    >
                      出納を記録
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <section className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                    <div className="flex justify-between items-center">
                      <h2 className="font-black text-sm text-slate-600 uppercase">支出カテゴリ別</h2>
                      <span className="text-sm font-bold text-slate-800 tabular-nums">
                        計: ¥{totalAllExpenses.toLocaleString()}
                      </span>
                    </div>
                    {totalAllExpenses === 0 ? (
                      <p className="text-sm text-slate-400 text-center py-6">データはありません</p>
                    ) : (
                      <div className="space-y-3">
                        {Object.entries(categorySpendingMap).map(([cat, amt]) => {
                          const percent = Math.round((amt / totalAllExpenses) * 100);
                          return (
                            <div key={cat} className="space-y-1">
                              <div className="flex justify-between text-xs sm:text-sm font-semibold">
                                <span className="text-slate-700">{cat}</span>
                                <span className="text-slate-900 tabular-nums">
                                  ¥{amt.toLocaleString()} ({percent}%)
                                </span>
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

                  <section className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                    <h2 className="font-black text-sm text-slate-600 uppercase">支出明細</h2>
                    <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                      {clubTransactions
                        .filter((t) => t.type === '支出')
                        .map((t) => (
                          <div key={t.id} className="p-3.5 border border-slate-100 rounded-xl bg-slate-50 flex justify-between items-center">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-md font-bold">
                                  部費出納
                                </span>
                                <span className="text-sm font-bold text-slate-800">{t.title}</span>
                              </div>
                              <p className="text-xs text-slate-500 mt-1">
                                {t.category} | {t.payment_source}
                              </p>
                            </div>
                            <span className="text-sm font-black tabular-nums text-slate-800">
                              -¥{t.amount.toLocaleString()}
                            </span>
                          </div>
                        ))}

                      {expenses
                        .filter((e) => (e.settled_amount || 0) > 0)
                        .map((e) => {
                          const mem = members.find((m) => m.id === e.member_id);
                          return (
                            <div key={e.id} className="p-3.5 border border-slate-100 rounded-xl bg-slate-50 flex justify-between items-center">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md font-bold">
                                    立替充当・精算
                                  </span>
                                  <span className="text-sm font-bold text-slate-800">{e.title}</span>
                                </div>
                                <p className="text-xs text-slate-500 mt-1">
                                  {e.category} | {mem?.name}
                                </p>
                              </div>
                              <span className="text-sm font-black tabular-nums text-slate-800">
                                -¥{(e.settled_amount || 0).toLocaleString()}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </section>
                </div>
              </div>
            )}

            {/* TAB 3: 部員一覧 */}
            {activeTab === 'members' && (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">部員を選択すると個別の履歴を確認できます</p>
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
                            <span className="font-bold text-base text-slate-900">
                              {m.grade}年 {m.name}
                            </span>
                            <span className="ml-2 text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
                              {m.role}
                            </span>
                          </div>
                          {canOffset && (
                            <span className="text-[11px] bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-full font-black border border-amber-200">
                              相殺可
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-center">
                          <div className="bg-slate-50 p-2.5 rounded-xl">
                            <span className="text-xs text-slate-400 block font-medium">未納部費</span>
                            <span
                              className={`text-sm sm:text-base font-bold tabular-nums ${
                                unpaid > 0 ? 'text-red-600' : 'text-slate-400'
                              }`}
                            >
                              ¥{unpaid.toLocaleString()}
                            </span>
                          </div>
                          <div className="bg-slate-50 p-2.5 rounded-xl">
                            <span className="text-xs text-slate-400 block font-medium">未精算立替</span>
                            <span
                              className={`text-sm sm:text-base font-bold tabular-nums ${
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
            <span className="text-2xl">👤</span>
            <span className="text-xs">マイページ</span>
          </button>
          <button
            onClick={() => setActiveTab('club')}
            className={`flex flex-col items-center justify-center gap-1 transition ${
              activeTab === 'club' ? 'text-blue-600 font-black' : 'text-slate-400 font-medium'
            }`}
          >
            <span className="text-2xl">📊</span>
            <span className="text-xs">全体会計</span>
          </button>
          <button
            onClick={() => setActiveTab('members')}
            className={`flex flex-col items-center justify-center gap-1 transition ${
              activeTab === 'members' ? 'text-blue-600 font-black' : 'text-slate-400 font-medium'
            }`}
          >
            <span className="text-2xl">👥</span>
            <span className="text-xs">部員一覧</span>
          </button>
        </div>
      </nav>

      {/* モーダル: 請求イベント管理（★ 請求一括削除機能） */}
      {showEventManageModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-md space-y-4 max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-black text-base text-slate-800">請求イベント管理</h3>
                <p className="text-xs text-slate-400">作成した部費・集金イベントの確認と削除</p>
              </div>
              <button onClick={() => setShowEventManageModal(false)} className="text-slate-400 font-bold text-lg">
                ✕
              </button>
            </div>

            {events.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">作成された請求はありません</p>
            ) : (
              <div className="space-y-3">
                {events.map((ev) => {
                  const evPayments = payments.filter((p) => p.billing_event_id === ev.id);
                  const paidCount = evPayments.filter((p) => p.status === '支払済' || p.status === '一部納入' || (p.paid_amount || 0) > 0).length;
                  const canDelete = paidCount === 0;

                  return (
                    <div key={ev.id} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold text-sm text-slate-900">{ev.title}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            期日: {ev.due_date} | 請求対象: {evPayments.length}名
                          </p>
                        </div>
                        <span className="text-sm font-black text-slate-800 tabular-nums">
                          ¥{ev.amount.toLocaleString()}
                        </span>
                      </div>

                      <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                        <span className={`text-xs font-bold ${canDelete ? 'text-slate-500' : 'text-emerald-700'}`}>
                          {canDelete ? '未納 100% (削除可)' : `${paidCount}名が納入・相殺済`}
                        </span>

                        <button
                          onClick={() => handleDeleteBillingEvent(ev)}
                          disabled={!canDelete || isSubmitting}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 ${
                            canDelete
                              ? 'bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200'
                              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                          }`}
                        >
                          <span>🗑️</span> 請求を削除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => setShowEventManageModal(false)}
              className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm rounded-xl"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* モーダル: 相殺履歴一覧 */}
      {showOffsetHistoryModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-md space-y-4 max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-black text-base text-slate-800">相殺履歴一覧</h3>
              <button onClick={() => setShowOffsetHistoryModal(false)} className="text-slate-400 font-bold text-lg">
                ✕
              </button>
            </div>

            {offsetTransactions.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">相殺履歴はありません</p>
            ) : (
              <div className="space-y-2">
                {offsetTransactions
                  .filter((o) => !currentMember || o.member_id === currentMember.id)
                  .map((o) => {
                    const member = members.find((m) => m.id === o.member_id);
                    const payment = payments.find((p) => p.id === o.payment_id);
                    const event = events.find((e) => e.id === payment?.billing_event_id);
                    const expense = expenses.find((e) => e.id === o.expense_id);

                    return (
                      <div key={o.id} className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm flex justify-between items-center">
                        <div className="space-y-1">
                          <p className="font-bold text-slate-800">{member?.name} | ¥{o.amount.toLocaleString()}</p>
                          <p className="text-xs text-slate-500">部費: {event?.title}</p>
                          <p className="text-xs text-slate-500">立替: {expense?.title}</p>
                        </div>
                        <button
                          onClick={() => handleCancelOffsetTransaction(o)}
                          disabled={isSubmitting}
                          className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-bold rounded-lg transition"
                        >
                          取消
                        </button>
                      </div>
                    );
                  })}
              </div>
            )}

            <button
              onClick={() => setShowOffsetHistoryModal(false)}
              className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm rounded-xl"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

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
                  <div className="p-3.5 bg-slate-50 rounded-xl text-sm space-y-1">
                    <p className="font-bold text-slate-800">{ev?.title}</p>
                    <p className="text-slate-600">対象: {mem?.name}</p>
                    <p className="text-slate-600 font-bold">請求額: ¥{totalAmount.toLocaleString()}</p>
                    {confirmPaymentTarget.status === '一部納入' && (
                      <p className="text-amber-700 font-bold">残額: ¥{remainingAmount.toLocaleString()}</p>
                    )}
                  </div>

                  {isClearing && (
                    <div>
                      <label className="text-xs text-slate-600 font-bold block mb-1">納入方法</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmPaymentMethod('振込')}
                          className={`py-2 text-xs font-bold rounded-xl border ${
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
                          className={`py-2 text-xs font-bold rounded-xl border ${
                            confirmPaymentMethod === '現金'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-slate-700 border-slate-200'
                          }`}
                        >
                          現金手渡し
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setConfirmPaymentTarget(null)}
                      className="flex-1 py-2.5 text-xs font-bold border border-slate-200 rounded-xl"
                    >
                      戻る
                    </button>
                    <button
                      type="button"
                      onClick={executePaymentStatusChange}
                      disabled={isSubmitting}
                      className="flex-1 py-2.5 text-xs bg-slate-900 text-white font-bold rounded-xl shadow-md"
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

      {/* モーダル: レシート拡大画像 */}
      {previewImageUrl && (
        <div
          onClick={() => setPreviewImageUrl(null)}
          className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50 cursor-pointer"
        >
          <img src={previewImageUrl} alt="レシート" className="max-h-[85vh] w-auto rounded-2xl object-contain shadow-2xl" />
        </div>
      )}

      {/* モーダル: 部員カルテ */}
      {selectedMemberDetail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4 max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-start border-b pb-3">
              <h3 className="font-black text-lg text-slate-800">
                {selectedMemberDetail.grade}年 {selectedMemberDetail.name} ({selectedMemberDetail.role})
              </h3>
              <button onClick={() => setSelectedMemberDetail(null)} className="text-slate-400 hover:text-slate-600 font-bold text-xl">
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-bold text-slate-700">納入履歴</h4>
              {payments.filter((p) => p.member_id === selectedMemberDetail.id).length === 0 ? (
                <p className="text-xs text-slate-400">データはありません</p>
              ) : (
                payments
                  .filter((p) => p.member_id === selectedMemberDetail.id)
                  .map((p) => {
                    const ev = events.find((e) => e.id === p.billing_event_id);
                    return (
                      <div key={p.id} className="p-3 bg-slate-50 rounded-xl text-xs flex justify-between items-center">
                        <div>
                          <p className="font-bold text-slate-800">{ev?.title}</p>
                          <p className="text-[11px] text-slate-500">
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

              <h4 className="text-sm font-bold text-slate-700 pt-2">立替履歴</h4>
              {expenses.filter((e) => e.member_id === selectedMemberDetail.id).length === 0 ? (
                <p className="text-xs text-slate-400">データはありません</p>
              ) : (
                expenses
                  .filter((e) => e.member_id === selectedMemberDetail.id)
                  .map((e) => (
                    <div key={e.id} className="p-3 bg-slate-50 rounded-xl text-xs flex justify-between items-center">
                      <div>
                        <p className="font-bold text-slate-800">
                          {e.title} (¥{e.amount.toLocaleString()})
                        </p>
                        <p className="text-[11px] text-slate-500">{e.category}</p>
                      </div>
                      <span className="font-bold text-slate-600">{e.status}</span>
                    </div>
                  ))
              )}
            </div>

            <button
              onClick={() => setSelectedMemberDetail(null)}
              className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm rounded-xl"
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
            <h3 className="font-black text-lg text-slate-800">新規請求の作成</h3>
            <form onSubmit={handleCreateBillingEvent} className="space-y-3.5">
              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1">請求タイトル</label>
                <input
                  type="text"
                  placeholder="例: 10月度部費、合宿費"
                  required
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1">金額 (1人あたり)</label>
                <input
                  type="number"
                  placeholder="5000"
                  required
                  value={eventAmount}
                  onChange={(e) => setEventAmount(e.target.value)}
                  className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1">支払期日</label>
                <input
                  type="date"
                  value={eventDueDate}
                  onChange={(e) => setEventDueDate(e.target.value)}
                  className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs text-slate-600 font-bold">対象部員 ({targetMemberIds.length}名)</label>
                  <button
                    type="button"
                    onClick={() => {
                      if (targetMemberIds.length === members.length) setTargetMemberIds([]);
                      else setTargetMemberIds(members.map((m) => m.id));
                    }}
                    className="text-xs text-blue-600 underline font-bold"
                  >
                    全選択/解除
                  </button>
                </div>
                <div className="max-h-32 overflow-y-auto border border-slate-100 rounded-xl p-2 space-y-1 bg-slate-50">
                  {members.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer p-1">
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
                <button type="button" onClick={() => setShowEventModal(false)} className="flex-1 py-3 text-xs font-bold border rounded-xl">
                  戻る
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-3 text-xs bg-slate-900 text-white font-bold rounded-xl shadow-md">
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
            <h3 className="font-black text-lg text-slate-800">立替金の申請</h3>
            <form onSubmit={handleCreateExpense} className="space-y-3.5">
              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1">用途・品名</label>
                <input
                  type="text"
                  placeholder="例: レスキュー艇給油代"
                  required
                  value={expenseTitle}
                  onChange={(e) => setExpenseTitle(e.target.value)}
                  className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1">金額</label>
                <input
                  type="number"
                  placeholder="3000"
                  required
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1">カテゴリ</label>
                <select
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value)}
                  className="w-full p-3 border border-slate-200 rounded-xl text-sm font-semibold"
                >
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1.5">レシート写真（任意）</label>
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {localReceiptPreview ? (
                  <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 p-2 flex items-center gap-3">
                    <img
                      src={localReceiptPreview}
                      alt="プレビュー"
                      className="w-16 h-16 object-cover rounded-xl border border-slate-200 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{receiptFile?.name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">添付完了</p>
                    </div>
                    <button
                      type="button"
                      onClick={clearSelectedFile}
                      className="w-8 h-8 rounded-full bg-slate-200 hover:bg-rose-100 hover:text-rose-600 text-slate-600 flex items-center justify-center font-bold text-sm transition shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50/50 rounded-2xl p-4 text-center cursor-pointer transition space-y-1 bg-slate-50/50"
                  >
                    <span className="text-2xl block">📸</span>
                    <p className="text-xs font-bold text-slate-700">タップして撮影 / 写真を選択</p>
                    <p className="text-[11px] text-slate-400">自動でファイルサイズを最適化します</p>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowExpenseModal(false)} className="flex-1 py-3 text-xs font-bold border rounded-xl">
                  戻る
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-3 text-xs bg-blue-600 text-white font-bold rounded-xl shadow-md">
                  申請する
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
            <h3 className="font-black text-lg text-slate-800">部費出納の記録</h3>
            <form onSubmit={handleCreateClubTransaction} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setTxType('支出');
                    setTxCategory(EXPENSE_CATEGORIES[0]);
                  }}
                  className={`py-2 rounded-lg ${txType === '支出' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-600'}`}
                >
                  支出
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTxType('収入');
                    setTxCategory(INCOME_CATEGORIES[0]);
                  }}
                  className={`py-2 rounded-lg ${txType === '収入' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-600'}`}
                >
                  収入
                </button>
              </div>

              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1">品名・内容</label>
                <input
                  type="text"
                  placeholder={txType === '支出' ? '例: インカレ参加料' : '例: OB〇〇先輩からの寄付'}
                  required
                  value={txTitle}
                  onChange={(e) => setTxTitle(e.target.value)}
                  className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1">金額</label>
                <input
                  type="number"
                  placeholder="50000"
                  required
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1">カテゴリ</label>
                <select
                  value={txCategory}
                  onChange={(e) => setTxCategory(e.target.value)}
                  className="w-full p-3 border border-slate-200 rounded-xl text-sm font-semibold"
                >
                  {(txType === '支出' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-600 font-bold block mb-1">出納元</label>
                  <select
                    value={txSource}
                    onChange={(e) => setTxSource(e.target.value as any)}
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-semibold"
                  >
                    <option value="部口座振込">部口座振込</option>
                    <option value="部室現金">部室現金</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-600 font-bold block mb-1">タグ (任意)</label>
                  <input
                    type="text"
                    placeholder="例: 秋インカレ"
                    value={txEventTag}
                    onChange={(e) => setTxEventTag(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowClubTxModal(false)} className="flex-1 py-3 text-xs font-bold border rounded-xl">
                  戻る
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-3 text-xs bg-slate-900 text-white font-bold rounded-xl shadow-md">
                  登録する
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
            <h3 className="font-black text-lg text-slate-800">立替金を部費へ相殺</h3>
            <div className="bg-amber-50 p-3.5 rounded-xl text-xs text-amber-900 border border-amber-200 space-y-1">
              <p>立替: <span className="font-bold">{selectedExpenseForOffset.title}</span></p>
              <p className="font-black text-sm">
                充当可能額: ¥{(selectedExpenseForOffset.amount - (selectedExpenseForOffset.settled_amount || 0)).toLocaleString()}
              </p>
            </div>

            <div>
              <label className="text-xs text-slate-600 font-bold block mb-1">充当先の未納請求</label>
              <select
                value={targetPaymentIdForOffset}
                onChange={(e) => setTargetPaymentIdForOffset(e.target.value)}
                className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-semibold"
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

            <div>
              <label className="text-xs text-slate-600 font-bold block mb-1">相殺金額 (未入力で最大額)</label>
              <input
                type="number"
                placeholder="例: 3000"
                value={offsetCustomAmount}
                onChange={(e) => setOffsetCustomAmount(e.target.value)}
                className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-semibold"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowOffsetModal(false)} className="flex-1 py-3 text-xs font-bold border rounded-xl">
                戻る
              </button>
              <button
                type="button"
                onClick={handleExecuteOffset}
                disabled={isSubmitting}
                className="flex-1 py-3 text-xs bg-amber-500 text-white font-bold rounded-xl shadow-md"
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

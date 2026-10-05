'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Member, Payment, Expense, BillingEvent, ClubTransaction, OffsetTransaction } from '@/types';
import { calculateAccounting, createCsv, errorMessage, japanDate, MAX_AMOUNT, parseAmount, parseDate, paymentDate, expenseSettlementDate, transactionDate, type CashEntry } from '@/lib/accounting';
import AccountingReport from '@/components/AccountingReport';
import RecordDateEditor, {type DateEditTarget} from '@/components/RecordDateEditor';
import { fetchClubData, saveClubOperation } from '@/lib/data';

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
  const [dataError, setDataError] = useState<string | null>(null);

  // フィルター
  const [paymentFilter, setPaymentFilter] = useState<'unpaid' | 'paid' | 'all'>('unpaid');
  const [expenseFilter, setExpenseFilter] = useState<'unsettled' | 'settled' | 'all'>('unsettled');
  const [dateEditTarget, setDateEditTarget] = useState<DateEditTarget | null>(null);
  const [cashSettleTarget, setCashSettleTarget] = useState<Expense | null>(null);
  const [cashSettleDate, setCashSettleDate] = useState(japanDate());
  const [paidOn, setPaidOn] = useState(japanDate());
  const [expenseDate, setExpenseDate] = useState(japanDate());
  const [txDate, setTxDate] = useState(japanDate());

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
  const [receiptTarget, setReceiptTarget] = useState<Expense | null>(null);
  const uploadedReceiptRef = useRef<{ file: File; url: string } | null>(null);

  // フォーム: 部費出納
  const [txType, setTxType] = useState<'支出' | '収入'>('支出');
  const [txTitle, setTxTitle] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [txSource, setTxSource] = useState<ClubTransaction['payment_source']>('部口座振込');
  const [txEventTag, setTxEventTag] = useState('');

  // フォーム: 相殺（自動MAX初期値）
  const [selectedExpenseForOffset, setSelectedExpenseForOffset] = useState<Expense | null>(null);
  const [targetPaymentIdForOffset, setTargetPaymentIdForOffset] = useState<string>('');
  const [offsetCustomAmount, setOffsetCustomAmount] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const loadVersionRef = useRef(0);
  const creationIdsRef = useRef<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    const version = ++loadVersionRef.current;
    setLoading(true);
    try {
      const data = await fetchClubData();
      if (version !== loadVersionRef.current) return;
      setMembers(data.members.sort((a, b) => Number(a.is_active === false) - Number(b.is_active === false) || a.grade - b.grade || a.name.localeCompare(b.name, 'ja')));
      setPayments(data.payments);
      const newest = (a: { created_at?: string }, b: { created_at?: string }) => (b.created_at || '').localeCompare(a.created_at || '');
      setExpenses(data.expenses.sort(newest));
      setEvents(data.events.sort(newest));
      setClubTransactions(data.clubTransactions.sort(newest));
      setOffsetTransactions(data.offsetTransactions.sort(newest));
      setSelectedMemberId(current => data.members.some(member => member.id === current) ? current : '');
      setDataError(null);
    } catch (error) {
      if (version === loadVersionRef.current) setDataError(errorMessage(error));
    } finally {
      if (version === loadVersionRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const versionRef = loadVersionRef;
    void Promise.resolve().then(async () => {
      if (!active) return;
      try { setSelectedMemberId(localStorage.getItem('selectedMemberId') || ''); } catch { /* Storage may be disabled. */ }
      await fetchData();
    });
    return () => { active = false; versionRef.current++; };
  }, [fetchData]);

  useEffect(() => {
    return () => { if (localReceiptPreview) URL.revokeObjectURL(localReceiptPreview); };
  }, [localReceiptPreview]);

  const handleMemberChange = (id: string) => {
    setSelectedMemberId(id);
    try { localStorage.setItem('selectedMemberId', id); } catch { /* Selection still works without storage. */ }
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

  const accounting = calculateAccounting({ members, payments, expenses, events, clubTransactions, offsetTransactions });
  const activeMembers = members.filter(m => m.is_active !== false);
  const actionsDisabled = loading || isSubmitting || !!dataError || accounting.issues.length > 0;

  const runOperation = async (action: () => Promise<void>) => {
    if (submittingRef.current || loading || dataError || accounting.issues.length > 0) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await action();
      await fetchData();
    } catch (error) {
      alert(errorMessage(error));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const creationId = (operation: string) => {
    creationIdsRef.current[operation] ||= crypto.randomUUID();
    return creationIdsRef.current[operation];
  };

  // Revoke temporary image URLs on every success/error path.
  const compressImage = (file: File): Promise<Blob> => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('画像を処理できませんでした。');
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('画像を圧縮できませんでした。')), 'image/jpeg', 0.8);
      } catch (error) { reject(error); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('写真を読み込めませんでした。別の写真を選択してください。')); };
    img.src = url;
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) { alert('画像ファイルを選択してください。'); return; }
      setReceiptFile(file);
      setLocalReceiptPreview(URL.createObjectURL(file));
      uploadedReceiptRef.current = null;
    }
  };

  const clearSelectedFile = () => {
    setReceiptFile(null);
    setLocalReceiptPreview(null);
    uploadedReceiptRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadReceipt = async (file: File) => {
    if (uploadedReceiptRef.current?.file === file) return uploadedReceiptRef.current.url;
    const blob = await compressImage(file);
    const name = `${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from('receipts').upload(name, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(`写真の保存に失敗しました。申請は確定していません。写真と入力を残していますので再試行してください。\n${errorMessage(error)}`);
    const { data } = supabase.storage.from('receipts').getPublicUrl(name);
    uploadedReceiptRef.current = { file, url: data.publicUrl };
    return data.publicUrl;
  };

  // 相殺モーダルを開く際の自動MAX計算
  const openOffsetModalForExpense = (expense: Expense) => {
    setSelectedExpenseForOffset(expense);
    const memberUnpaid = payments.filter((p) => p.member_id === expense.member_id && p.status !== '支払済');
    setTargetPaymentIdForOffset('');
    setOffsetCustomAmount('');
    if (memberUnpaid.length > 0) {
      const firstTarget = memberUnpaid[0];
      setTargetPaymentIdForOffset(firstTarget.id);
      const ev = events.find((e) => e.id === firstTarget.billing_event_id);
      const remainingPayment = (ev?.amount || 0) - (firstTarget.paid_amount || 0);
      const remainingExpense = expense.amount - (expense.settled_amount || 0);
      const maxVal = Math.min(remainingPayment, remainingExpense);
      setOffsetCustomAmount(String(maxVal));
    }
    setShowOffsetModal(true);
  };

  // 相殺充当先の変更時にMAX額を自動再セット
  const handleTargetPaymentChange = (paymentId: string) => {
    setTargetPaymentIdForOffset(paymentId);
    if (selectedExpenseForOffset) {
      const targetP = payments.find((p) => p.id === paymentId);
      const ev = events.find((e) => e.id === targetP?.billing_event_id);
      const remainingPayment = (ev?.amount || 0) - (targetP?.paid_amount || 0);
      const remainingExpense = selectedExpenseForOffset.amount - (selectedExpenseForOffset.settled_amount || 0);
      const maxVal = Math.min(remainingPayment, remainingExpense);
      setOffsetCustomAmount(String(maxVal));
    }
  };

  const handleCreateBillingEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    await runOperation(async () => {
      const amount = parseAmount(eventAmount);
      if (!eventTitle.trim() || targetMemberIds.length === 0) throw new Error('請求名と対象部員を入力してください。');
      await saveClubOperation('create_billing', {
        id: creationId('billing'), title: eventTitle.trim(), amount,
        due_date: eventDueDate || japanDate(), member_ids: targetMemberIds,
      });
      delete creationIdsRef.current.billing;
      setEventTitle(''); setEventAmount(''); setEventDueDate(''); setShowEventModal(false);
    });
  };

  const handleDeleteBillingEvent = async (event: BillingEvent) => {
    if (!confirm(`請求「${event.title}」を削除しますか？納入・相殺がある請求は削除できません。`)) return;
    await runOperation(() => saveClubOperation('delete_billing', { id: event.id }));
  };

  const handleDeleteIndividualPayment = async (payment: Payment) => {
    const event = events.find(e => e.id === payment.billing_event_id);
    const member = members.find(m => m.id === payment.member_id);
    if (!confirm(`${member?.name} さんの「${event?.title}」を請求対象から除外しますか？`)) return;
    await runOperation(() => saveClubOperation('delete_payment', { id: payment.id }));
  };

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    await runOperation(async () => {
      // Validate before uploading; keep the uploaded URL when only the database save fails.
      const amount = receiptTarget ? receiptTarget.amount : parseAmount(expenseAmount);
      if (!receiptTarget && (!selectedMemberId || !expenseTitle.trim())) throw new Error('部員と用途・品名を入力してください。');
      if (receiptTarget && !receiptFile) throw new Error('添付する写真を選択してください。');
      const receiptUrl = receiptFile ? await uploadReceipt(receiptFile) : '';
      if (receiptTarget) {
        await saveClubOperation('attach_receipt', { id: receiptTarget.id, receipt_url: receiptUrl, expected_receipt_url: receiptTarget.receipt_url || '' });
      } else {
        await saveClubOperation('create_expense', {
          id: creationId('expense'), member_id: selectedMemberId, title: expenseTitle.trim(),
          amount, category: expenseCategory, receipt_url: receiptUrl, incurred_on: parseDate(expenseDate),
        });
        delete creationIdsRef.current.expense;
      }
      setExpenseTitle(''); setExpenseAmount(''); clearSelectedFile();
      setReceiptTarget(null); setShowExpenseModal(false);
    });
  };

  const handleCreateClubTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    await runOperation(async () => {
      const amount = parseAmount(txAmount);
      if (!txTitle.trim()) throw new Error('品名・内容を入力してください。');
      await saveClubOperation('create_club_transaction', {
        id: creationId('club'), type: txType, title: txTitle.trim(), amount,
        transaction_date: parseDate(txDate), category: txCategory, payment_source: txSource, event_tag: txEventTag.trim() || null,
      });
      delete creationIdsRef.current.club;
      setTxTitle(''); setTxAmount(''); setTxEventTag(''); setShowClubTxModal(false);
    });
  };

  const executePaymentStatusChange = async () => {
    if (!confirmPaymentTarget) return;
    await runOperation(async () => {
      await saveClubOperation('set_payment', {
        id: confirmPaymentTarget.id, expected_paid: confirmPaymentTarget.paid_amount || 0,
        clear: confirmPaymentTarget.status !== '支払済', method: confirmPaymentMethod, paid_on: confirmPaymentTarget.status !== '支払済' ? parseDate(paidOn) : null,
      });
      setConfirmPaymentTarget(null);
    });
  };

  const handleExecuteOffset = async () => {
    if (!selectedExpenseForOffset || !targetPaymentIdForOffset) return;
    await runOperation(async () => {
      const amount = parseAmount(offsetCustomAmount);
      const payment = payments.find(p => p.id === targetPaymentIdForOffset);
      if (!payment || payment.member_id !== selectedExpenseForOffset.member_id) throw new Error('同じ部員の未納請求を選択してください。');
      await saveClubOperation('create_offset', {
        id: creationId('offset'), payment_id: payment.id, expense_id: selectedExpenseForOffset.id, amount,
        expected_paid: payment.paid_amount || 0, expected_settled: selectedExpenseForOffset.settled_amount || 0,
      });
      delete creationIdsRef.current.offset;
      setShowOffsetModal(false); setSelectedExpenseForOffset(null);
      setTargetPaymentIdForOffset(''); setOffsetCustomAmount('');
    });
  };

  const handleCancelOffsetTransaction = async (offset: OffsetTransaction) => {
    if (!confirm(`¥${offset.amount.toLocaleString()} の相殺を取り消しますか？`)) return;
    await runOperation(() => saveClubOperation('cancel_offset', { id: offset.id }));
  };

  const handleCashSettle = async (expense: Expense) => {
    setCashSettleDate(japanDate()); setCashSettleTarget(expense);
  };
  const executeCashSettle = async () => {
    if (!cashSettleTarget) return;
    await runOperation(async () => {
      await saveClubOperation('set_expense', {id: cashSettleTarget.id, expected_settled: cashSettleTarget.settled_amount || 0, clear: true, settled_on: parseDate(cashSettleDate)});
      setCashSettleTarget(null);
    });
  };
  const editCashEntry = (entry: CashEntry) => {
    if (entry.kind === 'payment') {const record = payments.find(p => p.id === entry.recordId); if (record) setDateEditTarget({kind:'payment',record,title:entry.title});}
    if (entry.kind === 'expense') {const record = expenses.find(p => p.id === entry.recordId); if (record) setDateEditTarget({kind:'expense',record,title:entry.title});}
    if (entry.kind === 'club') {const record = clubTransactions.find(p => p.id === entry.recordId); if (record) setDateEditTarget({kind:'club',record,title:entry.title});}
  };
  const confirmImportedSettlement = async (id: string) => {
    const record = expenses.find(e => e.id === id);
    if (!record || !confirm(`「${record.title}」の精算済みを確認済みにしますか？`)) return;
    await runOperation(() => saveClubOperation('confirm_import_settlement', {id,expected_settled:record.settled_amount || 0}));
  };

  const handleDeleteExpense = async (expense: Expense) => {
    if (!confirm(`未精算の立替「${expense.title}」を削除しますか？`)) return;
    await runOperation(() => saveClubOperation('delete_expense', { id: expense.id }));
  };

  const handleRevertExpense = async (expense: Expense) => {
    if (!confirm(`「${expense.title}」の現金精算を取り消しますか？相殺済みの金額は残ります。`)) return;
    await runOperation(() => saveClubOperation('set_expense', { id: expense.id, expected_settled: expense.settled_amount || 0, clear: false }));
  };

  // CSVダウンロード
  const exportToCSV = () => {
    if (actionsDisabled) return;
    const header = ['分類', '項目', '対象者/出納元', '品名・使途', '金額', '既納額/充当額', '残額', '状態', '日付（請求は期日・他は登録日）', '相殺額', '現金納入/精算額', '現金納入/精算日'];
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
        String(accounting.paymentOffsets[p.id] || 0), String(accounting.cashPayments[p.id] || 0),
        paymentDate(p) || '',
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
        transactionDate(t) || '',
        '0', String(t.amount), transactionDate(t) || '',
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
        e.created_at ? japanDate(new Date(e.created_at)) : '',
        String(accounting.expenseOffsets[e.id] || 0), String(accounting.cashExpenses[e.id] || 0),
        expenseSettlementDate(e) || '',
      ]);
    });

    rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

    const blob = new Blob([createCsv([header, ...rows])], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `会計明細_${japanDate()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
                disabled={actionsDisabled}
                className="text-xs sm:text-sm bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 px-3 py-1.5 rounded-xl font-bold transition"
              >
                請求管理
              </button>
              <button
                onClick={() => setShowOffsetHistoryModal(true)}
                disabled={actionsDisabled}
                className="text-xs sm:text-sm bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 px-3 py-1.5 rounded-xl font-bold transition"
              >
                相殺履歴
              </button>
              <button
                onClick={exportToCSV}
                disabled={actionsDisabled}
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
                  {m.is_active === false ? '退部' : `${m.grade}年`} {m.name} ({m.role})
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
        ) : dataError ? (
          <div role="alert" className="p-5 bg-white rounded-2xl border border-red-200 space-y-3">
            <p className="font-bold text-red-700">会計データを読み込めませんでした</p>
            <p>{dataError}</p>
            <p className="text-slate-600">残高は確認できていません。保存後にこの表示になった場合は、再読み込みして記録を確認してください。</p>
            <button onClick={() => void fetchData()} className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold">再読み込み</button>
          </div>
        ) : accounting.issues.length > 0 ? (
          <div role="alert" className="p-5 bg-white rounded-2xl border border-red-200 space-y-3">
            <p className="font-bold text-red-700">会計データに不一致があります</p>
            {accounting.issues.map(issue => <p key={issue}>{issue}</p>)}
            <p>会計担当が記録を確認するまで、残高表示と変更操作を止めています。</p>
            <button onClick={() => void fetchData()} className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold">再読み込み</button>
          </div>
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
                      onClick={() => { setExpenseDate(japanDate()); setReceiptTarget(null); clearSelectedFile(); setShowExpenseModal(true); }}
                      disabled={actionsDisabled || currentMember.is_active === false}
                      className="p-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-2xl font-bold text-sm shadow-md transition flex items-center justify-center gap-2"
                    >
                      <span>📸</span> 立替を申請
                    </button>
                  ) : (
                    <button
                      onClick={() => {setTxDate(japanDate());setShowClubTxModal(true);}}
                      disabled={actionsDisabled}
                      className="p-4 bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white rounded-2xl font-bold text-sm shadow-md transition flex items-center justify-center gap-2"
                    >
                      <span>💸</span> 部費の出納を記録
                    </button>
                  )}

                  <button
                    disabled={actionsDisabled}
                    onClick={() => {
                      setTargetMemberIds(activeMembers.map((m) => m.id));
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
                                  disabled={actionsDisabled}
                                  onClick={() => { setPaidOn(japanDate()); setConfirmPaymentMethod('振込'); setConfirmPaymentTarget(p); }}
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

                                {p.status === '未納' && paidAmount === 0 && (
                                  <button
                                    disabled={actionsDisabled}
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
                                    className="w-16 h-16 rounded-xl bg-slate-200 shrink-0 overflow-hidden border border-slate-200 cursor-pointer relative group"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={e.receipt_url}
                                      alt="レシート"
                                      className="w-full h-full object-cover group-hover:scale-105 transition"
                                      onError={(err) => {
                                        const image = err.currentTarget;
                                        image.alt = '写真を読み込めません';
                                        image.className = 'w-full h-full text-xs text-red-700 bg-red-50';
                                      }}
                                    />
                                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition text-[10px] text-white font-bold">
                                      拡大
                                    </div>
                                  </div>
                                ) : (
                                  <div className="w-16 h-16 rounded-xl bg-slate-100 shrink-0 border border-slate-200 flex flex-col items-center justify-center text-slate-400 text-xs font-bold">
                                    <span>📄</span>
                                    <button
                                      disabled={actionsDisabled}
                                      onClick={() => { setReceiptTarget(e); clearSelectedFile(); setShowExpenseModal(true); }}
                                      className="text-blue-700 underline"
                                    >写真を追加</button>
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
                                  {e.settlement_provisional && <p className="text-xs text-amber-700 font-bold">精算済みとして仮登録・要確認</p>}
                                  {e.incurred_on && <p className="text-xs text-slate-500">購入日: {e.incurred_on}</p>}
                                  {e.review_note && <p className="text-xs text-slate-500 whitespace-pre-wrap">{e.review_note}</p>}
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
                                    onClick={() => openOffsetModalForExpense(e)}
                                    disabled={!canOffset || actionsDisabled}
                                    className={`py-2 text-xs font-bold rounded-xl transition ${
                                      canOffset
                                        ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm'
                                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                    }`}
                                  >
                                    相殺
                                  </button>

                                  <button
                                    disabled={actionsDisabled}
                                    onClick={() => handleCashSettle(e)}
                                    className="py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition shadow-sm"
                                  >
                                    現金精算
                                  </button>

                                  <button
                                    disabled={actionsDisabled}
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
                                    disabled={actionsDisabled}
                                    onClick={() => handleRevertExpense(e)}
                                    className="text-xs text-slate-400 hover:text-slate-600 font-medium underline"
                                  >
                                    現金精算を取り消す
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
            {activeTab === 'club' && <AccountingReport data={{members,payments,expenses,events,clubTransactions,offsetTransactions}} disabled={actionsDisabled} onCreate={() => {setTxDate(japanDate());setShowClubTxModal(true);}} onEdit={editCashEntry} onConfirm={confirmImportedSettlement} onRevert={id => {const record = expenses.find(e => e.id === id);if(record) void handleRevertExpense(record);}}/>}

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
                              {m.is_active === false ? '退部' : `${m.grade}年`} {m.name}
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

      {/* モーダル: 請求イベント管理 */}
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
                  const canDelete = paidCount === 0 && !offsetTransactions.some(o => evPayments.some(p => p.id === o.payment_id));

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
                          disabled={!canDelete || actionsDisabled}
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
                          disabled={actionsDisabled}
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

      {dateEditTarget && <RecordDateEditor key={`${dateEditTarget.kind}:${dateEditTarget.record.id}`} target={dateEditTarget} disabled={actionsDisabled} onClose={() => setDateEditTarget(null)} onSave={payload => runOperation(async () => {await saveClubOperation('set_record_dates',payload);setDateEditTarget(null);})}/>}
      {cashSettleTarget && <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"><div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4"><h3 className="font-black">立替の精算</h3><p>{cashSettleTarget.title} · 残額 ¥{(cashSettleTarget.amount-(cashSettleTarget.settled_amount||0)).toLocaleString()}</p><label className="block text-xs font-bold">精算日<input type="date" required value={cashSettleDate} onChange={e=>setCashSettleDate(e.target.value)} className="block w-full p-3 border rounded-xl mt-1"/></label><div className="flex gap-2"><button disabled={isSubmitting} onClick={()=>setCashSettleTarget(null)} className="p-3 border rounded-xl flex-1">戻る</button><button disabled={actionsDisabled} onClick={executeCashSettle} className="p-3 bg-slate-900 text-white rounded-xl flex-1">精算済みにする</button></div></div></div>}
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
                      <label className="block text-xs font-bold mb-3">納入日<input type="date" required value={paidOn} onChange={e => setPaidOn(e.target.value)} className="block w-full p-3 border rounded-xl mt-1"/></label>
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
                      disabled={isSubmitting}
                      onClick={() => setConfirmPaymentTarget(null)}
                      className="flex-1 py-2.5 text-xs font-bold border border-slate-200 rounded-xl"
                    >
                      戻る
                    </button>
                    <button
                      type="button"
                      onClick={executePaymentStatusChange}
                      disabled={actionsDisabled}
                      className="flex-1 py-2.5 text-xs bg-slate-900 text-white font-bold rounded-xl shadow-md"
                    >
                      {isClearing ? '支払済にする' : '現金納入を取り消す'}
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
          {/* eslint-disable-next-line @next/next/no-img-element -- Receipt URLs and local previews are displayed directly. */}
          <img src={previewImageUrl} alt="レシート" className="max-h-[85vh] w-auto rounded-2xl object-contain shadow-2xl" />
        </div>
      )}

      {/* モーダル: 部員カルテ */}
      {selectedMemberDetail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4 max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-start border-b pb-3">
              <h3 className="font-black text-lg text-slate-800">
                {selectedMemberDetail.is_active === false ? '退部' : `${selectedMemberDetail.grade}年`} {selectedMemberDetail.name} ({selectedMemberDetail.role})
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
            <form onSubmit={handleCreateBillingEvent}>
              <fieldset disabled={isSubmitting} className="space-y-3.5">
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
                  min={1}
                  max={MAX_AMOUNT}
                  step={1}
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
                      if (targetMemberIds.length === activeMembers.length) setTargetMemberIds([]);
                      else setTargetMemberIds(activeMembers.map((m) => m.id));
                    }}
                    className="text-xs text-blue-600 underline font-bold"
                  >
                    全選択/解除
                  </button>
                </div>
                <div className="max-h-32 overflow-y-auto border border-slate-100 rounded-xl p-2 space-y-1 bg-slate-50">
                  {activeMembers.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer p-1">
                      <input
                        type="checkbox"
                        checked={targetMemberIds.includes(m.id)}
                        onChange={(e) => {
                          if (e.target.checked) setTargetMemberIds([...targetMemberIds, m.id]);
                          else setTargetMemberIds(targetMemberIds.filter((id) => id !== m.id));
                        }}
                      />
                      {m.is_active === false ? '退部' : `${m.grade}年`} {m.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowEventModal(false)} className="flex-1 py-3 text-xs font-bold border rounded-xl">
                  戻る
                </button>
                <button type="submit" disabled={actionsDisabled} className="flex-1 py-3 text-xs bg-slate-900 text-white font-bold rounded-xl shadow-md">
                  作成
                </button>
              </div>
              </fieldset>
            </form>
          </div>
        </div>
      )}

      {/* モーダル: 立替申請 */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4 shadow-2xl">
            <h3 className="font-black text-lg text-slate-800">{receiptTarget ? '領収書写真の追加' : '立替金の申請'}</h3>
            <form onSubmit={handleCreateExpense}>
              <fieldset disabled={isSubmitting} className="space-y-3.5">
              {!receiptTarget && <label className="block text-xs font-bold">領収書・購入日<input type="date" required value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className="block w-full p-3 border rounded-xl mt-1"/></label>}
              {receiptTarget ? <p className="font-bold">{receiptTarget.title} · ¥{receiptTarget.amount.toLocaleString()}</p> : <>
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
                  min={1}
                  max={MAX_AMOUNT}
                  step={1}
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

              </>}
              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1.5">{receiptTarget ? 'レシート写真（必須）' : 'レシート写真（任意）'}</label>
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {localReceiptPreview ? (
                  <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 p-2 flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element -- This is a local Blob URL. */}
                    <img
                      src={localReceiptPreview}
                      alt="プレビュー"
                      className="w-16 h-16 object-cover rounded-xl border border-slate-200 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{receiptFile?.name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">写真を選択済み（保存前）</p>
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
                <button type="submit" disabled={actionsDisabled} className="flex-1 py-3 text-xs bg-blue-600 text-white font-bold rounded-xl shadow-md">
                  {receiptTarget ? '写真を保存' : '申請する'}
                </button>
              </div>
              </fieldset>
            </form>
          </div>
        </div>
      )}

      {/* モーダル: 部費出納 */}
      {showClubTxModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-4 shadow-2xl">
            <h3 className="font-black text-lg text-slate-800">部費出納の記録</h3>
            <form onSubmit={handleCreateClubTransaction}>
              <label className="block text-xs font-bold mb-3">出納日<input type="date" required value={txDate} onChange={e => setTxDate(e.target.value)} className="block w-full p-3 border rounded-xl mt-1"/></label>
              <fieldset disabled={isSubmitting} className="space-y-3.5">
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
                  min={1}
                  max={MAX_AMOUNT}
                  step={1}
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
                    onChange={(e) => setTxSource(e.target.value as ClubTransaction['payment_source'])}
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
                <button type="submit" disabled={actionsDisabled} className="flex-1 py-3 text-xs bg-slate-900 text-white font-bold rounded-xl shadow-md">
                  登録する
                </button>
              </div>
              </fieldset>
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
                disabled={isSubmitting}
                value={targetPaymentIdForOffset}
                onChange={(e) => handleTargetPaymentChange(e.target.value)}
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
              <label className="text-xs text-slate-600 font-bold block mb-1">相殺金額（最大額を自動入力済）</label>
              <input
                type="number"
                  min={1}
                  max={MAX_AMOUNT}
                  step={1}
                placeholder="例: 3000"
                disabled={isSubmitting}
                value={offsetCustomAmount}
                onChange={(e) => setOffsetCustomAmount(e.target.value)}
                className="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-black tabular-nums text-slate-900"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button type="button" disabled={isSubmitting} onClick={() => setShowOffsetModal(false)} className="flex-1 py-3 text-xs font-bold border rounded-xl">
                戻る
              </button>
              <button
                type="button"
                onClick={handleExecuteOffset}
                disabled={actionsDisabled}
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

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

  // 請求作成フォーム用State
  const [eventTitle, setEventTitle] = useState('');
  const [eventAmount, setEventAmount] = useState('');
  const [eventDueDate, setEventDueDate] = useState('');

  // 立替申請フォーム用State
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('ガソリン代');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const { data: bData } = await supabase.from('billing_events').select('*').order('created_at', { ascending: false });

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

  // 立替精算ステータス切り替え
  const toggleExpense = async (expenseId: string, currentStatus: string) => {
    const nextStatus = currentStatus === '未精算' ? '精算済' : '未精算';
    await supabase.from('expenses').update({ status: nextStatus }).eq('id', expenseId);
    fetchData();
  };

  // 画像圧縮ユーティリティ（長辺1200px、JPEG品質0.7）
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

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('圧縮エラー'));
          },
          'image/jpeg',
          0.7
        );
      };
      img.onerror = (err) => reject(err);
    });
  };

  // 請求イベント作成ハンドラー
  const handleCreateBillingEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventTitle || !eventAmount) return;

    setIsSubmitting(true);
    // 1. イベント作成
    const { data: eventData, error: evError } = await supabase
      .from('billing_events')
      .insert({
        title: eventTitle,
        amount: parseInt(eventAmount, 10),
        due_date: eventDueDate || new Date().toISOString().split('T')[0],
        type: '定期部費',
      })
      .select()
      .single();

    if (evError || !eventData) {
      alert('請求作成に失敗しました');
      setIsSubmitting(false);
      return;
    }

    // 2. 全部員分の未納レコードを一括生成
    const paymentRecords = members.map((m) => ({
      billing_event_id: eventData.id,
      member_id: m.id,
      status: '未納',
    }));

    await supabase.from('payments').insert(paymentRecords);

    setEventTitle('');
    setEventAmount('');
    setEventDueDate('');
    setShowEventModal(false);
    setIsSubmitting(false);
    fetchData();
  };

  // 立替申請送信ハンドラー
  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMemberId) {
      alert('上部で自分の名前を選択してください');
      return;
    }
    if (!expenseTitle || !expenseAmount) return;

    setIsSubmitting(true);
    let receiptUrl = '';

    // 画像があれば圧縮してSupabase Storageへアップロード
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

    // 支出レコード登録
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

  return (
    <main className="max-w-md mx-auto p-4 space-y-6 pb-24 min-h-screen bg-white">
      <header className="border-b pb-3">
        <h1 className="text-xl font-bold text-gray-800">⛵ ヨット部 部費管理</h1>
        <div className="mt-3">
          <label className="text-xs text-gray-500 font-medium">ログイン不要：あなたの名前を選択</label>
          <select
            value={selectedMemberId}
            onChange={(e) => handleMemberChange(e.target.value)}
            className="w-full mt-1 p-2 border border-gray-300 rounded-md bg-gray-50 text-sm text-gray-800"
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

      {/* アクションボタン */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setShowExpenseModal(true)}
          className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs text-center shadow-sm"
        >
          ＋ 立替を申請する
        </button>
        <button
          onClick={() => setShowEventModal(true)}
          className="p-2.5 bg-gray-800 hover:bg-black text-white rounded-lg font-semibold text-xs text-center shadow-sm"
        >
          ＋ 請求を作成（部費等）
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 text-center py-8">データを読み込み中...</p>
      ) : (
        <>
          {/* 部員別 収支バランス */}
          <section className="space-y-2">
            <h2 className="font-semibold text-sm text-gray-700">部員別 収支バランス</h2>
            <div className="space-y-1.5">
              {members.map((m) => {
                const balance = calculateBalance(m.id);
                return (
                  <div key={m.id} className="flex justify-between items-center p-2.5 bg-gray-50 border border-gray-100 rounded-lg text-sm">
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

          {/* 請求・納入ステータス */}
          <section className="space-y-3">
            <h2 className="font-semibold text-sm text-gray-700">請求・納入ステータス</h2>
            {payments.length === 0 ? (
              <p className="text-xs text-gray-400 p-3 bg-gray-50 rounded-lg border text-center">請求データはありません</p>
            ) : (
              payments.map((p) => {
                const ev = events.find((e) => e.id === p.billing_event_id);
                const member = members.find((m) => m.id === p.member_id);
                return (
                  <div key={p.id} className="flex justify-between items-center p-3 border border-gray-200 rounded-lg">
                    <div>
                      <p className="font-medium text-sm text-gray-800">{ev?.title}</p>
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

          {/* 立替・支出一覧 */}
          <section className="space-y-3">
            <h2 className="font-semibold text-sm text-gray-700">立替申請・支出一覧</h2>
            {expenses.length === 0 ? (
              <p className="text-xs text-gray-400 p-3 bg-gray-50 rounded-lg border text-center">立替申請はありません</p>
            ) : (
              expenses.map((e) => {
                const member = members.find((m) => m.id === e.member_id);
                return (
                  <div key={e.id} className="p-3 border border-gray-200 rounded-lg space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{e.category}</span>
                        <p className="font-medium text-sm text-gray-800 mt-1">{e.title}</p>
                        <p className="text-xs text-gray-500">立替者: {member?.name} | ¥{e.amount.toLocaleString()}</p>
                      </div>
                      <button
                        onClick={() => toggleExpense(e.id, e.status)}
                        className={`text-xs px-3 py-1.5 rounded-full font-bold shadow-sm ${
                          e.status === '精算済'
                            ? 'bg-gray-100 text-gray-600 border border-gray-200'
                            : 'bg-yellow-100 text-yellow-800 border border-yellow-300'
                        }`}
                      >
                        {e.status}
                      </button>
                    </div>
                    {e.receipt_url && (
                      <a href={e.receipt_url} target="_blank" rel="noopener noreferrer" className="block text-xs text-blue-600 underline">
                        📄 レシート画像を確認
                      </a>
                    )}
                  </div>
                );
              })
            )}
          </section>
        </>
      )}

      {/* 請求作成モーダル */}
      {showEventModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-5 w-full max-w-xs space-y-4">
            <h3 className="font-bold text-base text-gray-800">新規請求の作成</h3>
            <form onSubmit={handleCreateBillingEvent} className="space-y-3">
              <div>
                <label className="text-xs text-gray-600">請求名</label>
                <input
                  type="text"
                  placeholder="例: 10月度部費、秋インカレ遠征費"
                  required
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  className="w-full mt-1 p-2 border rounded text-sm text-gray-800"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">金額 (1人あたり)</label>
                <input
                  type="number"
                  placeholder="5000"
                  required
                  value={eventAmount}
                  onChange={(e) => setEventAmount(e.target.value)}
                  className="w-full mt-1 p-2 border rounded text-sm text-gray-800"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">支払期日</label>
                <input
                  type="date"
                  value={eventDueDate}
                  onChange={(e) => setEventDueDate(e.target.value)}
                  className="w-full mt-1 p-2 border rounded text-sm text-gray-800"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEventModal(false)}
                  className="flex-1 py-2 text-xs text-gray-600 border rounded"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 text-xs bg-black text-white font-bold rounded"
                >
                  {isSubmitting ? '作成中...' : '作成する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 立替申請モーダル */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-5 w-full max-w-xs space-y-4">
            <h3 className="font-bold text-base text-gray-800">立替精算の申請</h3>
            <form onSubmit={handleCreateExpense} className="space-y-3">
              <div>
                <label className="text-xs text-gray-600">用途・品名</label>
                <input
                  type="text"
                  placeholder="例: 救命胴衣ロープ、給油代"
                  required
                  value={expenseTitle}
                  onChange={(e) => setExpenseTitle(e.target.value)}
                  className="w-full mt-1 p-2 border rounded text-sm text-gray-800"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">金額</label>
                <input
                  type="number"
                  placeholder="3000"
                  required
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  className="w-full mt-1 p-2 border rounded text-sm text-gray-800"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">カテゴリ</label>
                <select
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value)}
                  className="w-full mt-1 p-2 border rounded text-sm text-gray-800"
                >
                  <option value="ガソリン代">ガソリン代</option>
                  <option value="艇体・修繕費">艇体・修繕費</option>
                  <option value="消耗品">消耗品</option>
                  <option value="合宿・遠征費">合宿・遠征費</option>
                  <option value="その他">その他</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600">レシート写真（自動圧縮）</label>
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                  className="w-full mt-1 text-xs text-gray-600"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(false)}
                  className="flex-1 py-2 text-xs text-gray-600 border rounded"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 text-xs bg-blue-600 text-white font-bold rounded"
                >
                  {isSubmitting ? '送信中...' : '申請する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

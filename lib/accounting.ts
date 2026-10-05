import type { BillingEvent, ClubTransaction, Expense, Member, OffsetTransaction, Payment } from '../types';

export interface ClubData {
  members: Member[];
  payments: Payment[];
  expenses: Expense[];
  events: BillingEvent[];
  clubTransactions: ClubTransaction[];
  offsetTransactions: OffsetTransaction[];
}

export const MAX_AMOUNT = 2_147_483_647;

export function parseAmount(input: string): number {
  const value = input.trim();
  const amount = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    throw new Error('金額は1円以上の整数で入力してください（小数・指数表記は使えません）。');
  }
  return amount;
}

export function japanDate(date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(date);
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = 'code' in error ? error.code : undefined;
    if (code === 'PGRST202') return '保存機能の更新がまだ反映されていません。会計担当に連絡してください。';
    if (code === 'PGRST301' || code === 'PGRST303') return '接続の認証に失敗しました。会計担当に連絡してください。';
    if ('message' in error && typeof error.message === 'string') return error.message;
  }
  return '通信に失敗しました。接続を確認して再試行してください。';
}

export function calculateAccounting(data: ClubData) {
  const paymentOffsets: Record<string, number> = {};
  const expenseOffsets: Record<string, number> = {};
  for (const offset of data.offsetTransactions) {
    paymentOffsets[offset.payment_id] = (paymentOffsets[offset.payment_id] || 0) + offset.amount;
    expenseOffsets[offset.expense_id] = (expenseOffsets[offset.expense_id] || 0) + offset.amount;
  }
  const cashPayments: Record<string, number> = {};
  const cashExpenses: Record<string, number> = {};
  const categorySpendingMap: Record<string, number> = {};
  const categoryIncomeMap: Record<string, number> = {};
  const issues: string[] = [];
  const eventAmounts = new Map(data.events.map(event => [event.id, event.amount]));
  const paymentIds = new Set(data.payments.map(payment => payment.id));
  const expenseIds = new Set(data.expenses.map(expense => expense.id));
  const validAmount = (amount: number) => Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_AMOUNT;
  const paymentById = new Map(data.payments.map(payment => [payment.id, payment]));
  const expenseById = new Map(data.expenses.map(expense => [expense.id, expense]));
  if (data.events.some(event => !validAmount(event.amount) || event.amount === 0)
      || data.clubTransactions.some(tx => !validAmount(tx.amount) || tx.amount === 0 || !['収入', '支出'].includes(tx.type))) {
    issues.push('請求・出納に不正な金額または種別があります。');
  }
  for (const payment of data.payments) {
    const paid = payment.paid_amount || 0;
    const cash = paid - (paymentOffsets[payment.id] || 0);
    if (!validAmount(paid) || !eventAmounts.has(payment.billing_event_id) || cash < 0 || paid > (eventAmounts.get(payment.billing_event_id) ?? 0)) {
      issues.push('部費の納入額と請求・相殺履歴に不一致があります。');
    }
    cashPayments[payment.id] = cash;
  }
  for (const expense of data.expenses) {
    const settled = expense.settled_amount || 0;
    const cash = settled - (expenseOffsets[expense.id] || 0);
    if (!validAmount(expense.amount) || expense.amount === 0 || !validAmount(settled) || cash < 0 || settled > expense.amount) issues.push('立替の精算額と相殺履歴に不一致があります。');
    cashExpenses[expense.id] = cash;
    if (cash !== 0) categorySpendingMap[expense.category] = (categorySpendingMap[expense.category] || 0) + cash;
  }
  for (const offset of data.offsetTransactions) {
    if (!paymentIds.has(offset.payment_id) || !expenseIds.has(offset.expense_id)) issues.push('相殺履歴の請求または立替が見つかりません。');
    if (!validAmount(offset.amount) || offset.amount === 0
        || paymentById.get(offset.payment_id)?.member_id !== expenseById.get(offset.expense_id)?.member_id) {
      issues.push('相殺履歴の金額または対象部員に不一致があります。');
    }
  }
  const totalCollectedDues = Object.values(cashPayments).reduce((sum, amount) => sum + amount, 0);
  categoryIncomeMap['部費納入 (現金/振込)'] = totalCollectedDues;
  for (const tx of data.clubTransactions) {
    const categories = tx.type === '収入' ? categoryIncomeMap : categorySpendingMap;
    categories[tx.category] = (categories[tx.category] || 0) + tx.amount;
  }
  const totalAllIncomes = Object.values(categoryIncomeMap).reduce((sum, amount) => sum + amount, 0);
  const totalAllExpenses = Object.values(categorySpendingMap).reduce((sum, amount) => sum + amount, 0);
  return {
    paymentOffsets, expenseOffsets, cashPayments, cashExpenses, categorySpendingMap, categoryIncomeMap,
    totalAllIncomes, totalAllExpenses,
    estimatedClubTreasury: totalAllIncomes - totalAllExpenses,
    totalOffsetAmount: data.offsetTransactions.reduce((sum, offset) => sum + offset.amount, 0),
    issues: [...new Set(issues)],
  };
}

export function createCsv(rows: string[][]): string {
  return '\uFEFF' + rows.map(row => row.map(value => {
    // Prevent text fields from becoming spreadsheet formulas when opened in Excel.
    const safe = /^\s*[=+@-]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}

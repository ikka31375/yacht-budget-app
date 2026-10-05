import { supabase } from './supabase';
import type { ClubData } from './accounting';

interface Page<T> { data: T[] | null; error: unknown; count: number | null }

export async function readAllRows<T>(readPage: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  while (true) {
    const page = await readPage(rows.length, rows.length + 499);
    if (page.error) throw page.error;
    if (!page.data) throw new Error('データを読み込めませんでした。');
    if (page.data.length === 0) {
      if (page.count !== null && rows.length < page.count) throw new Error('一部のデータを読み込めませんでした。再試行してください。');
      return rows;
    }
    rows.push(...page.data);
    if (page.count !== null && rows.length >= page.count) return rows;
  }
}

export async function fetchClubData(): Promise<ClubData> {
  // A single database snapshot prevents mixing balances from different moments.
  const snapshot = await supabase.rpc('get_club_accounting_snapshot');
  if (!snapshot.error) {
    const data = snapshot.data as ClubData | null;
    if (!data || !['members', 'payments', 'expenses', 'events', 'clubTransactions', 'offsetTransactions'].every(key => Array.isArray(data[key as keyof ClubData]))) {
      throw new Error('データの形式を確認できませんでした。');
    }
    return data;
  }
  if (snapshot.error.code !== 'PGRST202') throw snapshot.error;
  // Read-only compatibility until the database migration has been applied.
  const read = <T>(table: string) => readAllRows<T>((from, to) =>
    supabase.from(table).select('*', { count: 'exact' }).order('id').range(from, to));
  const [members, payments, expenses, events, clubTransactions, offsetTransactions] = await Promise.all([
    read<ClubData['members'][number]>('members'), read<ClubData['payments'][number]>('payments'),
    read<ClubData['expenses'][number]>('expenses'), read<ClubData['events'][number]>('billing_events'),
    read<ClubData['clubTransactions'][number]>('club_transactions'), read<ClubData['offsetTransactions'][number]>('offset_transactions'),
  ]);
  return { members, payments, expenses, events, clubTransactions, offsetTransactions };
}

export async function saveClubOperation(operation: string, payload: Record<string, unknown>) {
  const { error } = await supabase.rpc('apply_club_accounting_operation', { p_operation: operation, p_payload: payload });
  if (error) throw error;
}

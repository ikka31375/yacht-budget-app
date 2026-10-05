const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { loadAccounting, loadPageFunctions } = require('./helpers.cjs');
const { parseAmount, calculateAccounting, createCsv, japanDate } = loadAccounting();

function data(paid, settled, offset) {
  return { members: [], payments: [{ id: 'p', billing_event_id: 'b', paid_amount: paid }],
    expenses: [{ id: 'e', amount: 10000, settled_amount: settled, category: '燃料・交通費' }],
    events: [{ id: 'b', amount: 10000 }], clubTransactions: [],
    offsetTransactions: offset ? [{ payment_id: 'p', expense_id: 'e', amount: offset }] : [] };
}

test('reject zero, negatives, decimals, exponent notation, non-finite and excessive amounts', () => {
  for (const value of ['0', '-3000', '2.5', '1e4', 'NaN', 'Infinity', '', '2,000', '2147483648']) assert.throws(() => parseAmount(value));
  assert.equal(parseAmount(' 10000 '), 10000);
});

test('partial and complete offsets never appear as cash income or expenditure', () => {
  for (const amount of [3000, 10000]) {
    const totals = calculateAccounting(data(amount, amount, amount));
    assert.equal(totals.totalAllIncomes, 0);
    assert.equal(totals.totalAllExpenses, 0);
    assert.equal(totals.estimatedClubTreasury, 0);
    assert.equal(totals.cashPayments.p, 0);
    assert.equal(totals.cashExpenses.e, 0);
  }
});

test('mixed offset/cash figures agree between detail, categories and treasury', () => {
  const input = data(10000, 8000, 3000);
  input.clubTransactions = [{ type: '収入', amount: 20000, category: '寄付' }, { type: '支出', amount: 2000, category: '燃料・交通費' }];
  const result = calculateAccounting(input);
  assert.equal(result.cashPayments.p, 7000);
  assert.equal(result.cashExpenses.e, 5000);
  assert.equal(result.categorySpendingMap['燃料・交通費'], 7000);
  assert.equal(result.totalAllIncomes, 27000);
  assert.equal(result.totalAllExpenses, 7000);
  assert.equal(result.estimatedClubTreasury, 20000);
});

test('detect damaged ledger instead of silently displaying a negative cash amount', () => {
  assert(calculateAccounting(data(0, 3000, 3000)).issues.length > 0);
  const input = data(0, 0, 0);
  input.clubTransactions = [{ type: '支出', amount: -3000, category: '燃料・交通費' }];
  assert(calculateAccounting(input).issues.length > 0);
});

test('CSV preserves quotation marks, commas, hash characters and embedded newlines', () => {
  assert.equal(createCsv([['燃料 "A", #1\n次の行', '3000']]), '\uFEFF"燃料 ""A"", #1\n次の行","3000"');
  assert(createCsv([['=1+1']]).includes("'=1+1"));
  assert(createCsv([['-1+2']]).includes("'-1+2"));
  assert(createCsv([['-3000']]).includes('"-3000"'));
});

test('dates follow Japan time across the UTC day boundary', () => {
  assert.equal(japanDate(new Date('2026-10-04T16:00:00Z')), '2026-10-05');
});

const base = () => ({ submittingRef: { current: false }, loading: false, dataError: null, accounting: { issues: [] }, fetchData: async () => {}, errorMessage: error => error.message });

test('failed club save preserves input and keeps the form open', async () => {
  const page = loadPageFunctions(['runOperation', 'handleCreateClubTransaction'], {
    ...base(), parseAmount, txTitle: '燃料', txAmount: '3000', txType: '支出', txCategory: '燃料・交通費', txSource: '部室現金', txEventTag: '',
    creationId: () => 'stable-id', saveClubOperation: async () => { throw new Error('保存失敗'); },
  });
  await page.functions.handleCreateClubTransaction({ preventDefault() {} });
  assert.equal(page.alerts[0], '保存失敗');
  assert(!Object.hasOwn(page.state, 'setTxTitle'));
  assert(!Object.hasOwn(page.state, 'setShowClubTxModal'));
  assert.equal(page.state.setIsSubmitting, false);
});

test('failed receipt upload never submits or clears the expense', async () => {
  let writes = 0;
  const page = loadPageFunctions(['runOperation', 'handleCreateExpense'], {
    ...base(), parseAmount, receiptTarget: null, selectedMemberId: 'm', expenseTitle: '燃料', expenseAmount: '3000',
    expenseCategory: '燃料・交通費', receiptFile: {}, uploadReceipt: async () => { throw new Error('写真保存失敗'); },
    saveClubOperation: async () => { writes++; },
  });
  await page.functions.handleCreateExpense({ preventDefault() {} });
  assert.equal(writes, 0);
  assert(!Object.hasOwn(page.state, 'setExpenseTitle'));
  assert(!Object.hasOwn(page.state, 'setReceiptFile'));
});

test('synchronous busy lock prevents two rapid submissions before React re-renders', async () => {
  let writes = 0, release;
  const wait = new Promise(resolve => { release = resolve; });
  const page = loadPageFunctions(['runOperation'], base());
  const first = page.functions.runOperation(async () => { writes++; await wait; });
  await page.functions.runOperation(async () => { writes++; });
  release(); await first;
  assert.equal(writes, 1);
});

test('pagination reads all rows even with a server cap smaller than the requested page size', async () => {
  const source = fs.readFileSync('lib/data.ts', 'utf8');
  const ast = ts.createSourceFile('data.ts', source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'readAllRows');
  const code = fn.getText(ast).replace('export ', '');
  const context = vm.createContext({});
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const readAllRows = vm.runInContext('readAllRows', context);
  const records = Array.from({ length: 1250 }, (_, id) => ({ id }));
  const rows = await readAllRows(async from => ({ data: records.slice(from, from + 100), error: null, count: records.length }));
  assert.equal(rows.length, 1250);
  assert.equal(new Set(rows.map(row => row.id)).size, 1250);
  await assert.rejects(readAllRows(async () => ({ data: null, error: new Error('読込失敗'), count: null })), /読込失敗/);
});

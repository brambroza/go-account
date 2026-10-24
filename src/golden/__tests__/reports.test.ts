import { toSatang, trialBalance, purchaseOutstanding, validateAccountingData } from 'src/domain';

import { replayScenario } from '../scenarios';
import { SCENARIO_FILES } from '../golden-vectors';
import { reportAsOf, payablesOut, accountLedger, reportCheckpoints } from '../reports';

import type { ScenarioCheckpoint } from '../scenarios';

// ----------------------------------------------------------------------
// นิยามอ้างอิงของ report golden (บัญชีแยกประเภท, เจ้าหนี้คงค้าง) ต้องสอดคล้องกับงบทดลอง/ยอดค้างจ่ายของ domain
// และทุก state ที่ใช้สร้างรายงานต้องผ่าน validateAccountingData
// ----------------------------------------------------------------------

const checkpoints: { name: string; cp: ScenarioCheckpoint }[] = [];
Object.values(SCENARIO_FILES).forEach((scenarios) =>
  scenarios.forEach((s) => {
    const wanted = reportCheckpoints(s);
    replayScenario(s, (cp) => {
      if (wanted.includes(cp.index)) checkpoints.push({ name: `${s.name}#${cp.index}`, cp: { ...cp, statementRefs: new Map(cp.statementRefs) } });
    });
  })
);

describe('report golden reference definitions', () => {
  it('has checkpoints for every scenario', () => {
    expect(checkpoints.length).toBeGreaterThan(27);
  });

  it.each(checkpoints.map((c) => [c.name, c.cp] as const))('%s: ledger closing = trial balance, payables = outstanding, no integrity problems', (_, cp) => {
    const { state } = cp;
    const asOf = reportAsOf(state);
    trialBalance(state.accounts, state.journal, asOf).forEach((row) => {
      expect(accountLedger(state, row.account.code, undefined, asOf).closing).toBe(toSatang(row.balance));
      const month = `${asOf.slice(0, 7)}-01`;
      const split = accountLedger(state, row.account.code, month, asOf);
      expect(split.closing).toBe(toSatang(row.balance));
      expect(split.lines.length ? split.lines[split.lines.length - 1].balance : split.opening).toBe(split.closing);
    });
    const payables = payablesOut(state, asOf);
    const want = state.purchases.reduce((acc, p) => acc + Math.max(0, toSatang(purchaseOutstanding(state, p))), 0);
    expect(payables.total).toBe(want);
    expect(validateAccountingData(state)).toEqual([]);
  });

  it('ledger lines are ordered by date then document number', () => {
    checkpoints.forEach(({ cp }) => {
      const codes = new Set(cp.state.journal.flatMap((e) => e.lines.map((l) => l.accountCode)));
      codes.forEach((code) => {
        const { lines } = accountLedger(cp.state, code);
        lines.forEach((l, i) => {
          if (i === 0) return;
          const prev = lines[i - 1];
          expect(prev.date < l.date || (prev.date === l.date && prev.docNo <= l.docNo)).toBe(true);
        });
      });
    });
  });
});

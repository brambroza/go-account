import type {
  Account,
  Contact,
  PP30Full,
  VatClose,
  WhtPayee,
  BalanceSheet,
  VatReportRow,
  WhtCondition,
  ProfitAndLoss,
  TrialBalanceRow,
} from 'src/domain';

import { useState, useEffect, useCallback } from 'react';

import { downloadBlob } from 'src/utils/download';

import { useAccounting } from 'src/store';

// ----------------------------------------------------------------------
// รายงาน/ไฟล์จากเซิร์ฟเวอร์ (โหมด api) — `/reports/*` และ `/files/*` ของ go-account-api (C5)
// โหมด local ไม่เรียกอะไร (หน้าจอคำนวณจาก `src/domain` เหมือนเดิม)
// cache ต่อ path + revision ของสมุด: บันทึกเอกสารแล้ว revision เปลี่ยน → โหลดรายงานใหม่อัตโนมัติ
// ----------------------------------------------------------------------

export type ServerReport<T> = { data: T | undefined; loading: boolean; error: string | null };

const cache = new Map<string, { revision: number; data: unknown }>();

/** GET รายงาน — `path = null` (หรือโหมด local) = ไม่เรียก */
export function useServerReport<T>(path: string | null): ServerReport<T> {
  const { client, revision } = useAccounting();
  const active = !!client && !!path;
  const cached = active ? cache.get(`${client?.baseUrl}${path}`) : undefined;
  const fresh = cached && cached.revision === revision ? (cached.data as T) : undefined;
  const [state, setState] = useState<ServerReport<T>>({ data: fresh, loading: active && !fresh, error: null });

  useEffect(() => {
    if (!client || !path) {
      setState({ data: undefined, loading: false, error: null });
      return undefined;
    }
    const key = `${client.baseUrl}${path}`;
    const hit = cache.get(key);
    if (hit && hit.revision === revision) {
      setState({ data: hit.data as T, loading: false, error: null });
      return undefined;
    }
    let cancelled = false;
    // ข้อมูลเก่า (revision ก่อน) แสดงไว้ระหว่างโหลดใหม่ — ไม่กระพริบเป็นหน้าว่าง
    setState((s) => ({ data: (hit?.data as T | undefined) ?? s.data, loading: true, error: null }));
    client
      .get<T>(path)
      .then((data) => {
        cache.set(key, { revision, data });
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ data: undefined, loading: false, error: e instanceof Error ? e.message : 'โหลดรายงานไม่สำเร็จ' });
      });
    return () => {
      cancelled = true;
    };
  }, [client, path, revision]);

  return state;
}

/** ดาวน์โหลดไฟล์จาก `/files/*` — คืน warnings (header X-Warnings) ให้หน้าจอแสดง; throw ข้อความไทยถ้าสร้างไฟล์ไม่ได้ */
export function useServerDownload() {
  const { client } = useAccounting();
  return useCallback(
    async (path: string): Promise<{ fileName: string; warnings: string[] }> => {
      if (!client) throw new Error('ดาวน์โหลดจากเซิร์ฟเวอร์ได้เฉพาะโหมด api');
      const file = await client.download(path);
      downloadBlob(file.fileName, file.blob);
      return { fileName: file.fileName, warnings: file.warnings };
    },
    [client]
  );
}

// ---------------- DTO ของ go-account-api → type ของหน้าเว็บ ----------------

export type VatRowDto = Omit<VatReportRow, 'refDocNo' | 'recordedDate'> & { refDocNo: string | null; recordedDate: string | null };

export type Pp30Dto = Omit<PP30Full, 'closed'> & { closed: boolean };

export type VatReportDto = { month: string; sales: VatRowDto[]; purchases: VatRowDto[]; pp30: Pp30Dto };

export const toVatRows = (rows: VatRowDto[]): VatReportRow[] =>
  rows.map(({ refDocNo, recordedDate, ...r }) => ({ ...r, ...(refDocNo ? { refDocNo } : {}), ...(recordedDate ? { recordedDate } : {}) }));

/** ภ.พ.30 — `closed` จากเซิร์ฟเวอร์เป็น boolean, หน้าจอต้องการแถวการปิด (วันที่/ยอด) จากสมุด */
export function toPp30(dto: Pp30Dto, vatCloses: VatClose[], month: string): PP30Full {
  const { closed, ...rest } = dto;
  const close = closed ? vatCloses.find((c) => c.period === month) : undefined;
  return { ...rest, ...(close ? { closed: close } : {}) };
}

type PartyDto = { title: string; name: string; lastName?: string | null; taxId: string; branchNo: string; legalForm: string };

export type WhtReportDto = {
  month: string;
  form: 'PND3' | 'PND53';
  payees: {
    contactId: string;
    code: string;
    payee: PartyDto;
    items: {
      paymentId: string;
      docNo: string;
      purchaseDocNo: string;
      certNo: string | null;
      paidDate: string;
      rate: number;
      amount: number;
      tax: number;
      incomeType: string;
      condition: string;
    }[];
  }[];
  payeeCount: number;
  amount: number;
  tax: number;
  fileName: string;
  errors: string[];
  warnings: string[];
};

/** ผู้ถูกหัก ณ ที่จ่ายของเดือน — ข้อมูลผู้รับเงินจาก snapshot ของใบสำคัญจ่าย (เหมือน `whtPayeesForPeriod`) */
export function toWhtPayees(dto: WhtReportDto, contacts: Contact[]): WhtPayee[] {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  return dto.payees.map((p) => {
    const base = byId.get(p.contactId);
    const contact: Contact = {
      id: p.contactId,
      code: p.code,
      kind: base?.kind ?? 'vendor',
      legalForm: p.payee.legalForm === 'individual' ? 'individual' : 'juristic',
      title: p.payee.title,
      name: p.payee.name,
      ...(p.payee.lastName ? { lastName: p.payee.lastName } : {}),
      taxId: p.payee.taxId,
      branchNo: p.payee.branchNo,
      address: base?.address ?? {},
      creditDays: base?.creditDays ?? 0,
    };
    return {
      contact,
      items: p.items.map((i) => ({
        paymentId: i.paymentId,
        purchaseId: '',
        docNo: i.docNo,
        purchaseDocNo: i.purchaseDocNo,
        ...(i.certNo ? { certNo: i.certNo } : {}),
        paidDate: i.paidDate,
        rate: i.rate,
        amount: i.amount,
        tax: i.tax,
        incomeType: i.incomeType,
        condition: (i.condition as WhtCondition) || '1',
      })),
    };
  });
}

type TrialBalanceRowDto = { code: string; name: string; type: Account['type']; debit: number; credit: number; balance: number };

export type TrialBalanceDto = { asOf: string; rows: TrialBalanceRowDto[]; debit: number; credit: number; balanced: boolean };

type AccountAmountDto = { code: string; name: string; balance: number };

export type ProfitAndLossDto = {
  from: string;
  to: string;
  revenue: AccountAmountDto[];
  expense: AccountAmountDto[];
  totalRevenue: number;
  totalExpense: number;
  netProfit: number;
};

export type BalanceSheetDto = Omit<BalanceSheet, 'assets' | 'liabilities' | 'equity'> & {
  assets: AccountAmountDto[];
  liabilities: AccountAmountDto[];
  equity: AccountAmountDto[];
};

const accountOf = (accounts: Account[], code: string, name: string, type: Account['type']): Account =>
  accounts.find((a) => a.code === code) ?? { code, name, nameEn: name, type };

export const toTrialBalance = (dto: TrialBalanceDto, accounts: Account[]): TrialBalanceRow[] =>
  dto.rows.map((r) => ({ account: accountOf(accounts, r.code, r.name, r.type), debit: r.debit, credit: r.credit, balance: r.balance }));

export function toProfitAndLoss(dto: ProfitAndLossDto, accounts: Account[]): ProfitAndLoss {
  const row = (type: Account['type']) => (r: AccountAmountDto) => {
    const account = accountOf(accounts, r.code, r.name, type);
    // ยอดด้านปกติ: รายได้ = เครดิต, ค่าใช้จ่าย = เดบิต (หน้าจอแสดงเฉพาะ balance)
    return type === 'revenue'
      ? { account, debit: 0, credit: r.balance, balance: r.balance }
      : { account, debit: r.balance, credit: 0, balance: r.balance };
  };
  return {
    revenue: dto.revenue.map(row('revenue')),
    expense: dto.expense.map(row('expense')),
    totalRevenue: dto.totalRevenue,
    totalExpense: dto.totalExpense,
    netProfit: dto.netProfit,
  };
}

export function toBalanceSheet(dto: BalanceSheetDto, accounts: Account[]): BalanceSheet {
  const rows = (type: Account['type'], list: AccountAmountDto[]) =>
    list.map((r) => ({ account: accountOf(accounts, r.code, r.name, type), balance: r.balance }));
  return {
    ...dto,
    assets: rows('asset', dto.assets),
    liabilities: rows('liability', dto.liabilities),
    equity: rows('equity', dto.equity),
  };
}

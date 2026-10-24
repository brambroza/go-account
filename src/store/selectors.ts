import type { Account, Contact, LineSide } from 'src/domain';

import { useMemo } from 'react';

import { lineAccountProblem, contactDisplayName } from 'src/domain';

import { useAccounting } from './accounting-provider';

// ----------------------------------------------------------------------

export function useContactLookup() {
  const { data } = useAccounting();
  return useMemo(() => {
    const map = new Map<string, Contact>(data.contacts.map((c) => [c.id, c]));
    return {
      get: (id: string) => map.get(id),
      name: (id: string) => contactDisplayName(map.get(id)),
    };
  }, [data.contacts]);
}

export function useAccountLookup() {
  const { data } = useAccounting();
  return useMemo(() => {
    const map = new Map<string, Account>(data.accounts.map((a) => [a.code, a]));
    return {
      get: (code: string) => map.get(code),
      name: (code: string) => map.get(code)?.name ?? code,
      byType: (...types: Account['type'][]) => data.accounts.filter((a) => types.includes(a.type)),
      /** บัญชีที่เลือกได้ในบรรทัดเอกสาร (ตามกฎเดียวกับ action — ไม่มีบัญชีคุม) */
      forLines: (side: LineSide) => data.accounts.filter((a) => !lineAccountProblem(a, side)),
    };
  }, [data.accounts]);
}

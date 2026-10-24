import { lazy, Suspense } from 'react';
import { Outlet, Navigate, useRoutes } from 'react-router-dom';

import { DashboardLayout } from 'src/layouts/dashboard';

import { LoadingScreen } from 'src/components/loading-screen';

// ----------------------------------------------------------------------

const DashboardPage = lazy(() => import('src/pages/dashboard'));
const SalesListPage = lazy(() => import('src/pages/sales/list'));
const SalesNewPage = lazy(() => import('src/pages/sales/new'));
const SalesDetailPage = lazy(() => import('src/pages/sales/detail'));
const CreditNotePage = lazy(() => import('src/pages/sales/credit-note'));
const PurchaseListPage = lazy(() => import('src/pages/purchases/list'));
const PurchaseNewPage = lazy(() => import('src/pages/purchases/new'));
const ContactsPage = lazy(() => import('src/pages/contacts'));
const TaxPage = lazy(() => import('src/pages/tax'));
const LedgerPage = lazy(() => import('src/pages/ledger'));
const SettingsPage = lazy(() => import('src/pages/settings'));

/**
 * ทุกหน้าธุรกิจอยู่ใต้ DashboardLayout
 * (ยังไม่มี AuthGuard — ต้นแบบนี้เก็บข้อมูลในเบราว์เซอร์; ต่อ backend แล้วค่อยครอบ)
 */
export function Router() {
  return useRoutes([
    {
      path: '/',
      element: (
        <DashboardLayout>
          <Suspense fallback={<LoadingScreen />}>
            <Outlet />
          </Suspense>
        </DashboardLayout>
      ),
      children: [
        { index: true, element: <DashboardPage /> },
        {
          path: 'sales',
          children: [
            { index: true, element: <SalesListPage /> },
            { path: 'new', element: <SalesNewPage /> },
            { path: ':id', element: <SalesDetailPage /> },
            { path: ':id/credit-note', element: <CreditNotePage /> },
          ],
        },
        {
          path: 'purchases',
          children: [
            { index: true, element: <PurchaseListPage /> },
            { path: 'new', element: <PurchaseNewPage /> },
          ],
        },
        { path: 'contacts', element: <ContactsPage /> },
        { path: 'tax', element: <TaxPage /> },
        { path: 'ledger', element: <LedgerPage /> },
        { path: 'settings', element: <SettingsPage /> },
      ],
    },
    { path: '*', element: <Navigate to="/" replace /> },
  ]);
}

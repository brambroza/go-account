import { lazy, Suspense } from 'react';
import { Outlet, Navigate, useRoutes } from 'react-router-dom';

import { DashboardLayout } from 'src/layouts/dashboard';

import { LoadingScreen } from 'src/components/loading-screen';

import { RouteErrorBoundary } from '../components/route-error-boundary';

// ----------------------------------------------------------------------

const DashboardPage = lazy(() => import('src/pages/dashboard'));
const SalesListPage = lazy(() => import('src/pages/sales/list'));
const SalesNewPage = lazy(() => import('src/pages/sales/new'));
const SalesDetailPage = lazy(() => import('src/pages/sales/detail'));
const CreditNotePage = lazy(() => import('src/pages/sales/credit-note'));
const DebitNotePage = lazy(() => import('src/pages/sales/debit-note'));
const ReceiptPage = lazy(() => import('src/pages/sales/receipt'));
const PurchaseListPage = lazy(() => import('src/pages/purchases/list'));
const PurchaseNewPage = lazy(() => import('src/pages/purchases/new'));
const PaymentPage = lazy(() => import('src/pages/purchases/payment'));
const PurchaseDetailPage = lazy(() => import('src/pages/purchases/detail'));
const SupplierCreditNotePage = lazy(() => import('src/pages/purchases/credit-note'));
const OpeningBalancePage = lazy(() => import('src/pages/settings/opening'));
const QuotationListPage = lazy(() => import('src/pages/quotations/list'));
const QuotationNewPage = lazy(() => import('src/pages/quotations/new'));
const QuotationEditPage = lazy(() => import('src/pages/quotations/edit'));
const QuotationDetailPage = lazy(() => import('src/pages/quotations/detail'));
const BankPage = lazy(() => import('src/pages/bank'));
const BankReconcilePage = lazy(() => import('src/pages/bank/reconcile'));
const ContactsPage = lazy(() => import('src/pages/contacts'));
const TaxPage = lazy(() => import('src/pages/tax'));
const LedgerPage = lazy(() => import('src/pages/ledger'));
const SettingsPage = lazy(() => import('src/pages/settings'));

/**
 * ทุกหน้าธุรกิจอยู่ใต้ DashboardLayout และ RouteErrorBoundary (หน้าพังแล้วเมนูยังใช้ได้)
 * (ยังไม่มี AuthGuard — ต้นแบบนี้เก็บข้อมูลในเบราว์เซอร์; ต่อ backend แล้วค่อยครอบ)
 */
export function Router() {
  return useRoutes([
    {
      path: '/',
      element: (
        <DashboardLayout>
          <RouteErrorBoundary>
            <Suspense fallback={<LoadingScreen />}>
              <Outlet />
            </Suspense>
          </RouteErrorBoundary>
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
            { path: ':id/debit-note', element: <DebitNotePage /> },
            { path: 'receipts/:id', element: <ReceiptPage /> },
          ],
        },
        {
          path: 'purchases',
          children: [
            { index: true, element: <PurchaseListPage /> },
            { path: 'new', element: <PurchaseNewPage /> },
            { path: 'payments/:id', element: <PaymentPage /> },
            { path: ':id', element: <PurchaseDetailPage /> },
            { path: ':id/credit-note', element: <SupplierCreditNotePage /> },
          ],
        },
        {
          path: 'quotations',
          children: [
            { index: true, element: <QuotationListPage /> },
            { path: 'new', element: <QuotationNewPage /> },
            { path: ':id', element: <QuotationDetailPage /> },
            { path: ':id/edit', element: <QuotationEditPage /> },
          ],
        },
        {
          path: 'bank',
          children: [
            { index: true, element: <BankPage /> },
            { path: 'reconcile/:code', element: <BankReconcilePage /> },
          ],
        },
        { path: 'contacts', element: <ContactsPage /> },
        { path: 'tax', element: <TaxPage /> },
        { path: 'ledger', element: <LedgerPage /> },
        {
          path: 'settings',
          children: [
            { index: true, element: <SettingsPage /> },
            { path: 'opening', element: <OpeningBalancePage /> },
          ],
        },
      ],
    },
    { path: '*', element: <Navigate to="/" replace /> },
  ]);
}

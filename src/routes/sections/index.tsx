import { lazy, Suspense } from 'react';
import { Outlet, Navigate, useRoutes } from 'react-router-dom';

import { AccountingProvider } from 'src/store';
import { DashboardLayout } from 'src/layouts/dashboard';
import { AuthGuard, GuestGuard, RequireOwner, RequireWrite } from 'src/auth';

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
const MembersPage = lazy(() => import('src/pages/settings/members'));
const LoginPage = lazy(() => import('src/pages/auth/login'));
const SignupPage = lazy(() => import('src/pages/auth/signup'));
const AcceptInvitePage = lazy(() => import('src/pages/auth/accept-invite'));
const VerifyEmailPage = lazy(() => import('src/pages/auth/verify-email'));
const ForgotPasswordPage = lazy(() => import('src/pages/auth/forgot-password'));
const ResetPasswordPage = lazy(() => import('src/pages/auth/reset-password'));

const w = (page: React.ReactNode) => <RequireWrite>{page}</RequireWrite>;

/**
 * ทุกหน้าธุรกิจอยู่ใต้ AuthGuard → AccountingProvider → DashboardLayout → RouteErrorBoundary (หน้าพังแล้วเมนูยังใช้ได้)
 * โหมด local: AuthGuard ผ่านเสมอ (ผู้ใช้ทดลองบทบาท owner), หน้า login/signup พากลับหน้าแรก
 * โหมด api: ยังไม่ login → /login?returnTo=…; หน้าบันทึกเอกสาร (`w(...)`) viewer เข้าไม่ได้; ผู้ใช้งาน = owner
 */
export function Router() {
  const blank = (page: React.ReactNode) => <Suspense fallback={<LoadingScreen sx={{ minHeight: '100vh' }} />}>{page}</Suspense>;
  return useRoutes([
    { path: '/login', element: <GuestGuard>{blank(<LoginPage />)}</GuestGuard> },
    { path: '/signup', element: <GuestGuard>{blank(<SignupPage />)}</GuestGuard> },
    { path: '/accept-invite', element: blank(<AcceptInvitePage />) },
    // ลิงก์จากอีเมล — เปิดได้ทั้งตอน login อยู่และยังไม่ login
    { path: '/verify-email', element: blank(<VerifyEmailPage />) },
    { path: '/reset-password', element: blank(<ResetPasswordPage />) },
    { path: '/forgot-password', element: <GuestGuard>{blank(<ForgotPasswordPage />)}</GuestGuard> },
    {
      path: '/',
      element: (
        <AuthGuard>
          <AccountingProvider>
            <DashboardLayout>
              <RouteErrorBoundary>
                <Suspense fallback={<LoadingScreen />}>
                  <Outlet />
                </Suspense>
              </RouteErrorBoundary>
            </DashboardLayout>
          </AccountingProvider>
        </AuthGuard>
      ),
      children: [
        { index: true, element: <DashboardPage /> },
        {
          path: 'sales',
          children: [
            { index: true, element: <SalesListPage /> },
            { path: 'new', element: w(<SalesNewPage />) },
            { path: ':id', element: <SalesDetailPage /> },
            { path: ':id/credit-note', element: w(<CreditNotePage />) },
            { path: ':id/debit-note', element: w(<DebitNotePage />) },
            { path: 'receipts/:id', element: <ReceiptPage /> },
          ],
        },
        {
          path: 'purchases',
          children: [
            { index: true, element: <PurchaseListPage /> },
            { path: 'new', element: w(<PurchaseNewPage />) },
            { path: 'payments/:id', element: <PaymentPage /> },
            { path: ':id', element: <PurchaseDetailPage /> },
            { path: ':id/credit-note', element: w(<SupplierCreditNotePage />) },
          ],
        },
        {
          path: 'quotations',
          children: [
            { index: true, element: <QuotationListPage /> },
            { path: 'new', element: w(<QuotationNewPage />) },
            { path: ':id', element: <QuotationDetailPage /> },
            { path: ':id/edit', element: w(<QuotationEditPage />) },
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
            { path: 'opening', element: w(<OpeningBalancePage />) },
            {
              path: 'members',
              element: (
                <RequireOwner>
                  <MembersPage />
                </RequireOwner>
              ),
            },
          ],
        },
      ],
    },
    { path: '*', element: <Navigate to="/" replace /> },
  ]);
}

'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Dashboard } from '@/views/Dashboard';
import { PaymentTrend } from '@/views/PaymentTrend';
import { Forecast } from '@/views/Forecast';
import { BankTransactions } from '@/views/BankTransactions';
import { CardTransactions } from '@/views/CardTransactions';
import { AllTransactions } from '@/views/AllTransactions';
import { PaymentMethods } from '@/views/PaymentMethods';
import { Cards } from '@/views/Cards';
import { Family } from '@/views/Family';
import { Imports } from '@/views/Imports';
import { Categories } from '@/views/Categories';
import { RecurringExpenses } from '@/views/RecurringExpenses';
import { AdminHouseholds } from '@/views/AdminHouseholds';

export type View =
  | 'dashboard'
  | 'payment-trend'
  | 'forecast'
  | 'all-transactions'
  | 'bank-transactions'
  | 'card-transactions'
  | 'imports'
  | 'cards'
  | 'family'
  | 'categories'
  | 'recurring-expenses'
  | 'payment-methods'
  | 'admin-households';

export function Shell() {
  const [view, setView] = useState<View>('dashboard');
  return (
    <div className="app">
      <Sidebar view={view} onNavigate={setView} />
      <div className="main">
        {view === 'dashboard' && <Dashboard onNavigate={setView} />}
        {view === 'payment-trend' && <PaymentTrend />}
        {view === 'forecast' && <Forecast onNavigate={setView} />}
        {view === 'all-transactions' && <AllTransactions />}
        {view === 'bank-transactions' && <BankTransactions />}
        {view === 'card-transactions' && <CardTransactions />}
        {view === 'imports' && <Imports />}
        {view === 'cards' && <Cards />}
        {view === 'family' && <Family />}
        {view === 'categories' && <Categories />}
        {view === 'recurring-expenses' && <RecurringExpenses />}
        {view === 'payment-methods' && <PaymentMethods />}
        {view === 'admin-households' && <AdminHouseholds />}
      </div>
    </div>
  );
}

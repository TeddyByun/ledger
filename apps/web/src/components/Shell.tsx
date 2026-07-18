'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Dashboard } from '@/views/Dashboard';
import { BankTransactions } from '@/views/BankTransactions';
import { CardTransactions } from '@/views/CardTransactions';
import { PaymentMethods } from '@/views/PaymentMethods';
import { Cards } from '@/views/Cards';
import { Family } from '@/views/Family';
import { Imports } from '@/views/Imports';
import { Categories } from '@/views/Categories';

export type View =
  | 'dashboard'
  | 'bank-transactions'
  | 'card-transactions'
  | 'imports'
  | 'cards'
  | 'family'
  | 'categories'
  | 'payment-methods';

export function Shell() {
  const [view, setView] = useState<View>('dashboard');
  return (
    <div className="app">
      <Sidebar view={view} onNavigate={setView} />
      <div className="main">
        {view === 'dashboard' && <Dashboard onNavigate={setView} />}
        {view === 'bank-transactions' && <BankTransactions />}
        {view === 'card-transactions' && <CardTransactions />}
        {view === 'imports' && <Imports />}
        {view === 'cards' && <Cards />}
        {view === 'family' && <Family />}
        {view === 'categories' && <Categories />}
        {view === 'payment-methods' && <PaymentMethods />}
      </div>
    </div>
  );
}

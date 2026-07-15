'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Dashboard } from '@/views/Dashboard';
import { Transactions } from '@/views/Transactions';
import { PaymentMethods } from '@/views/PaymentMethods';
import { Cards } from '@/views/Cards';
import { Family } from '@/views/Family';
import { Imports } from '@/views/Imports';

export type View =
  | 'dashboard'
  | 'transactions'
  | 'imports'
  | 'cards'
  | 'family'
  | 'payment-methods';

export function Shell() {
  const [view, setView] = useState<View>('dashboard');
  return (
    <div className="app">
      <Sidebar view={view} onNavigate={setView} />
      <div className="main">
        {view === 'dashboard' && <Dashboard onNavigate={setView} />}
        {view === 'transactions' && <Transactions />}
        {view === 'imports' && <Imports />}
        {view === 'cards' && <Cards />}
        {view === 'family' && <Family />}
        {view === 'payment-methods' && <PaymentMethods />}
      </div>
    </div>
  );
}

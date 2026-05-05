import React, { useState } from 'react';
import NavBar from './components/NavBar';
import ChartGrid from './components/ChartGrid';
import StrategyCard from './components/StrategyCard';
import CRTStrategyCard from './components/CRTStrategyCard';
import EconomicEvents from './components/EconomicEvents';
import SignalLogModal from './components/SignalLogModal';
import JustinStrategyCard from './components/JustinStrategyCard';
import { SignalLogProvider } from './context/SignalLogContext';
import './App.css';

function AppInner() {
  const [symbol, setSymbol] = useState('EURUSD');
  const [logOpen, setLogOpen] = useState(false);

  return (
    <div className="app-container">
      <NavBar
        currentSymbol={symbol}
        onSymbolAdd={setSymbol}
        onOpenLog={() => setLogOpen(true)}
      />

      <main className="main-content">
        <div className="container">
          <div className="chart-header">
            <div className="chart-title">
              <h1 className="chart-symbol">{symbol}</h1>
              <span className="chart-subtitle">Live Dashboard v1.1.6 (Main Branch Sync)</span>
            </div>
          </div>

          <StrategyCard symbol={symbol} />
          <CRTStrategyCard symbol={symbol} />
          <JustinStrategyCard symbol={symbol} />
          <EconomicEvents symbol={symbol} />
          <ChartGrid symbol={symbol} />
        </div>
      </main>

      {logOpen && (
        <SignalLogModal 
          onClose={() => setLogOpen(false)} 
          onSelectSymbol={setSymbol}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <SignalLogProvider>
      <AppInner />
    </SignalLogProvider>
  );
}

export default App;

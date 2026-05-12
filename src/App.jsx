import React, { useState } from 'react';
import NavBar from './components/NavBar';
import ChartGrid from './components/ChartGrid';
import StrategyCard from './components/StrategyCard';
import CRTStrategyCard from './components/CRTStrategyCard';
import EconomicEventsModal from './components/EconomicEventsModal';
import SignalLogModal from './components/SignalLogModal';
import JustinStrategyCard from './components/JustinStrategyCard';
import { SignalLogProvider } from './context/SignalLogContext';
import './App.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("Crash caught by Boundary:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', textAlign: 'center', color: '#ff4444' }}>
          <h2>Something went wrong.</h2>
          <p>{this.state.error?.toString()}</p>
          <button onClick={() => window.location.reload()} className="btn btn-primary">Reload Page</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  const [symbol, setSymbol] = useState('EURUSD');
  const [logOpen, setLogOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  
  // Shared state for Justin Strategy FVGs (used as a filter for other strategies)
  const [htfFVGs, setHtfFVGs] = useState({});
  const updateHTF_FVG = (interval, fvg) => {
    setHtfFVGs(prev => ({ ...prev, [interval]: fvg }));
  };

  return (
    <div className="app-container">
      <NavBar
        currentSymbol={symbol}
        onSymbolAdd={setSymbol}
        onOpenLog={() => setLogOpen(true)}
        onOpenEvents={() => setEventsOpen(true)}
      />

      <main className="main-content">
        <div className="container">
          <div className="chart-header">
            <div className="chart-title">
              <h1 className="chart-symbol">{symbol}</h1>
              <span className="chart-subtitle">Live Dashboard v1.1.9 (High-Visibility FVG Update)</span>
            </div>
          </div>

          <StrategyCard symbol={symbol} htfFVGs={htfFVGs} />
          <CRTStrategyCard symbol={symbol} htfFVGs={htfFVGs} />
          <JustinStrategyCard symbol={symbol} htfFVGs={htfFVGs} updateHTF_FVG={updateHTF_FVG} />
          <ChartGrid symbol={symbol} />
        </div>
      </main>

      {logOpen && (
        <SignalLogModal 
          onClose={() => setLogOpen(false)} 
          onSelectSymbol={setSymbol}
        />
      )}

      {eventsOpen && (
        <EconomicEventsModal 
          symbol={symbol}
          onClose={() => setEventsOpen(false)}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <SignalLogProvider>
        <AppInner />
      </SignalLogProvider>
    </ErrorBoundary>
  );
}

export default App;

import React, { useMemo, useState, useEffect } from 'react';
import { X, CheckCircle2, XCircle, Clock, Trash2, TrendingUp, TrendingDown, Activity, Crosshair, LayoutList } from 'lucide-react';
import { useSignalLogContext } from '../context/SignalLogContext';

const TIMEFRAME_LABELS = { '240': '4H', '60': '1H', '15': '15M', '5': '5M' };

const TABS = [
  { key: 'all',        label: 'All Signals',          icon: <LayoutList size={14}/> },
  { key: 'Trendline',  label: 'Trendline Strategy',   icon: <Activity size={14}/> },
  { key: 'CRT (AMD)',  label: 'CRT (AMD) Strategy',   icon: <Crosshair size={14}/> },
];

const StatusBadge = ({ status }) => {
  const config = {
    ACTIVE:  { icon: <Clock size={11}/>,        label: 'Active',  cls: 'log-status-active' },
    SUCCESS: { icon: <CheckCircle2 size={11}/>, label: 'Success', cls: 'log-status-success' },
    FAILED:  { icon: <XCircle size={11}/>,      label: 'Failed',  cls: 'log-status-failed' },
  }[status] || { icon: null, label: status, cls: '' };

  return (
    <span className={`log-status-badge ${config.cls}`}>
      {config.icon} {config.label}
    </span>
  );
};

const calcStats = (logs) => {
  const closed = logs.filter(l => l.status !== 'ACTIVE');
  const success = closed.filter(l => l.status === 'SUCCESS').length;
  const failed = closed.filter(l => l.status === 'FAILED').length;
  const winRate = closed.length > 0 ? ((success / closed.length) * 100).toFixed(0) : '-';
  return {
    total: logs.length,
    active: logs.filter(l => l.status === 'ACTIVE').length,
    success,
    failed,
    winRate,
  };
};

const LogTable = ({ logs, onSelectSymbol }) => {
  const [prices, setPrices] = useState({});
  const { removeSignal } = useSignalLogContext();

  useEffect(() => {
    const fetchPrices = async () => {
      const symbols = [...new Set(logs.filter(l => l.status === 'ACTIVE').map(l => l.symbol))];
      if (symbols.length === 0) return;

      const newPrices = { ...prices };
      for (const sym of symbols) {
        try {
          let ticker = {
            'EURUSD': 'EURUSD=X', 'GBPUSD': 'GBPUSD=X', 'USDJPY': 'USDJPY=X',
            'XAUUSD': 'GC=F', 'S&P500': 'ES=F', 'NASDAQ': 'NQ=F'
          }[sym] || `${sym}=X`;
          const res = await fetch(`/api/finance/v8/finance/chart/${ticker}?interval=1m&range=1d`);
          const data = await res.json();
          const current = data.chart.result[0].meta.regularMarketPrice;
          newPrices[sym] = current;
        } catch (_) {}
      }
      setPrices(newPrices);
    };

    fetchPrices();
    const id = setInterval(fetchPrices, 15000); // Update every 15s
    return () => clearInterval(id);
  }, [logs]);

  const formatTime = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata'
    });
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata'
    });
  };

  const calcPnL = (log) => {
    if (log.status !== 'ACTIVE') {
      const diff = log.signal === 'BUY' ? (log.tp - log.entry) : (log.entry - log.tp);
      return log.status === 'SUCCESS' ? diff : -Math.abs(log.entry - log.sl);
    }
    const current = prices[log.symbol];
    if (!current) return null;
    return log.signal === 'BUY' ? (current - log.entry) : (log.entry - current);
  };

  if (logs.length === 0) {
    return (
      <div className="log-empty">
        <Clock size={40} color="var(--text-secondary)" />
        <p>No signals logged yet</p>
        <span>Signals appear here automatically when BUY or SELL conditions are detected.</span>
      </div>
    );
  }

  return (
    <table className="log-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Start</th>
          <th>Symbol</th>
          <th>TF</th>
          <th>Strategy</th>
          <th>Signal</th>
          <th>Entry</th>
          <th>PnL</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {logs.map(log => {
          const pnl = calcPnL(log);
          const isForex = !['GOLD', 'XAUUSD', 'S&P500', 'NASDAQ', 'SPX', 'NDX'].includes(log.symbol);
          const multiplier = isForex ? 10000 : 1;
          const pnlFormatted = pnl !== null ? (pnl * multiplier).toFixed(1) : '...';
          
          const tvTicker = {
            'EURUSD': 'FX:EURUSD', 'GBPUSD': 'FX:GBPUSD', 'USDJPY': 'FX:USDJPY',
            'XAUUSD': 'OANDA:XAUUSD', 'S&P500': 'OANDA:SPX500USD', 'NASDAQ': 'OANDA:NAS100USD'
          }[log.symbol] || log.symbol;

          const tvUrl = `https://www.tradingview.com/chart/?symbol=${tvTicker}&interval=${log.timeframe}`;

          return (
          <tr key={log.id} className={`log-row log-row-${log.status.toLowerCase()}`}>
            <td className="log-cell-time">{formatDate(log.timestamp)}</td>
            <td className="log-cell-time" style={{ fontWeight: 600, color: 'var(--accent-blue)' }}>{formatTime(log.timestamp)}</td>
            <td className="log-cell-symbol">{log.symbol}</td>
            <td><span className="log-tf-badge">{TIMEFRAME_LABELS[log.timeframe] || log.timeframe}</span></td>
            <td className="log-cell-strategy" style={{ fontSize: '0.7rem' }}>{log.strategy}</td>
            <td>
              <span className={`log-signal-badge ${log.signal.toLowerCase()}`}>
                {log.signal === 'BUY' ? <TrendingUp size={11}/> : <TrendingDown size={11}/>} {log.signal}
              </span>
            </td>
            <td className="log-cell-mono">{Number(log.entry).toFixed(isForex ? 5 : 2)}</td>
            <td className={`log-cell-mono ${pnl > 0 ? 'log-pnl-up' : pnl < 0 ? 'log-pnl-down' : ''}`} style={{ fontWeight: 700 }}>
              {pnl > 0 ? '+' : ''}{pnlFormatted}
            </td>
            <td><StatusBadge status={log.status} /></td>
            <td>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button 
                   onClick={() => onSelectSymbol(log.symbol)}
                   className="btn-action" 
                   title="View Setup on Dashboard"
                >
                   <LayoutList size={14} />
                </button>
                <a 
                   href={tvUrl} 
                   target="_blank" 
                   rel="noreferrer"
                   className="btn-action"
                   title="Open in TradingView"
                >
                   <Activity size={14} />
                </a>
                <button 
                   onClick={() => removeSignal(log.id)}
                   className="btn-action" 
                   title="Delete Signal"
                   style={{ color: 'var(--sell-red)' }}
                >
                   <Trash2 size={14} />
                </button>
              </div>
            </td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
};

const StatsBar = ({ stats }) => (
  <div className="log-stats-bar">
    {[
      { num: stats.total,   label: 'Total',   color: 'white' },
      { num: stats.active,  label: 'Active',  color: 'var(--accent-blue)' },
      { num: stats.success, label: 'Success', color: 'var(--buy-green)' },
      { num: stats.failed,  label: 'Failed',  color: 'var(--sell-red)' },
      {
        num: stats.winRate !== '-' ? `${stats.winRate}%` : '—',
        label: 'Win Rate',
        color: stats.winRate === '-' ? 'white'
             : Number(stats.winRate) >= 50 ? 'var(--buy-green)' : 'var(--sell-red)',
      },
    ].map(({ num, label, color }) => (
      <div key={label} className="log-stat">
        <span className="log-stat-num" style={{ color }}>{num}</span>
        <span className="log-stat-label">{label}</span>
      </div>
    ))}
  </div>
);

const SignalLogModal = ({ onClose, onSelectSymbol }) => {
  const { logs, clearLogs, addSignal } = useSignalLogContext();
  const [activeTab, setActiveTab] = useState('all');

  const filteredLogs = useMemo(() =>
    activeTab === 'all' ? logs : logs.filter(l => l.strategy === activeTab),
    [logs, activeTab]
  );

  const stats = useMemo(() => calcStats(filteredLogs), [filteredLogs]);

  const handleExport = () => {
    if (logs.length === 0) return;
    const headers = ['Timestamp', 'Symbol', 'Timeframe', 'Strategy', 'Signal', 'Entry', 'SL', 'TP', 'RR', 'Status', 'ClosedAt'];
    const csvContent = [
      headers.join(','),
      ...logs.map(log => [
        log.timestamp,
        log.symbol,
        log.timeframe,
        log.strategy,
        log.signal,
        log.entry,
        log.sl,
        log.tp,
        log.rr,
        log.status,
        log.closedAt || ''
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `fx_signals_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="log-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="log-modal animate-fade-in">

        {/* Header */}
        <div className="log-modal-header">
          <div className="log-modal-title">
            <span className="log-modal-icon">📋</span>
            <div>
              <h2>Signal Log</h2>
              <span className="log-modal-sub">Persistent outcome tracking · {logs.length} total entries</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button 
              onClick={handleExport}
              className="btn btn-outline"
              style={{ fontSize: '0.75rem', padding: '4px 12px' }}
            >
              Export CSV
            </button>
            <button 
              onClick={async () => {
                const btn = document.getElementById('scan-btn');
                if (btn) btn.innerText = 'Scanning...';
                try {
                  await fetch('/api/cron');
                  alert('Market Scan Complete! New signals logged to Database.');
                  window.location.reload();
                } catch (e) {
                  alert('Scan failed. Ensure Upstash Redis is connected.');
                } finally {
                  if (btn) btn.innerText = 'Scan Market';
                }
              }} 
              id="scan-btn"
              className="btn btn-primary" 
              style={{ fontSize: '0.75rem', padding: '4px 12px' }}
            >
              Scan Market
            </button>
            <button 
              onClick={() => {
                const testSignal = {
                  symbol: 'EURUSD',
                  timeframe: '15',
                  strategy: 'CRT (AMD)',
                  signal: 'BUY',
                  entry: 1.0850,
                  sl: 1.0820,
                  tp: 1.0910,
                  setupTime: Math.floor(Date.now() / 1000)
                };
                addSignal(testSignal);
              }} 
              className="btn btn-outline" 
              style={{ fontSize: '0.75rem', padding: '4px 8px', borderColor: 'var(--buy-green)', color: 'var(--buy-green)' }}
            >
              + Add Test
            </button>
            <button onClick={clearLogs} className="btn btn-outline log-clear-btn">
              <Trash2 size={13}/> Clear
            </button>
            <button onClick={onClose} className="log-close-btn"><X size={20}/></button>
          </div>
        </div>

        {/* Tabs */}
        <div className="log-tabs">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`log-tab ${activeTab === tab.key ? 'active' : ''}`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span className="log-tab-count">
                {tab.key === 'all' ? logs.length : logs.filter(l => l.strategy === tab.key).length}
              </span>
            </button>
          ))}
        </div>

        {/* Stats for current tab */}
        <StatsBar stats={stats} />

        {/* Table */}
        <div className="log-table-wrapper">
          <LogTable 
            logs={filteredLogs} 
            onSelectSymbol={(sym) => {
              onSelectSymbol(sym);
              onClose();
            }} 
          />
        </div>

      </div>
    </div>
  );
};

export default SignalLogModal;

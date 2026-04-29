import React, { useMemo, useState } from 'react';
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

const LogTable = ({ logs }) => {
  const formatTime = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
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
          <th>Time</th>
          <th>Symbol</th>
          <th>TF</th>
          <th>Strategy</th>
          <th>Signal</th>
          <th>Entry</th>
          <th>SL</th>
          <th>TP</th>
          <th>R:R</th>
          <th>Status</th>
          <th>Closed At</th>
        </tr>
      </thead>
      <tbody>
        {logs.map(log => (
          <tr key={log.id} className={`log-row log-row-${log.status.toLowerCase()}`}>
            <td className="log-cell-time">{formatTime(log.timestamp)}</td>
            <td className="log-cell-symbol">{log.symbol}</td>
            <td><span className="log-tf-badge">{TIMEFRAME_LABELS[log.timeframe] || log.timeframe}</span></td>
            <td className="log-cell-strategy">{log.strategy}</td>
            <td>
              <span className={`log-signal-badge ${log.signal.toLowerCase()}`}>
                {log.signal === 'BUY' ? <TrendingUp size={11}/> : <TrendingDown size={11}/>} {log.signal}
              </span>
            </td>
            <td className="log-cell-mono">{Number(log.entry).toFixed(5)}</td>
            <td className="log-cell-mono log-cell-sl">{Number(log.sl).toFixed(5)}</td>
            <td className="log-cell-mono log-cell-tp">{Number(log.tp).toFixed(5)}</td>
            <td className="log-cell-rr">{log.rr}x</td>
            <td><StatusBadge status={log.status} /></td>
            <td className="log-cell-time">{formatTime(log.closedAt)}</td>
          </tr>
        ))}
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

const SignalLogModal = ({ onClose }) => {
  const { logs, clearLogs } = useSignalLogContext();
  const [activeTab, setActiveTab] = useState('all');

  const filteredLogs = useMemo(() =>
    activeTab === 'all' ? logs : logs.filter(l => l.strategy === activeTab),
    [logs, activeTab]
  );

  const stats = useMemo(() => calcStats(filteredLogs), [filteredLogs]);

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
            <button onClick={clearLogs} className="btn btn-outline log-clear-btn">
              <Trash2 size={13}/> Clear All
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
          <LogTable logs={filteredLogs} />
        </div>

      </div>
    </div>
  );
};

export default SignalLogModal;

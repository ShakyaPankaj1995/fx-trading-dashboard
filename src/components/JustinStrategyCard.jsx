import React, { useState } from 'react';
import JustinSignal from './JustinSignal';
import { Zap, RefreshCw } from 'lucide-react';

const JustinStrategyCard = ({ symbol }) => {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [loadingCount, setLoadingCount] = useState(0);
  const [htfFVGs, setHtfFVGs] = useState({});

  const handleRefresh = () => {
    if (loadingCount > 0) return;
    setRefreshTrigger(prev => prev + 1);
  };

  const handleLoadStart = () => setLoadingCount(c => c + 1);
  const handleLoadEnd   = () => setLoadingCount(c => Math.max(0, c - 1));
  const isRefreshing    = loadingCount > 0;

  const updateHTF_FVG = (interval, fvg) => {
    setHtfFVGs(prev => ({ ...prev, [interval]: fvg }));
  };

  const timeframes = [
    { label: '4 Hours',   interval: '240' },
    { label: '1 Hour',    interval: '60'  },
    { label: '15 Minutes', interval: '15' },
    { label: '5 Minutes',  interval: '5'  },
  ];

  return (
    <div
      className="strategy-overview-card animate-fade-in"
      style={{ borderColor: 'rgba(251, 191, 36, 0.35)', borderWidth: '1px', borderStyle: 'solid' }}
    >
      {/* Header */}
      <div className="strategy-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Zap size={24} color="#fbbf24" />
          <div>
            <h2 style={{ margin: 0 }}>Justin Setup</h2>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              FVG · Turtle Soup Trap · SMT Divergence · CISD
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* SMT legend */}
          <div style={{
            fontSize: '0.7rem',
            color: 'var(--text-secondary)',
            background: 'rgba(251, 191, 36, 0.08)',
            border: '1px solid rgba(251, 191, 36, 0.2)',
            borderRadius: '8px',
            padding: '4px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}>
            <span style={{ fontWeight: 700, color: '#fbbf24' }}>SMT Pairs</span>
            <span>NQ ↔ ES &nbsp;|&nbsp; EUR ↔ GBP &nbsp;|&nbsp; XAU ↔ Silver</span>
          </div>

          <button
            onClick={handleRefresh}
            className="btn btn-outline"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', opacity: isRefreshing ? 0.7 : 1 }}
            disabled={isRefreshing}
          >
            <RefreshCw size={14} className={isRefreshing ? 'spin-icon' : ''} />
            <span style={{ fontSize: '0.85rem' }}>
              {isRefreshing ? 'Scanning...' : 'Refresh Justin'}
            </span>
          </button>
        </div>
      </div>

      {/* Signal Grid */}
      <div className="strategy-card-grid">
        {timeframes.map(tf => (
          <div
            key={tf.interval}
            className="strategy-timeframe-section"
            style={{ borderColor: 'rgba(251, 191, 36, 0.1)' }}
          >
            <div className="strategy-timeframe-label">{tf.label}</div>
            <JustinSignal
              symbol={symbol}
              interval={tf.interval}
              refreshTrigger={refreshTrigger}
              onLoadStart={handleLoadStart}
              onLoadEnd={handleLoadEnd}
              htfFVGs={tf.interval === '5' ? htfFVGs : null}
              onUpdateFVG={tf.interval !== '5' ? updateHTF_FVG : null}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default JustinStrategyCard;

import React, { useState } from 'react';
import ChartSignal from './ChartSignal';
import { Crosshair, RefreshCw } from 'lucide-react';

const CRTStrategyCard = ({ symbol }) => {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [loadingCount, setLoadingCount] = useState(0);

  const handleRefresh = () => {
    if (loadingCount > 0) return;
    setRefreshTrigger(prev => prev + 1);
  };

  const handleLoadStart = () => setLoadingCount(c => c + 1);
  const handleLoadEnd = () => setLoadingCount(c => Math.max(0, c - 1));

  const isRefreshing = loadingCount > 0;

  const timeframes = [
    { label: '4 Hours', interval: '240' },
    { label: '1 Hour', interval: '60' },
    { label: '15 Minutes', interval: '15' },
    { label: '5 Minutes', interval: '5' }
  ];

  return (
    <div className="strategy-overview-card animate-fade-in" style={{ borderColor: 'rgba(139, 92, 246, 0.3)' }}>
      <div className="strategy-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Crosshair size={24} color="#8b5cf6" />
          <h2>Candle Range Theory (AMD) Signals</h2>
        </div>
        <button 
          onClick={handleRefresh} 
          className="btn btn-outline" 
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', opacity: isRefreshing ? 0.7 : 1 }}
          disabled={isRefreshing}
        >
          <RefreshCw size={14} className={isRefreshing ? 'spin-icon' : ''} />
          <span style={{ fontSize: '0.85rem' }}>{isRefreshing ? 'Analyzing CRT...' : 'Refresh CRT'}</span>
        </button>
      </div>
      <div className="strategy-card-grid">
        {timeframes.map((tf) => (
          <div key={tf.interval} className="strategy-timeframe-section" style={{ borderColor: 'rgba(139, 92, 246, 0.1)' }}>
            <div className="strategy-timeframe-label">{tf.label}</div>
            <ChartSignal 
              symbol={symbol} 
              interval={tf.interval} 
              strategyType="crt"
              isCompact={true} 
              refreshTrigger={refreshTrigger}
              onLoadStart={handleLoadStart}
              onLoadEnd={handleLoadEnd}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default CRTStrategyCard;

import React from 'react';
import TradingViewWidget from './TradingViewWidget';
import { Clock } from 'lucide-react';

const ChartGrid = ({ symbol }) => {
  const timeframes = [
    { label: '4 Hours', interval: '240' },
    { label: '1 Hour', interval: '60' },
    { label: '15 Minutes', interval: '15' },
    { label: '5 Minutes', interval: '5' }
  ];

  return (
    <div className="chart-grid">
      {timeframes.map((tf) => (
        <div key={tf.interval} className="chart-container animate-fade-in">
          <div className="chart-toolbar">
            <span style={{ color: 'var(--text-secondary)' }}>{symbol} Analysis</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Clock size={14} color="var(--accent-blue)" />
              <span className="timeframe-badge">{tf.label}</span>
            </div>
          </div>
          <div className="widget-wrapper">
            <TradingViewWidget symbol={symbol} interval={tf.interval} />
          </div>
        </div>
      ))}
    </div>
  );
};

export default ChartGrid;

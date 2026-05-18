import React, { useState } from 'react';
import { LineChart, ClipboardList, Calendar } from 'lucide-react';
import { useSignalLogContext } from '../context/SignalLogContext';

const NavBar = ({ currentSymbol, onSymbolAdd, onOpenLog, onOpenEvents }) => {
  const assets = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'S&P500', 'NASDAQ'];
  const { logs, addSignal } = useSignalLogContext();
  const activeCount = logs.filter(l => l.status === 'ACTIVE').length;

  return (
    <nav className="navbar">
      <a href="/" className="nav-brand">
        <LineChart className="nav-brand-icon" size={28} />
        <span>FX Master <small style={{ fontSize: '0.6rem', opacity: 0.5 }}>v1.5.2</small></span>
      </a>

      <div className="nav-controls" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {assets.map((asset) => (
          <button
            key={asset}
            onClick={() => onSymbolAdd(asset)}
            className={`btn ${currentSymbol === asset ? 'btn-primary' : 'btn-outline'}`}
            style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '0.85rem' }}
          >
            {asset}
          </button>
        ))}

        <div style={{ width: '1px', height: '24px', background: 'var(--border-color)', margin: '0 4px' }} />


        <button
          onClick={onOpenEvents}
          className="btn btn-outline"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '20px' }}
        >
          <Calendar size={16} color="var(--accent-blue)" />
          <span style={{ fontSize: '0.85rem' }}>Economic Calendar</span>
        </button>

        <button
          onClick={onOpenLog}
          className="btn btn-outline log-nav-btn"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '20px', position: 'relative' }}
        >
          <ClipboardList size={16} />
          <span style={{ fontSize: '0.85rem' }}>Signal Log</span>
          {activeCount > 0 && (
            <span className="log-active-dot">{activeCount}</span>
          )}
        </button>
      </div>
    </nav>
  );
};

export default NavBar;

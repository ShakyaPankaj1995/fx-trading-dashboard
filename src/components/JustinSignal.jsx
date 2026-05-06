import React, { useState, useEffect, useRef } from 'react';
import { analyzeJustinSetup } from '../utils/justinStrategy';
import { Target, ShieldAlert, ArrowRight, RefreshCw, Zap, TrendingUp, TrendingDown } from 'lucide-react';
import { useSignalLogContext } from '../context/SignalLogContext';

const TIMEFRAME_LABELS = { '240': '4H', '60': '1H', '15': '15M', '5': '5M' };

// SMT Correlated pairs: when analyzing NQ, check ES and vice versa
const SMT_PAIRS = {
  'NASDAQ': { ticker: 'NQ=F', correlatedTicker: 'ES=F', correlatedName: 'S&P500' },
  'S&P500': { ticker: 'ES=F', correlatedTicker: 'NQ=F', correlatedName: 'NASDAQ' },
  'EURUSD': { ticker: 'EURUSD=X', correlatedTicker: 'GBPUSD=X', correlatedName: 'GBPUSD' },
  'GBPUSD': { ticker: 'GBPUSD=X', correlatedTicker: 'EURUSD=X', correlatedName: 'EURUSD' },
  'XAUUSD': { ticker: 'GC=F', correlatedTicker: 'SI=F', correlatedName: 'Silver' },
  'USDJPY': { ticker: 'USDJPY=X', correlatedTicker: null, correlatedName: null },
};

const JustinSignal = ({ symbol, interval, refreshTrigger, onLoadStart, onLoadEnd }) => {
  const [signalData, setSignalData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [smtStatus, setSmtStatus] = useState(null);
  const { addSignal } = useSignalLogContext();
  const lastLoggedRef = useRef(null);

  const fetchAndAnalyze = async () => {
    setLoading(true);
    setError(null);
    onLoadStart?.();

    try {
      let yfInterval = '15m';
      let range = '5d';
      switch (interval) {
        case '240': yfInterval = '60m'; range = '1mo'; break;
        case '60':  yfInterval = '60m'; range = '1mo'; break;
        case '15':  yfInterval = '15m'; range = '5d';  break;
        case '5':   yfInterval = '5m';  range = '5d';  break;
      }

      const pair = SMT_PAIRS[symbol] || {};
      const primaryTicker = pair.ticker || `${symbol}=X`;

      // Fetch primary asset
      const res = await fetch(`/api/finance/v8/finance/chart/${primaryTicker}?interval=${yfInterval}&range=${range}`);
      if (!res.ok) throw new Error('Data fetch failed');
      const json = await res.json();
      const primaryData = json.chart.result[0];

      // Fetch correlated asset for SMT
      let correlatedData = null;
      if (pair.correlatedTicker) {
        try {
          const res2 = await fetch(`/api/finance/v8/finance/chart/${pair.correlatedTicker}?interval=${yfInterval}&range=${range}`);
          if (res2.ok) {
            const json2 = await res2.json();
            correlatedData = json2.chart.result[0];
            setSmtStatus(`SMT: ${pair.correlatedName} ✓`);
          }
        } catch (_) {
          setSmtStatus('SMT: Unavailable');
        }
      }

      const analysis = analyzeJustinSetup(primaryData, correlatedData, interval);
      setSignalData(analysis);

      if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
        const key = `${symbol}-${interval}-justin-${analysis.signal}-${analysis.entry?.toFixed(2)}`;
        if (lastLoggedRef.current !== key) {
          lastLoggedRef.current = key;
          addSignal({
            symbol,
            timeframe: interval,
            strategy: 'Justin Setup',
            signal: analysis.signal,
            entry: analysis.entry,
            sl: analysis.sl,
            tp: analysis.tp,
            setupTime: analysis.setupTime
          });
        }
      }
    } catch (err) {
      console.error(err);
      setError('Signal data unavailable');
    } finally {
      setLoading(false);
      onLoadEnd?.();
    }
  };

  useEffect(() => {
    fetchAndAnalyze();
    const id = setInterval(fetchAndAnalyze, 60000);
    return () => clearInterval(id);
  }, [symbol, interval, refreshTrigger]);

  if (loading && !signalData) {
    return (
      <div className="chart-signal loading">
        <RefreshCw className="spin-icon" size={14} />
        <span>Scanning FVG + SMT...</span>
      </div>
    );
  }

  if (error) return <div className="chart-signal error"><span>{error}</span></div>;

  const { signal, reason, entry, sl, tp, reasoning, setupTime, confirmations, color } = signalData;
  const isNeutral = signal === 'NEUTRAL' || signal === 'WAIT';
  const is5m = interval === '5';

  return (
    <div className={`chart-signal compact ${signal.toLowerCase()}`} style={{ borderLeft: color ? `4px solid ${color}` : '' }}>
      <div className="signal-left">
        <div className={`signal-badge-small ${signal.toLowerCase()}`}>
          {signal === 'BUY' ? <TrendingUp size={10}/> : signal === 'SELL' ? <TrendingDown size={10}/> : null}
          {' '}{signal}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="signal-reason-small" style={{ color: color || '' }}>{reason}</span>
          {setupTime && (
            <span style={{ fontSize: '0.6rem', opacity: 0.6, marginTop: '2px' }}>
              Start: {new Date(setupTime * 1000).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
            </span>
          )}
        </div>
      </div>

      {is5m && confirmations && (
        <div style={{ padding: '8px', background: 'rgba(0,0,0,0.1)', borderRadius: '6px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem' }}>
            {confirmations.inFVG ? <span style={{ color: 'var(--buy-green)' }}>✅</span> : <span style={{ opacity: 0.3 }}>⭕</span>}
            <span style={{ opacity: confirmations.inFVG ? 1 : 0.5 }}>Price inside HTF FVG</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem' }}>
            {confirmations.sweep ? <span style={{ color: 'var(--buy-green)' }}>✅</span> : <span style={{ opacity: 0.3 }}>⭕</span>}
            <span style={{ opacity: confirmations.sweep ? 1 : 0.5 }}>Internal Liquidity Sweep</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem' }}>
            {confirmations.cisd ? <span style={{ color: 'var(--buy-green)' }}>✅</span> : <span style={{ opacity: 0.3 }}>⭕</span>}
            <span style={{ opacity: confirmations.cisd ? 1 : 0.5 }}>CISD (Displacement)</span>
          </div>
        </div>
      )}

      {!isNeutral && (
        <div className="signal-right">
          <div className="signal-prices">
            <div className="price-item">
              <span className="price-label">Entry</span>
              <span className="price-value">{entry?.toFixed(2)}</span>
            </div>
            <ArrowRight size={12} color="var(--border-color)" />
            <div className="price-item">
              <span className="price-label"><Target size={12}/> TP</span>
              <span className="price-value tp">{tp?.toFixed(2)}</span>
            </div>
            <div className="price-item">
              <span className="price-label"><ShieldAlert size={12}/> SL</span>
              <span className="price-value sl">{sl?.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {!isNeutral && reasoning?.length > 0 && (
        <div className="signal-reasoning">
          <div className="reasoning-title">Justin Setup Logic</div>
          <ul className="reasoning-list">
            {reasoning.map((r, i) => <li key={i} className="reasoning-item">{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
};

export default JustinSignal;

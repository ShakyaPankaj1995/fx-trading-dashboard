import React, { useState, useEffect, useRef } from 'react';
import { analyzeData, analyzeCRTData } from '../utils/strategy';
import { Target, ShieldAlert, ArrowRight, RefreshCw } from 'lucide-react';
import { useSignalLogContext } from '../context/SignalLogContext';

const TIMEFRAME_LABELS = { '240': '4H', '60': '1H', '15': '15M', '5': '5M' };

const ChartSignal = ({ symbol, interval, strategyType = 'trendline', isCompact = false, refreshTrigger = 0, onLoadStart, onLoadEnd, disableTrades = false }) => {
  const [signalData, setSignalData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { logs, addSignal } = useSignalLogContext();
  const lastLoggedSignalRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const fetchAndAnalyze = async () => {
    // Don't clear existing data during refresh — keep last state visible
    if (!signalData) setLoading(true);
    setError(null);
    onLoadStart?.();
    try {
      let yfInterval = '15m';
      let range = '5d';
      
      switch(interval) {
        case '240': yfInterval = '60m'; range = '1mo'; break;
        case '60':  yfInterval = '60m'; range = '5d';  break;
        case '15':  yfInterval = '15m'; range = '5d';  break;
        case '5':   yfInterval = '5m';  range = '5d';  break;
        default:    yfInterval = '15m'; range = '5d';
      }

      let yfSymbol = `${symbol}=X`;
      if (symbol === 'SPX' || symbol === 'S&P500' || symbol === 'SP500') yfSymbol = 'ES=F';
      else if (symbol === 'NDX' || symbol === 'NASDAQ') yfSymbol = 'NQ=F';
      else if (symbol === 'XAUUSD' || symbol === 'GOLD') yfSymbol = 'GC=F';

      const res = await fetch(`/api/finance/v8/finance/chart/${yfSymbol}?interval=${yfInterval}&range=${range}`);
      if (!res.ok) throw new Error('Data fetch failed');
      const json = await res.json();
      const chartData = json.chart.result[0];
      
      const analysis = strategyType === 'crt' 
        ? analyzeCRTData(chartData, interval)
        : analyzeData(chartData, interval);
      
      if (disableTrades) {
        analysis.signal = 'WAIT';
        analysis.reason = 'Awaiting Justin HTF Alignment (4H, 1H, 15M)';
      }

      if (!isMountedRef.current) return; // Don't update if unmounted
      setSignalData(analysis);

      // Log actionable signals (dedup uses addSignal's internal checks)
      if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
        const logKey = `${symbol}-${interval}-${strategyType}-${analysis.signal}-${analysis.entry?.toFixed(5)}`;
        if (lastLoggedSignalRef.current !== logKey) {
          lastLoggedSignalRef.current = logKey;
          addSignal({
            symbol,
            timeframe: interval,
            strategy: strategyType === 'crt' ? 'CRT (AMD)' : 'Trendline',
            signal: analysis.signal,
            entry: analysis.entry,
            sl: analysis.sl,
            tp: analysis.tp,
            setupTime: analysis.setupTime,
            currentPrice: chartData.meta.regularMarketPrice
          });
        }
      }
    } catch (err) {
      console.error(err);
      if (!signalData) setError('Signal data unavailable'); // Only show error if no prior data
    } finally {
      setLoading(false);
      onLoadEnd?.();
    }
  };

  useEffect(() => {
    fetchAndAnalyze();
    const refreshInterval = setInterval(fetchAndAnalyze, 60000);
    return () => clearInterval(refreshInterval);
  }, [symbol, interval, refreshTrigger, disableTrades]);

  if (loading && !signalData) {
    return (
      <div className="chart-signal loading">
        <RefreshCw className="spin-icon" size={14} />
        <span>Analyzing...</span>
      </div>
    );
  }

  if (error) {
    return <div className="chart-signal error"><span>{error}</span></div>;
  }

  const activeLoggedTrade = logs.find(l => 
    l.status === 'ACTIVE' && 
    l.symbol === symbol && 
    l.timeframe === interval && 
    l.strategy === (strategyType === 'crt' ? 'CRT (AMD)' : 'Trendline')
  );

  const displayData = activeLoggedTrade ? {
    signal: activeLoggedTrade.signal,
    entry: activeLoggedTrade.entry,
    sl: activeLoggedTrade.sl,
    tp: activeLoggedTrade.tp,
    reason: activeLoggedTrade.reason || signalData?.reason || 'Active Trade Logged',
    reasoning: activeLoggedTrade.reasoning && activeLoggedTrade.reasoning.length > 0 
      ? activeLoggedTrade.reasoning 
      : signalData?.reasoning?.length > 0 
        ? signalData.reasoning 
        : ['Trade is currently active and awaiting success or failure.'],
    setupTime: activeLoggedTrade.setupTime ? new Date(activeLoggedTrade.setupTime).getTime() / 1000 : null
  } : signalData;

  const { signal, reason, entry, sl, tp, reasoning, setupTime } = displayData;
  const isNeutral = signal === 'NEUTRAL' || signal === 'WAIT';

  return (
    <div className={`chart-signal ${isCompact ? 'compact' : ''} ${signal.toLowerCase()}`}>
      <div className="signal-left">
        <div className={`signal-badge-small ${signal.toLowerCase()}`}>{signal}</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="signal-reason-small">{reason}</span>
          {setupTime && (
            <span style={{ fontSize: '0.6rem', opacity: 0.6, marginTop: '2px' }}>
              Start: {new Date(setupTime * 1000).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
            </span>
          )}
        </div>
      </div>

      {!isNeutral && (
        <div className="signal-right">
          <div className="signal-prices">
            <div className="price-item">
              <span className="price-label">Entry</span>
              <span className="price-value">{entry?.toFixed(5)}</span>
            </div>
            <ArrowRight size={12} color="var(--border-color)" />
            <div className="price-item">
              <span className="price-label"><Target size={12}/> TP</span>
              <span className="price-value tp">{tp?.toFixed(5)}</span>
            </div>
            <div className="price-item">
              <span className="price-label"><ShieldAlert size={12}/> SL</span>
              <span className="price-value sl">{sl?.toFixed(5)}</span>
            </div>
          </div>
        </div>
      )}

      {!isNeutral && reasoning && reasoning.length > 0 && (
        <div className="signal-reasoning">
          <div className="reasoning-title">Why this signal?</div>
          <ul className="reasoning-list">
            {reasoning.map((r, i) => (
              <li key={i} className="reasoning-item">{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ChartSignal;

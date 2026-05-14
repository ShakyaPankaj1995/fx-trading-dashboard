import React, { useState, useEffect, useRef } from 'react';
import { analyzeJustinSetup } from '../utils/justinStrategy';
import { Target, ShieldAlert, ArrowRight, RefreshCw, Zap, TrendingUp, TrendingDown } from 'lucide-react';
import { useSignalLogContext } from '../context/SignalLogContext';

const TIMEFRAME_LABELS = { '240': '4H', '60': '1H', '15': '15M', '5': '5M' };

// Aggregate 60m candles into 4H candles (Yahoo Finance has no native 4H interval)
function aggregateRawTo4H(data) {
  const ts = data.timestamp;
  const q = data.indicators.quote[0];
  const groups = {};
  for (let i = 0; i < ts.length; i++) {
    if (q.open[i] == null || q.high[i] == null || q.low[i] == null || q.close[i] == null) continue;
    const blockKey = Math.floor(ts[i] / (4 * 3600)) * (4 * 3600);
    if (!groups[blockKey]) {
      groups[blockKey] = { time: blockKey, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i] };
    } else {
      const g = groups[blockKey];
      g.high = Math.max(g.high, q.high[i]);
      g.low = Math.min(g.low, q.low[i]);
      g.close = q.close[i];
    }
  }
  const sorted = Object.values(groups).sort((a, b) => a.time - b.time);
  return {
    timestamp: sorted.map(c => c.time),
    indicators: { quote: [{ open: sorted.map(c => c.open), high: sorted.map(c => c.high), low: sorted.map(c => c.low), close: sorted.map(c => c.close) }] }
  };
}

// SMT Correlated pairs: when analyzing NQ, check ES and vice versa
const SMT_PAIRS = {
  'NASDAQ': { ticker: 'NQ=F', correlatedTicker: 'ES=F', correlatedName: 'S&P500' },
  'S&P500': { ticker: 'ES=F', correlatedTicker: 'NQ=F', correlatedName: 'NASDAQ' },
  'EURUSD': { ticker: 'EURUSD=X', correlatedTicker: 'GBPUSD=X', correlatedName: 'GBPUSD' },
  'GBPUSD': { ticker: 'GBPUSD=X', correlatedTicker: 'EURUSD=X', correlatedName: 'EURUSD' },
  'XAUUSD': { ticker: 'GC=F', correlatedTicker: 'SI=F', correlatedName: 'Silver' },
  'USDJPY': { ticker: 'USDJPY=X', correlatedTicker: null, correlatedName: null },
};

const JustinSignal = ({ symbol, interval, refreshTrigger, onLoadStart, onLoadEnd, htfFVGs, onUpdateFVG }) => {
  const [signalData, setSignalData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [smtStatus, setSmtStatus] = useState(null);
  const { logs, addSignal } = useSignalLogContext();
  const lastLoggedRef = useRef(null);
  const isMountedRef = useRef(true);

  // --- Step 1: Hooks MUST be at the top ---
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const fetchAndAnalyze = async () => {
    if (!signalData) setLoading(true);
    setError(null);
    onLoadStart?.();
    try {
      let yfInterval = '15m';
      let range = '5d';
      switch (interval) {
        case '240': yfInterval = '60m'; range = '1mo'; break;
        case '60':  yfInterval = '60m'; range = '5d';  break;
        case '15':  yfInterval = '15m'; range = '5d';  break;
        case '5':   yfInterval = '5m';  range = '5d';  break;
      }
      const pair = SMT_PAIRS[symbol] || {};
      const primaryTicker = pair.ticker || `${symbol}=X`;
      const res = await fetch(`/api/finance/v8/finance/chart/${primaryTicker}?interval=${yfInterval}&range=${range}`);
      if (!res.ok) throw new Error('Data fetch failed');
      const json = await res.json();
      let primaryData = json.chart.result[0];
      if (interval === '240') primaryData = aggregateRawTo4H(primaryData);
      
      let correlatedData = null;
      if (pair.correlatedTicker) {
        try {
          const res2 = await fetch(`/api/finance/v8/finance/chart/${pair.correlatedTicker}?interval=${yfInterval}&range=${range}`);
          if (res2.ok) {
            const json2 = await res2.json();
            let cd = json2.chart.result[0];
            if (interval === '240') cd = aggregateRawTo4H(cd);
            correlatedData = cd;
            setSmtStatus(`SMT: ${pair.correlatedName} ✓`);
          }
        } catch (_) { setSmtStatus('SMT: Unavailable'); }
      }

      const analysis = analyzeJustinSetup(primaryData, correlatedData, interval);
      if (!isMountedRef.current) return;
      setSignalData(analysis);

      if (interval !== '5' && onUpdateFVG) {
        const activeFVG = analysis.activeBullFVG || analysis.activeBearFVG;
        onUpdateFVG(interval, activeFVG ? { ...activeFVG, type: analysis.activeBullFVG ? 'BULL' : 'BEAR' } : null);
      }

      if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
        const key = `${symbol}-${interval}-justin-${analysis.signal}-${analysis.entry?.toFixed(2)}`;
        if (lastLoggedRef.current !== key) {
          lastLoggedRef.current = key;
          addSignal({
            symbol, timeframe: interval, strategy: 'Justin Setup',
            signal: analysis.signal, entry: analysis.entry, sl: analysis.sl, tp: analysis.tp,
            setupTime: analysis.setupTime,
            currentPrice: primaryData.meta.regularMarketPrice
          });
        }
      }
    } catch (err) {
      console.error(err);
      if (!signalData) setError('Signal data unavailable');
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

  useEffect(() => {
    if (interval !== '5' && onUpdateFVG && signalData) {
      onUpdateFVG(interval, {
        bullish: signalData.nearestBullFVG,
        bearish: signalData.nearestBearFVG
      });
    }
  }, [signalData, interval]);

  // Log signal automatically if conditions met (5M only)
  useEffect(() => {
    if (interval === '5' && signalData && htfFVGs && addSignal) {
      const cp = signalData.currentPrice;
      let allBullish = true;
      let allBearish = true;
      let inFVGsCount = 0;

      Object.entries(htfFVGs).forEach(([tf, fvgs]) => {
        if (fvgs?.bullish && cp >= fvgs.bullish.low && cp <= fvgs.bullish.high) {
          inFVGsCount++;
          allBearish = false;
        } else if (fvgs?.bearish && cp >= fvgs.bearish.low && cp <= fvgs.bearish.high) {
          inFVGsCount++;
          allBullish = false;
        }
      });

      const isAlignedBullish = inFVGsCount > 0 && allBullish;
      const isAlignedBearish = inFVGsCount > 0 && allBearish;

      let finalSignal = 'NEUTRAL';
      let entry, sl, tp;

      if (isAlignedBullish && signalData.sweep?.type === 'BUY_SWEEP' && signalData.bullishCISD) {
         finalSignal = 'BUY';
         entry = signalData.cisdBullFVG ? signalData.cisdBullFVG.low : cp;
         sl = signalData.sweep.sweepLow - signalData.atr * 0.1;
         tp = entry + (entry - sl) * 2.5;
      } else if (isAlignedBearish && signalData.sweep?.type === 'SELL_SWEEP' && signalData.bearishCISD) {
         finalSignal = 'SELL';
         entry = signalData.cisdBearFVG ? signalData.cisdBearFVG.high : cp;
         sl = signalData.sweep.sweepHigh + signalData.atr * 0.1;
         tp = entry - (sl - entry) * 2.5;
      }

      if (finalSignal === 'BUY' || finalSignal === 'SELL') {
        const key = `${symbol}-5-justin-${finalSignal}-${entry?.toFixed(2)}`;
        if (lastLoggedRef.current !== key) {
          lastLoggedRef.current = key;
          addSignal({
            symbol, timeframe: '5', strategy: 'Justin Setup',
            signal: finalSignal, entry, sl, tp,
            setupTime: signalData.setupTime,
            currentPrice: cp
          });
        }
      }
    }
  }, [signalData, htfFVGs, interval, symbol, addSignal]);

  // --- Step 2: Calculations based on signalData ---
  const cp = signalData?.currentPrice;
  const inFVGs = [];
  let allBullish = true;
  let allBearish = true;

  if (signalData && htfFVGs) {
    Object.entries(htfFVGs).forEach(([tf, fvgs]) => {
      const label = TIMEFRAME_LABELS[tf] || tf;
      if (fvgs?.bullish && cp >= fvgs.bullish.low && cp <= fvgs.bullish.high) {
        inFVGs.push({ tf: label, type: 'BULL' });
        allBearish = false;
      } else if (fvgs?.bearish && cp >= fvgs.bearish.low && cp <= fvgs.bearish.high) {
        inFVGs.push({ tf: label, type: 'BEAR' });
        allBullish = false;
      }
    });
  }

  const isAlignedBullish = inFVGs.length > 0 && allBullish;
  const isAlignedBearish = inFVGs.length > 0 && allBearish;

  let tick1Active = inFVGs.length > 0;
  let tick1Text = tick1Active 
    ? `Price in HTF FVG (${inFVGs.map(f => `${f.tf} ${f.type === 'BULL' ? 'Bullish' : 'Bearish'}`).join(', ')})`
    : 'Price not in HTF FVG';

  let tick2Active = false;
  let tick2Text = 'Waiting for HTF Alignment';
  if (isAlignedBullish) {
    tick2Active = signalData?.sweep?.type === 'BUY_SWEEP';
    tick2Text = tick2Active ? `Internal Low Swept (${signalData.sweep.sweepLow.toFixed(2)})` : 'Waiting for Internal Low Sweep';
  } else if (isAlignedBearish) {
    tick2Active = signalData?.sweep?.type === 'SELL_SWEEP';
    tick2Text = tick2Active ? `Internal High Swept (${signalData.sweep.sweepHigh.toFixed(2)})` : 'Waiting for Internal High Sweep';
  }

  let tick3Active = false;
  let tick3Text = 'Waiting for Sweep to check SMT';
  if (tick2Active) {
     if (isAlignedBullish) {
        tick3Active = signalData?.bullishSMT;
        tick3Text = tick3Active ? 'Bullish SMT Divergence Confirmed' : 'No Bullish SMT Divergence';
     } else {
        tick3Active = signalData?.bearishSMT;
        tick3Text = tick3Active ? 'Bearish SMT Divergence Confirmed' : 'No Bearish SMT Divergence';
     }
  }

  let tick4Active = false;
  let tick4Text = 'Waiting for CISD';
  if (tick2Active) {
     if (isAlignedBullish) {
        tick4Active = signalData?.bullishCISD;
        tick4Text = tick4Active ? 'Bullish CISD (Displacement) Confirmed' : 'Waiting for Bullish CISD';
     } else {
        tick4Active = signalData?.bearishCISD;
        tick4Text = tick4Active ? 'Bearish CISD (Displacement) Confirmed' : 'Waiting for Bearish CISD';
     }
  }

  let finalSignal = 'NEUTRAL';
  let entry, sl, tp;
  if (isAlignedBullish && tick2Active && tick4Active) {
     finalSignal = 'BUY';
     entry = signalData?.cisdBullFVG ? signalData.cisdBullFVG.low : cp;
     sl = signalData?.sweep.sweepLow - signalData?.atr * 0.1;
     tp = entry + (entry - sl) * 2.5;
  } else if (isAlignedBearish && tick2Active && tick4Active) {
     finalSignal = 'SELL';
     entry = signalData?.cisdBearFVG ? signalData.cisdBearFVG.high : cp;
     sl = signalData?.sweep.sweepHigh + signalData?.atr * 0.1;
     tp = entry - (sl - entry) * 2.5;
  }

  const activeLoggedTrade = logs?.find(l => 
    l.status === 'ACTIVE' && 
    l.symbol === symbol && 
    l.timeframe === interval && 
    l.strategy === 'Justin Setup'
  );

  if (activeLoggedTrade) {
    finalSignal = activeLoggedTrade.signal;
    entry = activeLoggedTrade.entry;
    sl = activeLoggedTrade.sl;
    tp = activeLoggedTrade.tp;
    const loggedReasoning = activeLoggedTrade.reasoning || [];
    tick1Active = true; tick1Text = loggedReasoning[0] || 'Price entered HTF FVG (Active Trade)';
    tick2Active = true; tick2Text = loggedReasoning[1] || 'Internal Sweep Confirmed (Active Trade)';
    tick3Active = true; tick3Text = loggedReasoning[2] || 'SMT Divergence Confirmed (Active Trade)';
    tick4Active = true; tick4Text = loggedReasoning[3] || 'CISD Displacement Confirmed (Active Trade)';
  }

  // Hook 4: Dependent on calculations
  useEffect(() => {
    if (signalData && finalSignal !== 'NEUTRAL' && !activeLoggedTrade) {
      addSignal({
        symbol, timeframe: interval, strategy: 'Justin Setup',
        signal: finalSignal, entry, sl, tp,
        setupTime: signalData.setupTime,
        currentPrice: cp,
        reason: `${finalSignal} Signal Identified`,
        reasoning: [tick1Text, tick2Text, tick3Text, tick4Text]
      });
    }
  }, [finalSignal, activeLoggedTrade, symbol, interval, addSignal, entry, sl, tp, signalData?.setupTime, cp, tick1Text, tick2Text, tick3Text, tick4Text]);

  // --- Step 3: Early returns (ALWAYS AFTER HOOKS) ---
  if (loading && !signalData) {
    return (
      <div className="chart-signal loading">
        <RefreshCw className="spin-icon" size={14} />
        <span>Scanning FVG + SMT...</span>
      </div>
    );
  }

  if (error) return <div className="chart-signal error"><span>{error}</span></div>;
  if (!signalData) return null;

  if (interval !== '5') {
    const bullFVG = signalData.nearestBullFVG;
    const bearFVG = signalData.nearestBearFVG;
    const recentMitBull = signalData.recentMitigatedBull || [];
    const recentMitBear = signalData.recentMitigatedBear || [];
    
    const isForex = !['GOLD', 'XAUUSD', 'S&P500', 'NASDAQ', 'SPX', 'NDX', 'BTCUSD', 'BTC'].includes(symbol);
    const prec = isForex ? 5 : 2;

    return (
      <div className="chart-signal compact neutral" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
        {/* Unmitigated Section */}
        <div style={{ width: '100%' }}>
          <div className="signal-reason-small" style={{ color: 'var(--text-primary)', marginBottom: '4px' }}>Unmitigated FVGs</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem', width: '100%' }}>
            {bullFVG ? (
               <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                 <span style={{ color: 'var(--buy-green)' }}>▲ Bullish</span>
                 <span style={{ fontFamily: 'var(--font-mono)' }}>{bullFVG.low.toFixed(prec)} - {bullFVG.high.toFixed(prec)}</span>
               </div>
            ) : <div style={{ color: 'var(--text-secondary)' }}>No Bullish FVG</div>}
            {bearFVG ? (
               <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                 <span style={{ color: 'var(--sell-red)' }}>▼ Bearish</span>
                 <span style={{ fontFamily: 'var(--font-mono)' }}>{bearFVG.low.toFixed(prec)} - {bearFVG.high.toFixed(prec)}</span>
               </div>
            ) : <div style={{ color: 'var(--text-secondary)' }}>No Bearish FVG</div>}
          </div>
        </div>

        {/* Recently Mitigated Section */}
        {(recentMitBull.length > 0 || recentMitBear.length > 0) && (
          <div style={{ width: '100%', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
            <div className="signal-reason-small" style={{ color: 'var(--text-secondary)', marginBottom: '4px', fontSize: '0.65rem' }}>Recently Mitigated</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.7rem', width: '100%' }}>
              {recentMitBull.slice(0, 3).map((f, i) => (
                <div key={`rmb-${i}`} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--buy-green)' }}>△ Bullish</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{f.low.toFixed(prec)}-{f.high.toFixed(prec)}</span>
                </div>
              ))}
              {recentMitBear.slice(0, 3).map((f, i) => (
                <div key={`rmr-${i}`} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--sell-red)' }}>▽ Bearish</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{f.low.toFixed(prec)}-{f.high.toFixed(prec)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const tickStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem',
    opacity: active ? 1 : 0.6
  });

  return (
    <div className={`chart-signal compact ${finalSignal.toLowerCase()}`}>
      <div className="signal-left" style={{ width: '100%' }}>
        <div className={`signal-badge-small ${finalSignal.toLowerCase()}`}>
          {finalSignal === 'BUY' ? <TrendingUp size={10}/> : finalSignal === 'SELL' ? <TrendingDown size={10}/> : null}
          {' '}Justin {finalSignal}
        </div>
        <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
          {[tick1Text, tick2Text, tick3Text, tick4Text].map((text, i) => {
            const active = [tick1Active, tick2Active, tick3Active, tick4Active][i];
            return (
              <div key={i} style={tickStyle(active)}>
                {active ? <span style={{ color: 'var(--buy-green)' }}>✅</span> : <span>⭕</span>}
                <span>0{i+1}. {text}</span>
              </div>
            );
          })}
        </div>
        {finalSignal !== 'NEUTRAL' && (
          <div className="signal-prices" style={{ marginTop: '8px' }}>
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
        )}
      </div>
    </div>
  );
};

export default JustinSignal;

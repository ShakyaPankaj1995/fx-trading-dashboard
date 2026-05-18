import { useState, useEffect, useCallback, useRef } from 'react';

const STORAGE_KEY = 'fx_signal_log_v3';

export function useSignalLog() {
  const [logs, setLogs] = useState(() => {
    try {
      const local = localStorage.getItem(STORAGE_KEY);
      return local ? JSON.parse(local) : [];
    } catch (e) { return []; }
  });
  const outcomeTimerRef = useRef(null);
  const logsRef = useRef(logs);

  useEffect(() => {
    logsRef.current = logs;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  }, [logs]);

  // --- Fetch from server and merge ---
  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/log');
      if (res.ok) {
        const serverData = await res.json();
        if (Array.isArray(serverData)) {
          setLogs(prev => {
            const localIds = new Set(prev.map(l => l.id));
            const newFromServer = serverData.filter(sl => !localIds.has(sl.id));
            if (newFromServer.length === 0) {
              let changed = false;
              const merged = prev.map(pl => {
                const updated = serverData.find(sl => sl.id === pl.id);
                if (updated && updated.status !== pl.status) {
                  changed = true;
                  return updated;
                }
                return pl;
              });
              return changed ? merged : prev;
            }
            return [...newFromServer, ...prev].slice(0, 500);
          });
        }
      }
    } catch (error) {
      console.error('Sync failed, using local data');
    }
  }, []);

  const syncToServer = useCallback(async (currentLogs) => {
    try {
      await fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: currentLogs })
      });
    } catch (e) { console.error('Cloud sync failed'); }
  }, []);

  // --- Add Signal with strong dedup ---
  const addSignal = useCallback(async (signal) => {
    // 1. News Event Restriction Check (Async, outside setLogs)
    try {
      const res = await fetch(`/api/events?symbol=${signal.symbol}`);
      if (res.ok) {
        const events = await res.json();
        const nowTime = Date.now();
        const buffer = 60 * 60 * 1000; // 1 Hour Buffer
        const hasNews = events.some(e => {
          const et = new Date(e.date).getTime();
          return nowTime >= (et - buffer) && nowTime <= (et + buffer);
        });
        if (hasNews) {
          console.warn(`[SignalLog] Blocked ${signal.symbol} signal due to high/medium impact news event.`);
          alert(`⚠️ News Warning: Signal for ${signal.symbol} blocked due to upcoming/recent High/Medium impact news (1-Hour Filter active).`);
          return;
        }
      }
    } catch (e) { /* fallback: proceed if news check fails */ }

    setLogs(prev => {
      // CHECK 2: Signal Conflict — block if opposing direction already active for this pair
      const hasConflict = prev.some(log =>
        log.symbol === signal.symbol &&
        log.status === 'ACTIVE' &&
        log.signal !== signal.signal
      );
      if (hasConflict) {
        alert(`⚠️ Signal Conflict: An opposing ${signal.signal === 'BUY' ? 'SELL' : 'BUY'} trade is already active for ${signal.symbol}. Cannot log conflicting signal.`);
        return prev;
      }

      // 1. Timeframe Slot Rule: Normally 1 trade per TF.
      // Exception: Can have 2 trades if they are from Trendline and CRT respectively.
      const activeSameTF = prev.filter(log =>
        log.symbol === signal.symbol &&
        log.status === 'ACTIVE' &&
        log.timeframe === signal.timeframe
      );

      if (activeSameTF.length >= 2) return prev;

      if (activeSameTF.length === 1) {
        const existingStrat = activeSameTF[0].strategy;
        const isCRTorTrendline = (s) => s === 'CRT (AMD)' || s === 'Trendline';
        
        if (!(isCRTorTrendline(signal.strategy) && isCRTorTrendline(existingStrat) && signal.strategy !== existingStrat)) {
          return prev;
        }
      }

      // 2. Don't log if a trade with very similar entry existed recently (2 hours)
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const recentDuplicate = prev.some(log =>
        log.symbol === signal.symbol &&
        log.timeframe === signal.timeframe &&
        log.strategy === signal.strategy &&
        log.signal === signal.signal &&
        Math.abs(Number(log.entry) - Number(signal.entry)) < 0.001 &&
        new Date(log.timestamp).getTime() > twoHoursAgo
      );
      if (recentDuplicate) return prev;

      const isForex = !['GOLD', 'XAUUSD', 'S&P500', 'NASDAQ', 'SPX', 'NDX', 'BTCUSD', 'BTC'].includes(signal.symbol);
      const entryVal = Number(signal.entry);
      const slVal = Number(signal.sl);
      const tpVal = Number(signal.tp);

      if (!entryVal || !slVal || !tpVal || isNaN(entryVal)) return prev;

      // Ensure the entry price is relatively close to the current live price
      if (signal.currentPrice) {
        const live = Number(signal.currentPrice);
        
        // 1. Reject if it has already hit TP or SL
        if (signal.signal === 'BUY' && (live >= tpVal || live <= slVal)) return prev;
        if (signal.signal === 'SELL' && (live <= tpVal || live >= slVal)) return prev;

        // 2. Reject if it is too far from entry (Max allowed deviation is 30% of the distance to TP)
        const tpDistance = Math.abs(tpVal - entryVal);
        const liveDistance = Math.abs(live - entryVal);
        if (liveDistance > tpDistance * 0.3) {
          console.log(`[SignalLog] Rejected stale signal: Entry ${entryVal}, but live price is ${live}`);
          return prev;
        }
      }

      // ── Block 4H trades ──
      if (signal.timeframe === '240') return prev;

      // ── R/R Filter: min 1:1.5, max 1:3 ──
      const risk = Math.abs(entryVal - slVal);
      if (risk <= 0) return prev;

      const maxTP = signal.signal === 'BUY' ? entryVal + risk * 3 : entryVal - risk * 3;
      const clampedTP = signal.signal === 'BUY' ? Math.min(tpVal, maxTP) : Math.max(tpVal, maxTP);
      const actualRR = Math.abs(clampedTP - entryVal) / risk;

      if (actualRR < 1.5) {
        console.log(`[SignalLog] Rejected low R/R: ${signal.symbol} R/R=${actualRR.toFixed(2)} (min 1.5)`);
        return prev;
      }

      const rr = actualRR.toFixed(2);

      // ALWAYS use current time as the log timestamp (not the candle timestamp)
      // The candle timestamp (setupTime) is stored separately for reference
      const newLog = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),  // When signal was DETECTED (always now)
        setupTime: signal.setupTime ? new Date(signal.setupTime * 1000).toISOString() : null,
        symbol: signal.symbol,
        timeframe: signal.timeframe,
        strategy: signal.strategy,
        signal: signal.signal,
        entry: entryVal,
        sl: slVal,
        tp: clampedTP,  // capped at max 3R
        rr,
        reason: signal.reason || null,
        reasoning: signal.reasoning || null,
        status: 'ACTIVE',
        closedAt: null,
        closePrice: null,
      };

      console.log('[SignalLog] New trade logged:', newLog.symbol, newLog.signal, newLog.entry, 'at', newLog.timestamp);
      const updated = [newLog, ...prev].slice(0, 500);
      syncToServer(updated);
      return updated;
    });
  }, [syncToServer]);

  // --- Automatic Trade Outcome Resolution ---
  // Walks through candles since trade creation to find which level (TP or SL) was hit FIRST
  const checkTradeOutcomes = useCallback(async () => {
    const currentLogs = logsRef.current;
    const activeTrades = currentLogs.filter(l => l.status === 'ACTIVE');
    if (activeTrades.length === 0) return;

    // Fetch candle history for all active symbols
    const symbols = [...new Set(activeTrades.map(l => l.symbol))];
    const candleData = {};

    for (const sym of symbols) {
      try {
        let ticker = {
          'EURUSD': 'EURUSD=X', 'GBPUSD': 'GBPUSD=X', 'USDJPY': 'USDJPY=X',
          'XAUUSD': 'GC=F', 'S&P500': 'ES=F', 'NASDAQ': 'NQ=F'
        }[sym] || `${sym}=X`;

        // Fetch 5m candles for 5 days — covers weekends and long absences
        const res = await fetch(`/api/finance/v8/finance/chart/${ticker}?interval=5m&range=5d`);
        if (!res.ok) continue;
        const data = await res.json();
        const result = data.chart.result[0];
        candleData[sym] = {
          timestamps: result.timestamp || [],
          highs: result.indicators.quote[0].high,
          lows: result.indicators.quote[0].low,
          current: result.meta.regularMarketPrice
        };
      } catch (_) {}
    }

    if (Object.keys(candleData).length === 0) return;

    setLogs(prev => {
      let changed = false;
      const updated = prev.map(log => {
        if (log.status !== 'ACTIVE') return log;

        const data = candleData[log.symbol];
        if (!data) return log;

        const tradeCreatedSec = Math.floor(new Date(log.timestamp).getTime() / 1000);

        // Walk through candles AFTER the trade was created, in chronological order
        // Find which level was hit FIRST
        for (let i = 0; i < data.timestamps.length; i++) {
          if (data.timestamps[i] < tradeCreatedSec) continue; // Skip candles before trade
          const high = data.highs[i];
          const low = data.lows[i];
          if (high == null || low == null) continue;

          if (log.signal === 'BUY') {
            const tpHit = high >= log.tp;
            const slHit = low <= log.sl;

            if (tpHit && slHit) {
              // Both hit in same candle — check which is closer to open (conservative: SL wins)
              changed = true;
              console.log('[SignalLog] ⚠️ BUY both hit same candle:', log.symbol, 'SL wins (conservative)');
              return { ...log, status: 'FAILED', closedAt: new Date(data.timestamps[i] * 1000).toISOString(), closePrice: log.sl };
            }
            if (tpHit) {
              changed = true;
              console.log('[SignalLog] ✅ BUY TP HIT FIRST:', log.symbol, log.entry, '→', log.tp, 'at candle', i);
              return { ...log, status: 'SUCCESS', closedAt: new Date(data.timestamps[i] * 1000).toISOString(), closePrice: log.tp };
            }
            if (slHit) {
              changed = true;
              console.log('[SignalLog] ❌ BUY SL HIT FIRST:', log.symbol, log.entry, '→', log.sl, 'at candle', i);
              return { ...log, status: 'FAILED', closedAt: new Date(data.timestamps[i] * 1000).toISOString(), closePrice: log.sl };
            }
          } else if (log.signal === 'SELL') {
            const tpHit = low <= log.tp;
            const slHit = high >= log.sl;

            if (tpHit && slHit) {
              changed = true;
              console.log('[SignalLog] ⚠️ SELL both hit same candle:', log.symbol, 'SL wins (conservative)');
              return { ...log, status: 'FAILED', closedAt: new Date(data.timestamps[i] * 1000).toISOString(), closePrice: log.sl };
            }
            if (tpHit) {
              changed = true;
              console.log('[SignalLog] ✅ SELL TP HIT FIRST:', log.symbol, log.entry, '→', log.tp, 'at candle', i);
              return { ...log, status: 'SUCCESS', closedAt: new Date(data.timestamps[i] * 1000).toISOString(), closePrice: log.tp };
            }
            if (slHit) {
              changed = true;
              console.log('[SignalLog] ❌ SELL SL HIT FIRST:', log.symbol, log.entry, '→', log.sl, 'at candle', i);
              return { ...log, status: 'FAILED', closedAt: new Date(data.timestamps[i] * 1000).toISOString(), closePrice: log.sl };
            }
          }
        }

        // No candle hit either level yet — trade stays ACTIVE
        return log;
      });
      if (changed) {
        syncToServer(updated);
        return updated;
      }
      return prev;
    });
  }, [syncToServer]);

  const removeSignal = useCallback((id) => {
    setLogs(prev => {
      const updated = prev.filter(l => l.id !== id);
      syncToServer(updated);
      return updated;
    });
  }, [syncToServer]);

  const clearLogs = useCallback(async () => {
    if (!window.confirm('Are you sure you want to clear all logs? This cannot be undone.')) return;
    try {
      await fetch('/api/log', { method: 'DELETE' });
      setLogs([]);
    } catch (error) {
      console.error('Failed to clear logs on server');
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  useEffect(() => {
    const initTimer = setTimeout(checkTradeOutcomes, 10000);
    outcomeTimerRef.current = setInterval(checkTradeOutcomes, 45000);
    return () => {
      clearTimeout(initTimer);
      clearInterval(outcomeTimerRef.current);
    };
  }, [checkTradeOutcomes]);

  return { logs, addSignal, removeSignal, clearLogs };
}

import { useState, useEffect, useCallback, useRef } from 'react';

const STORAGE_KEY = 'fx_signal_log_v3';

export function useSignalLog() {
  // 1. Initialize from LocalStorage immediately
  const [logs, setLogs] = useState(() => {
    try {
      const local = localStorage.getItem(STORAGE_KEY);
      return local ? JSON.parse(local) : [];
    } catch (e) { return []; }
  });
  const outcomeTimerRef = useRef(null);
  const logsRef = useRef(logs); // Stable ref to avoid stale closures

  // Keep logsRef in sync without causing re-renders
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
              // Update status if server has newer info
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
  const addSignal = useCallback((signal) => {
    setLogs(prev => {
      // 1. Don't log if an ACTIVE trade exists for the same symbol+timeframe+strategy+direction
      const hasActiveMatch = prev.some(log =>
        log.symbol === signal.symbol &&
        log.timeframe === signal.timeframe &&
        log.strategy === signal.strategy &&
        log.signal === signal.signal &&
        log.status === 'ACTIVE'
      );
      if (hasActiveMatch) return prev;

      // 2. Don't log if a trade with very similar entry price existed recently (2 hours)
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

      const isForex = !['GOLD', 'XAUUSD', 'S&P500', 'NASDAQ', 'SPX', 'NDX'].includes(signal.symbol);
      const entryVal = Number(signal.entry);
      const slVal = Number(signal.sl);
      const tpVal = Number(signal.tp);

      // Safety: skip invalid signals
      if (!entryVal || !slVal || !tpVal || isNaN(entryVal)) return prev;

      const rr = signal.signal === 'BUY'
        ? ((tpVal - entryVal) / Math.abs(entryVal - slVal)).toFixed(2)
        : ((entryVal - tpVal) / Math.abs(slVal - entryVal)).toFixed(2);

      const newLog = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: signal.setupTime ? new Date(signal.setupTime * 1000).toISOString() : new Date().toISOString(),
        symbol: signal.symbol,
        timeframe: signal.timeframe,
        strategy: signal.strategy,
        signal: signal.signal,
        entry: entryVal,
        sl: slVal,
        tp: tpVal,
        rr,
        status: 'ACTIVE',
        closedAt: null,
        closePrice: null,
      };

      console.log('[SignalLog] New trade logged:', newLog.symbol, newLog.signal, newLog.entry);
      const updated = [newLog, ...prev].slice(0, 500);
      syncToServer(updated);
      return updated;
    });
  }, [syncToServer]);

  // --- Automatic Trade Outcome Resolution ---
  // Uses logsRef instead of logs dependency to avoid infinite loops
  const checkTradeOutcomes = useCallback(async () => {
    const currentLogs = logsRef.current;
    const activeTrades = currentLogs.filter(l => l.status === 'ACTIVE');
    if (activeTrades.length === 0) return;

    const symbols = [...new Set(activeTrades.map(l => l.symbol))];
    const priceMap = {};

    for (const sym of symbols) {
      try {
        let ticker = {
          'EURUSD': 'EURUSD=X', 'GBPUSD': 'GBPUSD=X', 'USDJPY': 'USDJPY=X',
          'XAUUSD': 'GC=F', 'S&P500': 'ES=F', 'NASDAQ': 'NQ=F'
        }[sym] || `${sym}=X`;

        const res = await fetch(`/api/finance/v8/finance/chart/${ticker}?interval=5m&range=1d`);
        if (!res.ok) continue;
        const data = await res.json();
        const result = data.chart.result[0];
        const highs = result.indicators.quote[0].high.filter(h => h != null);
        const lows = result.indicators.quote[0].low.filter(l => l != null);

        priceMap[sym] = {
          current: result.meta.regularMarketPrice,
          dayHigh: Math.max(...highs),
          dayLow: Math.min(...lows)
        };
      } catch (_) {}
    }

    if (Object.keys(priceMap).length === 0) return;

    setLogs(prev => {
      let changed = false;
      const updated = prev.map(log => {
        if (log.status !== 'ACTIVE') return log;
        const priceInfo = priceMap[log.symbol];
        if (!priceInfo) return log;

        const { dayHigh, dayLow } = priceInfo;

        if (log.signal === 'BUY') {
          if (dayHigh >= log.tp) {
            changed = true;
            console.log('[SignalLog] ✅ Trade HIT TP:', log.symbol, log.signal, log.entry, '→', log.tp);
            return { ...log, status: 'SUCCESS', closedAt: new Date().toISOString(), closePrice: log.tp };
          }
          if (dayLow <= log.sl) {
            changed = true;
            console.log('[SignalLog] ❌ Trade HIT SL:', log.symbol, log.signal, log.entry, '→', log.sl);
            return { ...log, status: 'FAILED', closedAt: new Date().toISOString(), closePrice: log.sl };
          }
        } else if (log.signal === 'SELL') {
          if (dayLow <= log.tp) {
            changed = true;
            console.log('[SignalLog] ✅ Trade HIT TP:', log.symbol, log.signal, log.entry, '→', log.tp);
            return { ...log, status: 'SUCCESS', closedAt: new Date().toISOString(), closePrice: log.tp };
          }
          if (dayHigh >= log.sl) {
            changed = true;
            console.log('[SignalLog] ❌ Trade HIT SL:', log.symbol, log.signal, log.entry, '→', log.sl);
            return { ...log, status: 'FAILED', closedAt: new Date().toISOString(), closePrice: log.sl };
          }
        }
        return log;
      });
      if (changed) {
        syncToServer(updated);
        return updated;
      }
      return prev; // No change, don't trigger re-render
    });
  }, [syncToServer]); // Only depends on syncToServer (stable), NOT on logs

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

  // Server sync on mount + interval
  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Outcome check on mount + interval (no dependency on logs → no infinite loop)
  useEffect(() => {
    // Delay first check to let app stabilize
    const initTimer = setTimeout(checkTradeOutcomes, 5000);
    outcomeTimerRef.current = setInterval(checkTradeOutcomes, 45000);
    return () => {
      clearTimeout(initTimer);
      clearInterval(outcomeTimerRef.current);
    };
  }, [checkTradeOutcomes]);

  return { logs, addSignal, removeSignal, clearLogs };
}

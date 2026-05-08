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
  const addSignal = useCallback((signal) => {
    setLogs(prev => {
      // 1. Don't log if an ACTIVE trade exists for same symbol+timeframe+strategy+direction
      const hasActiveMatch = prev.some(log =>
        log.symbol === signal.symbol &&
        log.timeframe === signal.timeframe &&
        log.strategy === signal.strategy &&
        log.signal === signal.signal &&
        log.status === 'ACTIVE'
      );
      if (hasActiveMatch) return prev;

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

      const isForex = !['GOLD', 'XAUUSD', 'S&P500', 'NASDAQ', 'SPX', 'NDX'].includes(signal.symbol);
      const entryVal = Number(signal.entry);
      const slVal = Number(signal.sl);
      const tpVal = Number(signal.tp);

      if (!entryVal || !slVal || !tpVal || isNaN(entryVal)) return prev;

      const rr = signal.signal === 'BUY'
        ? ((tpVal - entryVal) / Math.abs(entryVal - slVal)).toFixed(2)
        : ((entryVal - tpVal) / Math.abs(slVal - entryVal)).toFixed(2);

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
        tp: tpVal,
        rr,
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
  const checkTradeOutcomes = useCallback(async () => {
    const currentLogs = logsRef.current;
    const activeTrades = currentLogs.filter(l => l.status === 'ACTIVE');
    if (activeTrades.length === 0) return;

    // Don't check trades that are less than 5 minutes old (let them breathe)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const matureTrades = activeTrades.filter(l => new Date(l.timestamp).getTime() < fiveMinutesAgo);
    if (matureTrades.length === 0) return;

    const symbols = [...new Set(matureTrades.map(l => l.symbol))];
    const priceMap = {};

    for (const sym of symbols) {
      try {
        let ticker = {
          'EURUSD': 'EURUSD=X', 'GBPUSD': 'GBPUSD=X', 'USDJPY': 'USDJPY=X',
          'XAUUSD': 'GC=F', 'S&P500': 'ES=F', 'NASDAQ': 'NQ=F'
        }[sym] || `${sym}=X`;

        // Fetch 5m candles for the day so we can check timestamps
        const res = await fetch(`/api/finance/v8/finance/chart/${ticker}?interval=5m&range=1d`);
        if (!res.ok) continue;
        const data = await res.json();
        const result = data.chart.result[0];
        const timestamps = result.timestamp || [];
        const highs = result.indicators.quote[0].high;
        const lows = result.indicators.quote[0].low;

        priceMap[sym] = { timestamps, highs, lows, current: result.meta.regularMarketPrice };
      } catch (_) {}
    }

    if (Object.keys(priceMap).length === 0) return;

    setLogs(prev => {
      let changed = false;
      const updated = prev.map(log => {
        if (log.status !== 'ACTIVE') return log;
        
        // Skip trades less than 5 minutes old
        const logCreatedAt = new Date(log.timestamp).getTime();
        if (logCreatedAt > fiveMinutesAgo) return log;

        const priceInfo = priceMap[log.symbol];
        if (!priceInfo) return log;

        // Only check candles AFTER the trade was created
        const logCreatedSec = Math.floor(logCreatedAt / 1000);
        let highAfterEntry = -Infinity;
        let lowAfterEntry = Infinity;

        for (let i = 0; i < priceInfo.timestamps.length; i++) {
          if (priceInfo.timestamps[i] >= logCreatedSec && priceInfo.highs[i] != null && priceInfo.lows[i] != null) {
            highAfterEntry = Math.max(highAfterEntry, priceInfo.highs[i]);
            lowAfterEntry = Math.min(lowAfterEntry, priceInfo.lows[i]);
          }
        }

        // If no candles found after entry, use current price as a simple check
        if (highAfterEntry === -Infinity) {
          highAfterEntry = priceInfo.current;
          lowAfterEntry = priceInfo.current;
        }

        if (log.signal === 'BUY') {
          if (highAfterEntry >= log.tp) {
            changed = true;
            console.log('[SignalLog] ✅ BUY HIT TP:', log.symbol, log.entry, '→', log.tp);
            return { ...log, status: 'SUCCESS', closedAt: new Date().toISOString(), closePrice: log.tp };
          }
          if (lowAfterEntry <= log.sl) {
            changed = true;
            console.log('[SignalLog] ❌ BUY HIT SL:', log.symbol, log.entry, '→', log.sl);
            return { ...log, status: 'FAILED', closedAt: new Date().toISOString(), closePrice: log.sl };
          }
        } else if (log.signal === 'SELL') {
          if (lowAfterEntry <= log.tp) {
            changed = true;
            console.log('[SignalLog] ✅ SELL HIT TP:', log.symbol, log.entry, '→', log.tp);
            return { ...log, status: 'SUCCESS', closedAt: new Date().toISOString(), closePrice: log.tp };
          }
          if (highAfterEntry >= log.sl) {
            changed = true;
            console.log('[SignalLog] ❌ SELL HIT SL:', log.symbol, log.entry, '→', log.sl);
            return { ...log, status: 'FAILED', closedAt: new Date().toISOString(), closePrice: log.sl };
          }
        }
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

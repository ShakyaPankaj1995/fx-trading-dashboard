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
  const outcomeCheckRef = useRef(null);

  // Sync state to LocalStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  }, [logs]);

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
              return prev.map(pl => {
                const updated = serverData.find(sl => sl.id === pl.id);
                return (updated && updated.status !== pl.status) ? updated : pl;
              });
            }
            return [...newFromServer, ...prev].slice(0, 500);
          });
        }
      }
    } catch (error) {
      console.error('Sync failed, using local data');
    }
  }, []);

  const syncToServer = async (currentLogs) => {
    try {
      await fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: currentLogs })
      });
    } catch (e) { console.error('Cloud sync failed'); }
  };

  const addSignal = useCallback(async (signal) => {
    setLogs(prev => {
      // --- Stronger Dedup ---
      // 1. Don't log if an ACTIVE trade exists for the same symbol+timeframe+strategy+direction
      const hasActiveMatch = prev.some(log =>
        log.symbol === signal.symbol &&
        log.timeframe === signal.timeframe &&
        log.strategy === signal.strategy &&
        log.signal === signal.signal &&
        log.status === 'ACTIVE'
      );
      if (hasActiveMatch) return prev;

      // 2. Don't log if a trade with same entry price existed in the last 2 hours
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const recentDuplicate = prev.some(log =>
        log.symbol === signal.symbol &&
        log.timeframe === signal.timeframe &&
        log.strategy === signal.strategy &&
        log.signal === signal.signal &&
        Math.abs(Number(log.entry) - Number(signal.entry)) < 0.0001 &&
        new Date(log.timestamp).getTime() > twoHoursAgo
      );
      if (recentDuplicate) return prev;

      const isForex = !['GOLD', 'XAUUSD', 'S&P500', 'NASDAQ', 'SPX', 'NDX'].includes(signal.symbol);
      const rr = signal.signal === 'BUY'
        ? ((signal.tp - signal.entry) / (signal.entry - signal.sl)).toFixed(2)
        : ((signal.entry - signal.tp) / (signal.sl - signal.entry)).toFixed(2);

      const newLog = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: signal.setupTime ? new Date(signal.setupTime * 1000).toISOString() : new Date().toISOString(),
        symbol: signal.symbol,
        timeframe: signal.timeframe,
        strategy: signal.strategy,
        signal: signal.signal,
        entry: signal.entry,
        sl: signal.sl,
        tp: signal.tp,
        rr,
        status: 'ACTIVE',
        closedAt: null,
        closePrice: null,
      };

      const updated = [newLog, ...prev].slice(0, 500);
      syncToServer(updated);
      return updated;
    });
  }, []);

  // --- Automatic Trade Outcome Resolution ---
  const checkTradeOutcomes = useCallback(async () => {
    const activeTrades = logs.filter(l => l.status === 'ACTIVE');
    if (activeTrades.length === 0) return;

    // Fetch current prices for all active symbols
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
        const currentPrice = result.meta.regularMarketPrice;

        priceMap[sym] = {
          current: currentPrice,
          dayHigh: Math.max(...highs),
          dayLow: Math.min(...lows)
        };
      } catch (_) {}
    }

    let changed = false;
    setLogs(prev => {
      const updated = prev.map(log => {
        if (log.status !== 'ACTIVE') return log;
        const priceInfo = priceMap[log.symbol];
        if (!priceInfo) return log;

        const { current, dayHigh, dayLow } = priceInfo;
        const logTime = new Date(log.timestamp).getTime();

        if (log.signal === 'BUY') {
          // TP hit: price went above TP
          if (dayHigh >= log.tp) {
            changed = true;
            return { ...log, status: 'SUCCESS', closedAt: new Date().toISOString(), closePrice: log.tp };
          }
          // SL hit: price went below SL
          if (dayLow <= log.sl) {
            changed = true;
            return { ...log, status: 'FAILED', closedAt: new Date().toISOString(), closePrice: log.sl };
          }
        } else if (log.signal === 'SELL') {
          // TP hit: price went below TP
          if (dayLow <= log.tp) {
            changed = true;
            return { ...log, status: 'SUCCESS', closedAt: new Date().toISOString(), closePrice: log.tp };
          }
          // SL hit: price went above SL
          if (dayHigh >= log.sl) {
            changed = true;
            return { ...log, status: 'FAILED', closedAt: new Date().toISOString(), closePrice: log.sl };
          }
        }
        return log;
      });
      if (changed) syncToServer(updated);
      return changed ? updated : prev;
    });
  }, [logs]);

  const removeSignal = useCallback(async (id) => {
    setLogs(prev => {
      const updated = prev.filter(l => l.id !== id);
      syncToServer(updated);
      return updated;
    });
  }, []);

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

  // Check trade outcomes every 30 seconds
  useEffect(() => {
    checkTradeOutcomes();
    outcomeCheckRef.current = setInterval(checkTradeOutcomes, 30000);
    return () => clearInterval(outcomeCheckRef.current);
  }, [checkTradeOutcomes]);

  return { logs, addSignal, removeSignal, clearLogs };
}

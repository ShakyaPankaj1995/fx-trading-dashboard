import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'fx_signal_log';

const getSymbolYfTicker = (symbol) => {
  if (symbol === 'SPX' || symbol === 'S&P500' || symbol === 'SP500') return 'ES=F';
  if (symbol === 'NDX' || symbol === 'NASDAQ') return 'NQ=F';
  if (symbol === 'XAUUSD' || symbol === 'GOLD') return 'GC=F';
  return `${symbol}=X`;
};

const fetchCurrentPrice = async (symbol) => {
  try {
    const yfSymbol = getSymbolYfTicker(symbol);
    const res = await fetch(`/api/finance/v8/finance/chart/${yfSymbol}?interval=1m&range=1d`);
    const json = await res.json();
    const closes = json.chart.result[0].indicators.quote[0].close.filter(x => x != null);
    return closes[closes.length - 1];
  } catch {
    return null;
  }
};

export function useSignalLog() {
  const [logs, setLogs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  });

  const saveLogs = useCallback((updated) => {
    setLogs(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  // Add or update a signal — deduplicates by symbol+timeframe+strategy+signal within a 10-minute window
  const addSignal = useCallback((signal) => {
    setLogs(prev => {
      const tenMinsAgo = Date.now() - 10 * 60 * 1000;
      const isDuplicate = prev.some(log =>
        log.symbol === signal.symbol &&
        log.timeframe === signal.timeframe &&
        log.strategy === signal.strategy &&
        log.signal === signal.signal &&
        log.status === 'ACTIVE' &&
        new Date(log.timestamp).getTime() > tenMinsAgo
      );
      if (isDuplicate) return prev;

      const rr = signal.signal === 'BUY'
        ? ((signal.tp - signal.entry) / (signal.entry - signal.sl)).toFixed(2)
        : ((signal.entry - signal.tp) / (signal.sl - signal.entry)).toFixed(2);

      const newLog = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
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
      };

      const updated = [newLog, ...prev].slice(0, 200); // keep last 200
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearLogs = useCallback(() => {
    saveLogs([]);
  }, [saveLogs]);

  // Periodically check ACTIVE signals for TP/SL hits
  useEffect(() => {
    const checkOutcomes = async () => {
      setLogs(prev => {
        const activeSignals = prev.filter(l => l.status === 'ACTIVE');
        if (activeSignals.length === 0) return prev;
        return prev; // return unchanged, async update happens below
      });

      const currentLogs = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
      const activeSignals = currentLogs.filter(l => l.status === 'ACTIVE');
      if (activeSignals.length === 0) return;

      // Group by symbol to minimize fetches
      const symbols = [...new Set(activeSignals.map(l => l.symbol))];
      const prices = {};
      await Promise.all(symbols.map(async sym => {
        prices[sym] = await fetchCurrentPrice(sym);
      }));

      let changed = false;
      const updated = currentLogs.map(log => {
        if (log.status !== 'ACTIVE') return log;
        const price = prices[log.symbol];
        if (price == null) return log;

        if (log.signal === 'BUY') {
          if (price >= log.tp) {
            changed = true;
            return { ...log, status: 'SUCCESS', closedAt: new Date().toISOString() };
          }
          if (price <= log.sl) {
            changed = true;
            return { ...log, status: 'FAILED', closedAt: new Date().toISOString() };
          }
        } else if (log.signal === 'SELL') {
          if (price <= log.tp) {
            changed = true;
            return { ...log, status: 'SUCCESS', closedAt: new Date().toISOString() };
          }
          if (price >= log.sl) {
            changed = true;
            return { ...log, status: 'FAILED', closedAt: new Date().toISOString() };
          }
        }
        return log;
      });

      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        setLogs(updated);
      }
    };

    checkOutcomes();
    const interval = setInterval(checkOutcomes, 60000); // check every minute
    return () => clearInterval(interval);
  }, []);

  return { logs, addSignal, clearLogs };
}

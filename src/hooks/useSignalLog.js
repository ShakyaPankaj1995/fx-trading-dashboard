import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'fx_signal_log_v3';

export function useSignalLog() {
  // 1. Initialize from LocalStorage immediately
  const [logs, setLogs] = useState(() => {
    try {
      const local = localStorage.getItem(STORAGE_KEY);
      return local ? JSON.parse(local) : [];
    } catch (e) { return []; }
  });

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
            // Merge: Keep local, add new from server if ID doesn't exist
            const localIds = new Set(prev.map(l => l.id));
            const newFromServer = serverData.filter(sl => !localIds.has(sl.id));
            if (newFromServer.length === 0) {
              // Also update status of existing logs if server has newer info
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
      };

      const updated = [newLog, ...prev].slice(0, 500);
      syncToServer(updated);
      return updated;
    });
  }, []);

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

  return { logs, addSignal, removeSignal, clearLogs };
}

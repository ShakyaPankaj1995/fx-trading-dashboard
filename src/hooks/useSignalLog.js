import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'fx_signal_log'; // Keep local storage as a fallback/cache

export function useSignalLog() {
  const [logs, setLogs] = useState([]);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/log');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } else {
        // Fallback to local storage if API fails
        const local = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
        setLogs(local);
      }
    } catch (error) {
      const local = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
      setLogs(local);
    }
  }, []);

  const addSignal = useCallback(async (signal) => {
    // Note: The backend Cron job will identify and save signals in the background.
    // This frontend addSignal is only for instant feedback if the user is browsing.
    // However, to keep things consistent, we should push it to the server if needed.
    // But since the Cron job runs every 5 mins, we can just let it handle it.
    // To ensure the user sees it immediately, we update local state.
    
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
      
      // Sync with server
      fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: updated })
      }).catch(console.error);

      return updated;
    });
  }, []);

  const clearLogs = useCallback(async () => {
    try {
      await fetch('/api/log', { method: 'DELETE' });
      setLogs([]);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    } catch (error) {
      console.error('Failed to clear logs on server');
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 30000); // Sync every 30 seconds
    return () => clearInterval(interval);
  }, [fetchLogs]);

  return { logs, addSignal, clearLogs };
}

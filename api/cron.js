import { Redis } from '@upstash/redis';
import { analyzeData, analyzeCRTData } from './lib/strategy.js';
import { analyzeJustinSetup } from './lib/justinStrategy.js';
import https from 'https';

const LOG_KEY = 'fx_signal_log_v2';

function getRedis() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const ASSETS = [
  { name: 'EURUSD', ticker: 'EURUSD=X' },
  { name: 'GBPUSD', ticker: 'GBPUSD=X' },
  { name: 'USDJPY', ticker: 'USDJPY=X' },
  { name: 'XAUUSD', ticker: 'GC=F' },
  { name: 'S&P500', ticker: 'ES=F' },
  { name: 'NASDAQ', ticker: 'NQ=F' }
];

const TIMEFRAMES = [
  { val: '240', yf: '60m', range: '1mo' },
  { val: '60',  yf: '60m', range: '1mo' },
  { val: '15',  yf: '15m', range: '5d'  },
  { val: '5',   yf: '5m',  range: '5d'  }
];

const LOG_KEY = 'fx_signal_log_v2';

async function fetchYF(ticker, interval, range) {
  return new Promise((resolve, reject) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`;
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.chart.result[0]);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

export default async function handler(req, res) {
  // Add simple auth to prevent manual triggering by others if needed
  // For Vercel Cron, you can check the CRON_SECRET header
  
  try {
    const redis = getRedis();
    let logs = (redis ? await redis.get(LOG_KEY) : null) || [];
    const now = new Date();
    const thirtyDaysAgo = now.getTime() - (30 * 24 * 60 * 60 * 1000);
    
    // 1. Cleanup old logs (older than 30 days)
    logs = logs.filter(log => new Date(log.timestamp).getTime() > thirtyDaysAgo);

    // 2. Identify new signals
    for (const asset of ASSETS) {
      for (const tf of TIMEFRAMES) {
        try {
          const chartData = await fetchYF(asset.ticker, tf.yf, tf.range);
          
          // Run Trendline Strategy
          const trendAnalysis = analyzeData(chartData, tf.val);
          if (trendAnalysis.signal === 'BUY' || trendAnalysis.signal === 'SELL') {
            logs = addLogIfNew(logs, asset.name, tf.val, 'Trendline', trendAnalysis);
          }

          // Run CRT Strategy
          const crtAnalysis = analyzeCRTData(chartData, tf.val);
          if (crtAnalysis.signal === 'BUY' || crtAnalysis.signal === 'SELL') {
            logs = addLogIfNew(logs, asset.name, tf.val, 'CRT (AMD)', crtAnalysis);
          }

          // Run Justin Setup (with SMT correlated asset)
          const smtPairs = {
            'NASDAQ': 'ES=F', 'S&P500': 'NQ=F',
            'EURUSD': 'GBPUSD=X', 'GBPUSD': 'EURUSD=X',
            'XAUUSD': 'SI=F',
          };
          let correlatedData = null;
          const correlatedTicker = smtPairs[asset.name];
          if (correlatedTicker) {
            try { correlatedData = await fetchYF(correlatedTicker, tf.yf, tf.range); } catch (_) {}
          }
          const justinAnalysis = analyzeJustinSetup(chartData, correlatedData, tf.val);
          if (justinAnalysis.signal === 'BUY' || justinAnalysis.signal === 'SELL') {
            logs = addLogIfNew(logs, asset.name, tf.val, 'Justin Setup', justinAnalysis);
          }
        } catch (e) {
          console.error(`Error processing ${asset.name} ${tf.val}:`, e.message);
        }
      }
    }

    // 3. Update outcomes for ACTIVE signals
    // Group active logs by symbol to minimize fetches
    const activeLogs = logs.filter(l => l.status === 'ACTIVE');
    if (activeLogs.length > 0) {
      const symbols = [...new Set(activeLogs.map(l => l.symbol))];
      const tickerMap = Object.fromEntries(ASSETS.map(a => [a.name, a.ticker]));
      
      for (const sym of symbols) {
        try {
          const currentData = await fetchYF(tickerMap[sym], '1m', '1d');
          const quotes = currentData.indicators.quote[0];
          const timestamps = currentData.timestamp;

          logs = logs.map(log => {
            if (log.symbol !== sym || log.status !== 'ACTIVE') return log;
            
            const logTime = new Date(log.timestamp).getTime() / 1000;
            
            // Find all candles after signal was logged
            for (let i = 0; i < timestamps.length; i++) {
              if (timestamps[i] < logTime) continue;
              
              const high = quotes.high[i];
              const low = quotes.low[i];
              if (high == null || low == null) continue;

              if (log.signal === 'BUY') {
                if (high >= log.tp) return { ...log, status: 'SUCCESS', closedAt: new Date(timestamps[i] * 1000).toISOString() };
                if (low <= log.sl) return { ...log, status: 'FAILED', closedAt: new Date(timestamps[i] * 1000).toISOString() };
              } else {
                if (low <= log.tp) return { ...log, status: 'SUCCESS', closedAt: new Date(timestamps[i] * 1000).toISOString() };
                if (high >= log.sl) return { ...log, status: 'FAILED', closedAt: new Date(timestamps[i] * 1000).toISOString() };
              }
            }
            return log;
          });
        } catch (e) {
          console.error(`Error updating outcome for ${sym}:`, e.message);
        }
      }
    }

    if (redis) await redis.set(LOG_KEY, logs.slice(0, 500));
    return res.status(200).json({ status: 'Scan complete', signalsFound: activeLogs.length });
  } catch (error) {
    console.error('Cron job error:', error);
    return res.status(500).json({ error: error.message });
  }
}

function addLogIfNew(logs, symbol, timeframe, strategy, analysis) {
  const tenMinsAgo = Date.now() - 10 * 60 * 1000;
  
  // Deduplicate: Don't add if the same signal exists for this asset/tf/strategy recently
  const isDuplicate = logs.some(log => 
    log.symbol === symbol &&
    log.timeframe === timeframe &&
    log.strategy === strategy &&
    log.signal === analysis.signal &&
    log.status === 'ACTIVE' &&
    new Date(log.timestamp).getTime() > tenMinsAgo
  );

  if (isDuplicate) return logs;

  const rr = analysis.signal === 'BUY'
    ? ((analysis.tp - analysis.entry) / (analysis.entry - analysis.sl)).toFixed(2)
    : ((analysis.entry - analysis.tp) / (analysis.sl - analysis.entry)).toFixed(2);

  const newLog = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    symbol,
    timeframe,
    strategy,
    signal: analysis.signal,
    entry: analysis.entry,
    sl: analysis.sl,
    tp: analysis.tp,
    rr,
    status: 'ACTIVE',
    closedAt: null,
  };

  return [newLog, ...logs];
}

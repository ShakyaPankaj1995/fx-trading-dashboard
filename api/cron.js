import { Redis } from '@upstash/redis';
import { analyzeData, analyzeCRTData } from './lib/strategy.js';
import { analyzeJustinSetup } from './lib/justinStrategy.js';
import https from 'https';


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
  { val: '60',  yf: '60m', range: '1mo' },
  { val: '15',  yf: '15m', range: '5d'  },
  { val: '5',   yf: '5m',  range: '5d'  }
];

const LOG_KEY = 'fx_signal_log_v3';

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

    // 1. Fetch News Events to apply filter
    let newsEvents = [];
    try {
      newsEvents = await new Promise((resolve, reject) => {
        https.get('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
          let d = '';
          response.on('data', chunk => d += chunk);
          response.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve([]); } });
        }).on('error', () => resolve([]));
      });
    } catch (e) {}

    const isNewsRestricted = (symbol, currentTime) => {
      const currencies = {
        'EURUSD': ['EUR', 'USD'], 'GBPUSD': ['GBP', 'USD'], 'USDJPY': ['USD', 'JPY'],
        'XAUUSD': ['USD'], 'S&P500': ['USD'], 'NASDAQ': ['USD']
      }[symbol] || [];
      
      return newsEvents.some(event => {
        if (!currencies.includes(event.country)) return false;
        if (event.impact !== 'High' && event.impact !== 'Medium') return false;
        
        const eventTime = new Date(event.date).getTime();
        const buffer = 60 * 60 * 1000; // 1 Hour Buffer
        return currentTime >= (eventTime - buffer) && currentTime <= (eventTime + buffer);
      });
    };

    // 2. Pre-fetch 4H, 1H, and 15M bias for all assets (HTF Alignment Check)
    const htfBias = {}; // { 'EURUSD': { h4: 'BUY'|'SELL'|null, h1: 'BUY'|'SELL'|null, m15: 'BUY'|'SELL'|null } }
    for (const asset of ASSETS) {
      try {
        const [data4h, data1h, data15m] = await Promise.all([
          fetchYF(asset.ticker, '60m', '1mo'),
          fetchYF(asset.ticker, '60m', '5d'),
          fetchYF(asset.ticker, '15m', '5d'),
        ]);
        // Aggregate to respective timeframes and get bias direction
        const justin4h = analyzeJustinSetup(data4h, null, '240');
        const justin1h = analyzeJustinSetup(data1h, null, '60');
        const justin15m = analyzeJustinSetup(data15m, null, '15');
        htfBias[asset.name] = {
          h4: justin4h.signal === 'BUY' || justin4h.signal === 'SELL' ? justin4h.signal : null,
          h1: justin1h.signal === 'BUY' || justin1h.signal === 'SELL' ? justin1h.signal : null,
          m15: justin15m.signal === 'BUY' || justin15m.signal === 'SELL' ? justin15m.signal : null,
        };
      } catch (e) {
        htfBias[asset.name] = { h4: null, h1: null, m15: null };
      }
    }

    // 3. Identify new signals
    for (const asset of ASSETS) {
      for (const tf of TIMEFRAMES) {
        try {
          const chartData = await fetchYF(asset.ticker, tf.yf, tf.range);
          const currentTime = Date.now();

          // NEWS FILTER: Skip if within 60 mins of high/medium impact news
          if (isNewsRestricted(asset.name, currentTime)) {
            console.log(`[Cron] Skipping ${asset.name} due to News Restriction`);
            continue;
          }

          // Run CRT Strategy
          const crtAnalysis = analyzeCRTData(chartData, tf.val);
          if (crtAnalysis.signal === 'BUY' || crtAnalysis.signal === 'SELL') {
            logs = addLogIfNew(logs, asset.name, tf.val, 'CRT (AMD)', crtAnalysis, htfBias[asset.name]);
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
            logs = addLogIfNew(logs, asset.name, tf.val, 'Justin Setup', justinAnalysis, htfBias[asset.name]);
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

function addLogIfNew(logs, symbol, timeframe, strategy, analysis, htfBias = {}) {
  const tenMinsAgo = Date.now() - 10 * 60 * 1000;
  const direction = analysis.signal; // 'BUY' or 'SELL'

  // ── CHECK 1: Cascading Timeframe Bias Alignment ──
  // The constraint: multi-TF setup is allowed ONLY when shorter-TF aligns with HTF bias
  // 5m aligns with 15m, 15m aligns with 1h, 1h aligns with 4h
  const { h4, h1, m15 } = htfBias;
  
  if (timeframe === '5' && m15 && m15 !== direction) {
    console.log(`[Cron] ❌ ALIGN BLOCK: ${symbol} 5M ${direction} rejected — 15M bias is ${m15}`);
    return logs;
  }
  if (timeframe === '15' && h1 && h1 !== direction) {
    console.log(`[Cron] ❌ ALIGN BLOCK: ${symbol} 15M ${direction} rejected — 1H bias is ${h1}`);
    return logs;
  }
  if (timeframe === '60' && h4 && h4 !== direction) {
    console.log(`[Cron] ❌ ALIGN BLOCK: ${symbol} 1H ${direction} rejected — 4H bias is ${h4}`);
    return logs;
  }

  // ── CHECK 2: Timeframe Slot Rule ──
  // Normally 1 trade per TF. Exception: Can have 2 trades if they are from Trendline and CRT respectively.
  const activeSameTF = logs.filter(log =>
    log.symbol === symbol &&
    log.status === 'ACTIVE' &&
    log.timeframe === timeframe
  );

  if (activeSameTF.length >= 2) {
    console.log(`[Cron] ⚠️ TF SLOT BLOCK: ${symbol} ${timeframe}M rejected — max 2 trades reached`);
    return logs; 
  }

  if (activeSameTF.length === 1) {
    const existingStrat = activeSameTF[0].strategy;
    const isCRTorTrendline = (s) => s === 'CRT (AMD)' || s === 'Trendline';
    
    // Only allow second trade if both are within {CRT, Trendline} and are different strategies
    if (isCRTorTrendline(strategy) && isCRTorTrendline(existingStrat) && strategy !== existingStrat) {
      // Allowed!
    } else {
      console.log(`[Cron] ⚠️ TF SLOT BLOCK: ${symbol} ${timeframe}M ${direction} rejected — slot full (requires Trendline + CRT combo for 2 trades)`);
      return logs;
    }
  }

  // ── DEDUP: Don't add if same signal already active recently ──
  const isDuplicate = logs.some(log =>
    log.symbol === symbol &&
    log.timeframe === timeframe &&
    log.strategy === strategy &&
    log.signal === direction &&
    log.status === 'ACTIVE' &&
    new Date(log.timestamp).getTime() > tenMinsAgo
  );
  if (isDuplicate) return logs;

  // ── CHECK 3: R/R Filter — min 1:1.5, max 1:3 ──
  const risk   = Math.abs(analysis.entry - analysis.sl);
  if (risk <= 0) return logs; // invalid SL

  // Cap TP at 3R if farther away
  const maxTP = direction === 'BUY'
    ? analysis.entry + risk * 3
    : analysis.entry - risk * 3;
  const clampedTP = direction === 'BUY'
    ? Math.min(analysis.tp, maxTP)
    : Math.max(analysis.tp, maxTP);

  // Check actual R/R after capping
  const actualRR = Math.abs(clampedTP - analysis.entry) / risk;
  if (actualRR < 1.5) {
    console.log(`[Cron] ❌ RR BLOCK: ${symbol} ${timeframe} ${direction} — R/R ${actualRR.toFixed(2)} below min 1.5`);
    return logs;
  }

  const rr = actualRR.toFixed(2);

  const newLog = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    symbol,
    timeframe,
    strategy,
    signal: direction,
    entry: analysis.entry,
    sl: analysis.sl,
    tp: clampedTP,   // capped at max 3R
    rr,
    status: 'ACTIVE',
    closedAt: null,
  };

  console.log(`[Cron] ✅ LOGGED: ${symbol} ${timeframe} ${direction} (${strategy}) Entry:${analysis.entry}`);
  return [newLog, ...logs];
}

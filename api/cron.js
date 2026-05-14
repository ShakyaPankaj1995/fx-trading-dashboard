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
          if (!json.chart?.result?.[0]) {
            return reject(new Error('No data in YF response'));
          }
          resolve(json.chart.result[0]);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Helper to aggregate 1h candles into 4h
function aggregateRawTo4H(data) {
  if (!data || !data.timestamp) return data;
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
    indicators: { quote: [{ open: sorted.map(c => c.open), high: sorted.map(c => c.high), low: sorted.map(c => c.low), close: sorted.map(c => c.close) }] },
    meta: data.meta
  };
}

export default async function handler(req, res) {
  try {
    const redis = getRedis();
    let logs = (redis ? await redis.get(LOG_KEY) : null) || [];
    const now = new Date();
    const thirtyDaysAgo = now.getTime() - (30 * 24 * 60 * 60 * 1000);
    
    // 1. Cleanup old logs (older than 30 days)
    logs = logs.filter(log => new Date(log.timestamp).getTime() > thirtyDaysAgo);

    // 2. Identify new signals
    for (const asset of ASSETS) {
      const htfResults = {};
      const tfDataMap = {};

      // First fetch all timeframes to check alignment
      for (const tf of TIMEFRAMES) {
        try {
          let chartData = await fetchYF(asset.ticker, tf.yf, tf.range);
          if (tf.val === '240') chartData = aggregateRawTo4H(chartData);
          tfDataMap[tf.val] = chartData;
          
          // For Justin HTF FVGs (4H, 1H, 15M)
          if (tf.val !== '5') {
            const analysis = analyzeJustinSetup(chartData, null, tf.val);
            htfResults[tf.val] = {
              bullish: analysis.nearestBullFVG,
              bearish: analysis.nearestBearFVG
            };
          }
        } catch (e) {
          console.error(`Error fetching ${asset.name} ${tf.val}:`, e.message);
        }
      }

      // Check for HTF Alignment (All 3 HTFs must have unmitigated FVG)
      const htfTFs = ['240', '60', '15'];
      const hasAllHTFFvgs = htfTFs.every(tf => htfResults[tf] && (htfResults[tf].bullish || htfResults[tf].bearish));
      
      // Determine direction alignment (All must be Bull or all must be Bear)
      const allBullish = htfTFs.every(tf => htfResults[tf]?.bullish);
      const allBearish = htfTFs.every(tf => htfResults[tf]?.bearish);
      const isAligned = hasAllHTFFvgs && (allBullish || allBearish);

      if (isAligned) {
        // Now run strategies for all timeframes
        for (const tfVal of Object.keys(tfDataMap)) {
          const chartData = tfDataMap[tfVal];
          
          // Trendline Strategy
          const trendAnalysis = analyzeData(chartData, tfVal);
          if (trendAnalysis.signal === 'BUY' || trendAnalysis.signal === 'SELL') {
            logs = addLogIfNew(logs, asset.name, tfVal, 'Trendline', trendAnalysis);
          }

          // CRT Strategy
          const crtAnalysis = analyzeCRTData(chartData, tfVal);
          if (crtAnalysis.signal === 'BUY' || crtAnalysis.signal === 'SELL') {
            logs = addLogIfNew(logs, asset.name, tfVal, 'CRT (AMD)', crtAnalysis);
          }

          // Justin 5M Signal
          if (tfVal === '5') {
            const smtPairs = {
              'NASDAQ': 'ES=F', 'S&P500': 'NQ=F',
              'EURUSD': 'GBPUSD=X', 'GBPUSD': 'EURUSD=X',
              'XAUUSD': 'SI=F',
            };
            let correlatedData = null;
            const correlatedTicker = smtPairs[asset.name];
            if (correlatedTicker) {
              try { 
                correlatedData = await fetchYF(correlatedTicker, '5m', '5d'); 
              } catch (_) {}
            }
            
            const justinAnalysis = analyzeJustinSetup(chartData, correlatedData, '5');
            const cp = justinAnalysis.currentPrice;
            
            // Re-verify the alignment with current price for the 5M signal specifically
            let inFVGsCount = 0;
            htfTFs.forEach(tf => {
              const fvgs = htfResults[tf];
              if (allBullish && fvgs.bullish && cp >= fvgs.bullish.low && cp <= fvgs.bullish.high) inFVGsCount++;
              if (allBearish && fvgs.bearish && cp >= fvgs.bearish.low && cp <= fvgs.bearish.high) inFVGsCount++;
            });

            let finalJustinSignal = 'NEUTRAL';
            let entry, sl, tp;

            if (allBullish && inFVGsCount > 0 && justinAnalysis.sweep?.type === 'BUY_SWEEP' && justinAnalysis.bullishCISD) {
              finalJustinSignal = 'BUY';
              entry = justinAnalysis.cisdBullFVG ? justinAnalysis.cisdBullFVG.low : cp;
              sl = justinAnalysis.sweep.sweepLow - justinAnalysis.atr * 0.1;
              tp = entry + (entry - sl) * 2.5;
            } else if (allBearish && inFVGsCount > 0 && justinAnalysis.sweep?.type === 'SELL_SWEEP' && justinAnalysis.bearishCISD) {
              finalJustinSignal = 'SELL';
              entry = justinAnalysis.cisdBearFVG ? justinAnalysis.cisdBearFVG.high : cp;
              sl = justinAnalysis.sweep.sweepHigh + justinAnalysis.atr * 0.1;
              tp = entry - (sl - entry) * 2.5;
            }

            if (finalJustinSignal !== 'NEUTRAL') {
              logs = addLogIfNew(logs, asset.name, '5', 'Justin Setup', {
                signal: finalJustinSignal, entry, sl, tp,
                reason: `${finalJustinSignal} Signal Identified (Aligned HTF)`,
                reasoning: [`HTF Alignment Confirmed`, `Internal Sweep Confirmed`, `CISD Confirmed`]
              });
            }
          }
        }
      }
    }

    // 3. Update outcomes for ACTIVE signals
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
            for (let i = 0; i < timestamps.length; i++) {
              if (timestamps[i] < logTime) continue;
              const high = quotes.high[i];
              const low = quotes.low[i];
              if (high == null || low == null) continue;

              if (log.signal === 'BUY') {
                if (high >= log.tp) return { ...log, status: 'SUCCESS', closedAt: new Date(timestamps[i] * 1000).toISOString(), closePrice: log.tp };
                if (low <= log.sl) return { ...log, status: 'FAILED', closedAt: new Date(timestamps[i] * 1000).toISOString(), closePrice: log.sl };
              } else {
                if (low <= log.tp) return { ...log, status: 'SUCCESS', closedAt: new Date(timestamps[i] * 1000).toISOString(), closePrice: log.tp };
                if (high >= log.sl) return { ...log, status: 'FAILED', closedAt: new Date(timestamps[i] * 1000).toISOString(), closePrice: log.sl };
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
    return res.status(200).json({ status: 'Scan complete', activeTrades: logs.filter(l => l.status === 'ACTIVE').length });
  } catch (error) {
    console.error('Cron job error:', error);
    return res.status(500).json({ error: error.message });
  }
}

function addLogIfNew(logs, symbol, timeframe, strategy, analysis) {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const isDuplicate = logs.some(log => 
    log.symbol === symbol &&
    log.timeframe === timeframe &&
    log.strategy === strategy &&
    log.signal === analysis.signal &&
    log.status === 'ACTIVE' &&
    new Date(log.timestamp).getTime() > oneHourAgo
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
    reason: analysis.reason || null,
    reasoning: analysis.reasoning || null,
    status: 'ACTIVE',
    closedAt: null,
  };

  return [newLog, ...logs];
}

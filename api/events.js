import https from 'https';

const ASSET_CURRENCY_MAP = {
  'EURUSD': ['EUR', 'USD'],
  'GBPUSD': ['GBP', 'USD'],
  'USDJPY': ['USD', 'JPY'],
  'XAUUSD': ['USD'], // Gold is primarily USD driven
  'S&P500': ['USD'],
  'NASDAQ': ['USD']
};

export default async function handler(req, res) {
  const { symbol } = req.query;
  const url = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

  https.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  }, (response) => {
    if (response.statusCode !== 200) {
      return res.status(200).json([]); // Fallback to empty instead of crashing
    }
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => {
      try {
        if (!data || !data.trim().startsWith('[')) {
          return res.status(200).json([]); 
        }
        const events = JSON.parse(data);
        const now = new Date();
        
        // 1. Filter: High & Medium Impact & Future/Recent
        const filtered = events.filter(e => {
          const eventDate = new Date(e.date);
          const impactMatch = e.impact === 'High' || e.impact === 'Medium';
          return impactMatch && eventDate > new Date(now.getTime() - 48 * 60 * 60 * 1000);
        });

        // 2. Add Prediction Logic for the specific symbol
        const relevantEvents = filtered.map(e => {
          const prediction = predictImpact(e, symbol);
          return { ...e, prediction };
        });

        res.status(200).json(relevantEvents);
      } catch (e) {
        console.error('Events parse error:', e);
        res.status(200).json([]); // Silent fallback
      }
    });
  }).on('error', (err) => {
    console.error('Events fetch error:', err);
    res.status(200).json([]); // Silent fallback
  });
}

function predictImpact(event, symbol) {
  const affectedCurrencies = ASSET_CURRENCY_MAP[symbol] || [];
  if (!affectedCurrencies.includes(event.country)) return null;

  const forecast = parseFloat(event.forecast);
  const previous = parseFloat(event.previous);

  if (isNaN(forecast) || isNaN(previous)) return { direction: 'NEUTRAL', bias: 'UNCERTAIN', value: 'N/A' };

  let currencyBias = 'NEUTRAL';
  // Common bullish indicators: Higher is better
  const bullishIndicators = ['NFP', 'Payroll', 'GDP', 'Retail Sales', 'CPI', 'PMI', 'Sentiment', 'Rate', 'Confidence'];
  const isPositiveMetric = bullishIndicators.some(ind => event.title.includes(ind));
  
  // Inverse indicators: Lower is better (Unemployment)
  const isInverseMetric = event.title.toLowerCase().includes('unemployment');

  if (isPositiveMetric) {
    if (forecast > previous) currencyBias = 'BULLISH';
    if (forecast < previous) currencyBias = 'BEARISH';
  } else if (isInverseMetric) {
    if (forecast < previous) currencyBias = 'BULLISH';
    if (forecast > previous) currencyBias = 'BEARISH';
  }

  if (currencyBias === 'NEUTRAL') return { direction: 'NEUTRAL', bias: 'UNCERTAIN', value: forecast };

  // Calculate direction for the pair
  // For EURUSD: EUR is Base, USD is Quote
  const parts = symbol.match(/.{3}/g) || [symbol];
  const base = parts[0];
  const quote = parts[1];

  let direction = 'NEUTRAL';
  if (event.country === base) {
    direction = currencyBias === 'BULLISH' ? 'UP' : 'DOWN';
  } else if (event.country === quote || (symbol.includes('500') || symbol.includes('NASDAQ') || symbol.includes('XAU')) && event.country === 'USD') {
    // If USD is strong, Gold/Indices/EURUSD go DOWN
    direction = currencyBias === 'BULLISH' ? 'DOWN' : 'UP';
  }

  return {
    direction,
    bias: currencyBias,
    value: forecast,
    reason: `${event.title} forecast is ${currencyBias.toLowerCase()} for ${event.country}`
  };
}

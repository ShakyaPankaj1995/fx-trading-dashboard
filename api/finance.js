import https from 'https';

export default function handler(req, res) {
  // Extract the path after /api/finance
  // e.g. /api/finance/v8/finance/chart/AAPL -> /v8/finance/chart/AAPL
  const path = req.url.replace('/api/finance', '');
  const url = `https://query1.finance.yahoo.com${path}`;

  https.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    }
  }, (response) => {
    let data = '';
    response.on('data', (chunk) => data += chunk);
    response.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.status(response.statusCode).send(data);
    });
  }).on('error', (err) => {
    res.status(500).json({ error: err.message });
  });
}

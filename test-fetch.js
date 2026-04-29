const https = require('https');

https.get('https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?interval=15m&range=5d', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log(data.substring(0, 200));
  });
}).on('error', (e) => {
  console.error(e);
});

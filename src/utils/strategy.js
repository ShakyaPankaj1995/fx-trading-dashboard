export function analyzeData(data, intervalStr) {
  if (!data || !data.timestamp || data.timestamp.length < 50) {
    return { signal: 'WAIT', reason: 'Gathering data...' };
  }

  let highsRaw = data.indicators.quote[0].high;
  let lowsRaw = data.indicators.quote[0].low;
  let closesRaw = data.indicators.quote[0].close;
  let opensRaw = data.indicators.quote[0].open;

  let timestamps = [];
  let pricesHigh = [], pricesLow = [], pricesClose = [], pricesOpen = [];
  for (let i = 0; i < closesRaw.length; i++) {
    if (highsRaw[i] != null && lowsRaw[i] != null && closesRaw[i] != null && opensRaw[i] != null) {
      pricesHigh.push(highsRaw[i]);
      pricesLow.push(lowsRaw[i]);
      pricesClose.push(closesRaw[i]);
      pricesOpen.push(opensRaw[i]);
      timestamps.push(data.timestamp[i]);
    }
  }

  // Aggregate 1h data into 4h data if needed (00:00, 04:00, 08:00, 12:00, 16:00, 20:00 boundaries)
  if (intervalStr === '240') {
    const aggHighs = [];
    const aggLows = [];
    const aggCloses = [];
    const aggOpens = [];
    
    let currentCandle = null;

    for (let i = 0; i < pricesClose.length; i++) {
      const date = new Date(timestamps[i] * 1000);
      const hour = date.getUTCHours();
      const candleStartHour = Math.floor(hour / 4) * 4;

      if (!currentCandle || currentCandle.startHour !== candleStartHour) {
        if (currentCandle) {
          aggOpens.push(currentCandle.open);
          aggHighs.push(currentCandle.high);
          aggLows.push(currentCandle.low);
          aggCloses.push(currentCandle.close);
        }
        currentCandle = {
          startHour: candleStartHour,
          open: pricesOpen[i],
          high: pricesHigh[i],
          low: pricesLow[i],
          close: pricesClose[i]
        };
      } else {
        currentCandle.high = Math.max(currentCandle.high, pricesHigh[i]);
        currentCandle.low = Math.min(currentCandle.low, pricesLow[i]);
        currentCandle.close = pricesClose[i];
      }
    }
    // Push the last one
    if (currentCandle) {
      aggOpens.push(currentCandle.open);
      aggHighs.push(currentCandle.high);
      aggLows.push(currentCandle.low);
      aggCloses.push(currentCandle.close);
    }

    pricesHigh = aggHighs;
    pricesLow = aggLows;
    pricesClose = aggCloses;
    pricesOpen = aggOpens;
  }

  if (pricesHigh.length < 20) {
     return { signal: 'WAIT', reason: 'Insufficient timeframe data' };
  }

  const pivotLength = 8;
  const ph = []; 
  const pl = []; 

  for (let i = pivotLength; i < pricesHigh.length - pivotLength; i++) {
    let isPh = true;
    let isPl = true;
    for (let j = 1; j <= pivotLength; j++) {
      if (pricesHigh[i] <= pricesHigh[i - j] || pricesHigh[i] <= pricesHigh[i + j]) isPh = false;
      if (pricesLow[i] >= pricesLow[i - j] || pricesLow[i] >= pricesLow[i + j]) isPl = false;
    }
    if (isPh && pricesHigh[i] != null) ph.push({ index: i, value: pricesHigh[i], time: timestamps[i] });
    if (isPl && pricesLow[i] != null) pl.push({ index: i, value: pricesLow[i], time: timestamps[i] });
  }

  if (ph.length < 2 || pl.length < 2) return { signal: 'NEUTRAL', reason: 'Building market structure...' };

  const lastPh = ph[ph.length - 1];
  const prevPh = ph[ph.length - 2];
  const lastPl = pl[pl.length - 1];
  const prevPl = pl[pl.length - 2];

  const uptrend = lastPh.value > prevPh.value && lastPl.value > prevPl.value;
  const downtrend = lastPh.value < prevPh.value && lastPl.value < prevPl.value;

  const currentClose = pricesClose[pricesClose.length - 1];
  const currentOpen = pricesOpen[pricesOpen.length - 1];
  const currentHigh = pricesHigh[pricesHigh.length - 1];
  const currentLow = pricesLow[pricesLow.length - 1];

  let trSum = 0;
  let count = 0;
  for (let i = pricesClose.length - 15; i < pricesClose.length - 1; i++) {
    if (pricesHigh[i] != null && pricesLow[i] != null && pricesClose[i-1] != null) {
      const hl = pricesHigh[i] - pricesLow[i];
      const hc = Math.abs(pricesHigh[i] - pricesClose[i - 1]);
      const lc = Math.abs(pricesLow[i] - pricesClose[i - 1]);
      trSum += Math.max(hl, hc, lc);
      count++;
    }
  }
  const atr = trSum / (count || 14);

  const atrMult = 1.5;
  const targetRatio = 2.0;

  const minRiskReward = 1.5;
  const maxRiskReward = 3.0;

  // Helper: cap TP so reward never exceeds maxRiskReward x risk
  const capBuyTp  = (entry, sl, tp) => Math.min(tp, entry + (entry - sl) * maxRiskReward);
  const capSellTp = (entry, sl, tp) => Math.max(tp, entry - (sl - entry) * maxRiskReward);

  // Specific Bounce Signal
  if (uptrend) {
    const isBullishCandle = currentClose > currentOpen;
    if (isBullishCandle && currentLow <= lastPl.value * 1.002) {
      const sl = lastPl.value - (atr * atrMult);
      const rawTp = Math.max(lastPh.value, prevPh?.value || 0);
      const tp = capBuyTp(currentClose, sl, rawTp);
      const risk = currentClose - sl;
      const reward = tp - currentClose;
      const rr = (reward / risk).toFixed(2);
      if (reward >= risk * minRiskReward && risk > 0) {
        return {
          signal: 'BUY', entry: currentClose, sl, tp,
          setupTime: lastPl.time,
          reason: 'Trendline Bounce',
          reasoning: [
            `Price bounced off uptrend support near swing low (${lastPl.value.toFixed(5)})`,
            `Bullish candle confirms buyer strength at this level`,
            `Higher Highs (${prevPh.value.toFixed(5)} → ${lastPh.value.toFixed(5)}) & Higher Lows confirm uptrend`,
            `Stop placed ${(atr * atrMult).toFixed(5)} below swing low (${atrMult}x ATR buffer)`,
            `Target capped at 3x risk: ${tp.toFixed(5)} — R:R ratio ${rr}x ✅`
          ]
        };
      } else {
        return { signal: 'WAIT', reason: 'Bounce forming (R:R < 1.5x)' };
      }
    }
  }

  if (downtrend) {
    const isBearishCandle = currentClose < currentOpen;
    if (isBearishCandle && currentHigh >= lastPh.value * 0.998) {
      const sl = lastPh.value + (atr * atrMult);
      const rawTp = Math.min(lastPl.value, prevPl?.value || Infinity);
      const tp = capSellTp(currentClose, sl, rawTp);
      const risk = sl - currentClose;
      const reward = currentClose - tp;
      const rr = (reward / risk).toFixed(2);
      if (reward >= risk * minRiskReward && risk > 0) {
        return {
          signal: 'SELL', entry: currentClose, sl, tp,
          setupTime: lastPh.time,
          reason: 'Trendline Bounce',
          reasoning: [
            `Price rejected downtrend resistance near swing high (${lastPh.value.toFixed(5)})`,
            `Bearish candle confirms seller pressure at this level`,
            `Lower Highs (${prevPh.value.toFixed(5)} → ${lastPh.value.toFixed(5)}) & Lower Lows confirm downtrend`,
            `Stop placed ${(atr * atrMult).toFixed(5)} above swing high (${atrMult}x ATR buffer)`,
            `Target capped at 3x risk: ${tp.toFixed(5)} — R:R ratio ${rr}x ✅`
          ]
        };
      } else {
        return { signal: 'WAIT', reason: 'Bounce forming (R:R < 1.5x)' };
      }
    }
  }

  // Active Trend Output
  if (uptrend) {
    const sl = lastPl.value - (atr * atrMult);
    const rawTp = Math.max(lastPh.value, prevPh?.value || 0);
    const tp = capBuyTp(currentClose, sl, rawTp);
    const risk = currentClose - sl;
    const reward = tp - currentClose;
    const rr = (reward / risk).toFixed(2);
    if (reward >= risk * minRiskReward && risk > 0) {
      return {
        signal: 'BUY', entry: currentClose, sl, tp,
        setupTime: lastPl.time,
        reason: 'Active Uptrend',
        reasoning: [
          `Sustained uptrend: HH at ${lastPh.value.toFixed(5)}, HL at ${lastPl.value.toFixed(5)}`,
          `Price trading above last confirmed pivot low — trend intact`,
          `No reversal signal yet; momentum favors continuation`,
          `Stop below last swing low with ${atrMult}x ATR buffer`,
          `Target capped at 3x risk: ${tp.toFixed(5)} — R:R ratio ${rr}x ✅`
        ]
      };
    }
  }

  if (downtrend) {
    const sl = lastPh.value + (atr * atrMult);
    const rawTp = Math.min(lastPl.value, prevPl?.value || Infinity);
    const tp = capSellTp(currentClose, sl, rawTp);
    const risk = sl - currentClose;
    const reward = currentClose - tp;
    const rr = (reward / risk).toFixed(2);
    if (reward >= risk * minRiskReward && risk > 0) {
      return {
        signal: 'SELL', entry: currentClose, sl, tp,
        setupTime: lastPh.time,
        reason: 'Active Downtrend',
        reasoning: [
          `Sustained downtrend: LH at ${lastPh.value.toFixed(5)}, LL at ${lastPl.value.toFixed(5)}`,
          `Price trading below last confirmed pivot high — trend intact`,
          `No reversal signal yet; momentum favors continuation to downside`,
          `Stop above last swing high with ${atrMult}x ATR buffer`,
          `Target capped at 3x risk: ${tp.toFixed(5)} — R:R ratio ${rr}x ✅`
        ]
      };
    }
  }

  return { signal: 'NEUTRAL', reason: 'Consolidating / Range Bound' };
}

export function analyzeCRTData(data, intervalStr) {
  if (!data || !data.timestamp || data.timestamp.length < 50) {
    return { signal: 'WAIT', reason: 'Gathering data...' };
  }

  let pricesHighRaw = data.indicators.quote[0].high;
  let pricesLowRaw = data.indicators.quote[0].low;
  let pricesCloseRaw = data.indicators.quote[0].close;
  let pricesOpenRaw = data.indicators.quote[0].open;

  let timestamps = [];
  let pricesHigh = [], pricesLow = [], pricesClose = [], pricesOpen = [];
  for (let i = 0; i < pricesCloseRaw.length; i++) {
    if (pricesHighRaw[i] != null && pricesLowRaw[i] != null && pricesCloseRaw[i] != null && pricesOpenRaw[i] != null) {
      pricesHigh.push(pricesHighRaw[i]);
      pricesLow.push(pricesLowRaw[i]);
      pricesClose.push(pricesCloseRaw[i]);
      pricesOpen.push(pricesOpenRaw[i]);
      timestamps.push(data.timestamp[i]);
    }
  }

  if (intervalStr === '240') {
    const aggHighs = [];
    const aggLows = [];
    const aggCloses = [];
    const aggOpens = [];
    
    let currentCandle = null;

    for (let i = 0; i < pricesClose.length; i++) {
      const date = new Date(timestamps[i] * 1000);
      const hour = date.getUTCHours();
      const candleStartHour = Math.floor(hour / 4) * 4;

      if (!currentCandle || currentCandle.startHour !== candleStartHour) {
        if (currentCandle) {
          aggOpens.push(currentCandle.open);
          aggHighs.push(currentCandle.high);
          aggLows.push(currentCandle.low);
          aggCloses.push(currentCandle.close);
        }
        currentCandle = {
          startHour: candleStartHour,
          open: pricesOpen[i],
          high: pricesHigh[i],
          low: pricesLow[i],
          close: pricesClose[i]
        };
      } else {
        currentCandle.high = Math.max(currentCandle.high, pricesHigh[i]);
        currentCandle.low = Math.min(currentCandle.low, pricesLow[i]);
        currentCandle.close = pricesClose[i];
      }
    }
    if (currentCandle) {
      aggOpens.push(currentCandle.open);
      aggHighs.push(currentCandle.high);
      aggLows.push(currentCandle.low);
      aggCloses.push(currentCandle.close);
    }

    pricesHigh = aggHighs;
    pricesLow = aggLows;
    pricesClose = aggCloses;
    pricesOpen = aggOpens;
  }

  if (pricesHigh.length < 5) {
     return { signal: 'WAIT', reason: 'Insufficient data' };
  }

  // Scan the last 10 candles for the CRT pattern
  for (let i = pricesHigh.length - 2; i >= pricesHigh.length - 10; i--) {
    const c1High = pricesHigh[i - 2];
    const c1Low = pricesLow[i - 2];
    const c1Mid = (c1High + c1Low) / 2;
    
    const c2High = pricesHigh[i - 1];
    const c2Low = pricesLow[i - 1];
    const c2Close = pricesClose[i - 1];
    
    const c3Close = pricesClose[i];
    const c3High = pricesHigh[i];
    const c3Low = pricesLow[i];

    // Bullish CRT (BUY)
    const sweptSellSide = c2Low < c1Low;
    const closedInsideBuy = c2Close > c1Low;
    const buyConfirmed = c3Close > c2High;

    if (sweptSellSide && closedInsideBuy && buyConfirmed) {
      let valid = true;
      for (let j = i + 1; j < pricesHigh.length; j++) {
         if (pricesLow[j] < c2Low) valid = false;
      }
      if (valid) {
        const entry = pricesClose[pricesClose.length - 1];
        const sl = c2Low - (c1High - c1Low) * 0.1;
        const rawTp = c1High;
        const tp = Math.min(rawTp, entry + (entry - sl) * 3.0); // cap at 3x risk
        const risk = entry - sl;
        const reward = tp - entry;
        const rr = (reward / risk).toFixed(2);
        if (reward >= risk * 1.5 && entry < tp) {
           return {
             signal: 'BUY', entry, sl, tp,
             setupTime: timestamps[i - 2], // C1 time
             reason: 'CRT Setup (AMD)',
             reasoning: [
               `Reference candle (C1) range: ${c1Low.toFixed(5)} — ${c1High.toFixed(5)}`,
               `C2 swept sell-side liquidity below C1 low (${c2Low.toFixed(5)}) then closed back inside range`,
               `C3 confirmed bullish shift: closed above C2 high (${c2High.toFixed(5)})`,
               `Stop placed below C2 manipulation wick at ${sl.toFixed(5)}`,
               `Target capped at 3x risk: ${tp.toFixed(5)} — R:R ratio ${rr}x ✅`
             ]
           };
        } else if (reward > 0 && entry < tp) {
           return { signal: 'WAIT', reason: 'CRT forming (R:R < 1.5x)' };
        }
      }
    }

    // Bearish CRT (SELL)
    const sweptBuySide = c2High > c1High;
    const closedInsideSell = c2Close < c1High;
    const sellConfirmed = c3Close < c2Low;

    if (sweptBuySide && closedInsideSell && sellConfirmed) {
      let valid = true;
      for (let j = i + 1; j < pricesHigh.length; j++) {
         if (pricesHigh[j] > c2High) valid = false;
      }
      if (valid) {
        const entry = pricesClose[pricesClose.length - 1];
        const sl = c2High + (c1High - c1Low) * 0.1;
        const rawTp = c1Low;
        const tp = Math.max(rawTp, entry - (sl - entry) * 3.0); // cap at 3x risk
        const risk = sl - entry;
        const reward = entry - tp;
        const rr = (reward / risk).toFixed(2);
        if (reward >= risk * 1.5 && entry > tp) {
           return {
             signal: 'SELL', entry, sl, tp,
             setupTime: timestamps[i - 2], // C1 time
             reason: 'CRT Setup (AMD)',
             reasoning: [
               `Reference candle (C1) range: ${c1Low.toFixed(5)} — ${c1High.toFixed(5)}`,
               `C2 swept buy-side liquidity above C1 high (${c2High.toFixed(5)}) then closed back inside range`,
               `C3 confirmed bearish shift: closed below C2 low (${c2Low.toFixed(5)})`,
               `Stop placed above C2 manipulation wick at ${sl.toFixed(5)}`,
               `Target capped at 3x risk: ${tp.toFixed(5)} — R:R ratio ${rr}x ✅`
             ]
           };
        } else if (reward > 0 && entry > tp) {
           return { signal: 'WAIT', reason: 'CRT forming (R:R < 1.5x)' };
        }
      }
    }
  }

  return { signal: 'NEUTRAL', reason: 'No CRT setup found' };
}

/**
 * Justin Setup Strategy
 *
 * Scenario Matrix:
 * STRONG SELL: 4H Bearish FVG only, 1H Bearish FVG only, 15M rallies INTO bearish FVG,
 *              5M sweeps recent high + CISD down
 * STRONG BUY:  4H Bullish FVG only, 1H Bullish FVG only, 15M drops INTO bullish FVG,
 *              5M sweeps recent low + CISD up
 * MIXED A-D:   Various partial alignment scenarios
 */

/**
 * Detect all Fair Value Gaps (FVGs) in candle data.
 */
function detectFVGs(highs, lows, closes, timestamps) {
  const bullishFVGs = [];
  const bearishFVGs = [];

  for (let i = 2; i < highs.length - 1; i++) {
    const prevHigh = highs[i - 2];
    const prevLow  = lows[i - 2];
    const currHigh = highs[i];
    const currLow  = lows[i];
    const midCandle = closes[i - 1];

    if (currLow > prevHigh) {
      bullishFVGs.push({ low: prevHigh, high: currLow, midCandle, index: i, time: timestamps[i-1], mitigated: false });
    }
    if (currHigh < prevLow) {
      bearishFVGs.push({ low: currHigh, high: prevLow, midCandle, index: i, time: timestamps[i-1], mitigated: false });
    }
  }

  for (const fvg of bullishFVGs) {
    for (let j = fvg.index + 1; j < lows.length; j++) {
      if (lows[j] <= fvg.high) { fvg.mitigated = true; break; }
    }
  }
  for (const fvg of bearishFVGs) {
    for (let j = fvg.index + 1; j < highs.length; j++) {
      if (highs[j] >= fvg.low) { fvg.mitigated = true; break; }
    }
  }

  return { bullishFVGs, bearishFVGs };
}

/**
 * Detect internal liquidity sweeps in the last N candles.
 * Tick 01 for BUY: Price sweeps a recent low (stop hunt below structure)
 * Tick 01 for SELL: Price sweeps a recent high (liquidity grab)
 */
function detectSweep(highs, lows, closes, lookback = 30) {
  const len = highs.length;
  const start = Math.max(0, len - lookback);

  let swingLow = lows[start];
  let swingHigh = highs[start];

  for (let i = start; i < len - 3; i++) {
    swingLow  = Math.min(swingLow,  lows[i]);
    swingHigh = Math.max(swingHigh, highs[i]);
  }

  for (let i = len - 3; i < len - 1; i++) {
    const sweptDown = lows[i]  < swingLow  && closes[i] > swingLow;
    const sweptUp   = highs[i] > swingHigh && closes[i] < swingHigh;
    if (sweptDown) return { type: 'BUY_SWEEP',  sweepLow:  lows[i],  sweepIndex: i, swingLow  };
    if (sweptUp)   return { type: 'SELL_SWEEP', sweepHigh: highs[i], sweepIndex: i, swingHigh };
  }

  return null;
}

/**
 * Detect CISD (Change in State of Delivery):
 * Tick 02 for SELL: A candle that closes BELOW a previous up-close candle
 * Tick 02 for BUY:  A candle that closes ABOVE a previous down-close candle
 */
function detectCISD(highs, lows, closes, opens, lookback = 10) {
  const len = closes.length;
  const start = Math.max(0, len - lookback);

  let recentStructureHigh = highs[start];
  let recentStructureLow  = lows[start];

  for (let i = start; i < len - 3; i++) {
    recentStructureHigh = Math.max(recentStructureHigh, highs[i]);
    recentStructureLow  = Math.min(recentStructureLow,  lows[i]);
  }

  let bullishCount = 0;
  let bearishCount = 0;

  for (let i = len - 3; i < len - 1; i++) {
    const body     = Math.abs(closes[i] - opens[i]);
    const range    = highs[i] - lows[i];
    const isBullish = closes[i] > opens[i] && body > range * 0.6;
    const isBearish = closes[i] < opens[i] && body > range * 0.6;
    if (isBullish) bullishCount++;
    if (isBearish) bearishCount++;
  }

  const bullishCISD = bullishCount >= 2 && closes[len - 2] > recentStructureHigh;
  const bearishCISD = bearishCount >= 2 && closes[len - 2] < recentStructureLow;

  // SL levels per your spec:
  // SELL SL = CISD candle high
  // BUY  SL = CISD candle low
  const cisdHigh = Math.max(...highs.slice(len - 3, len - 1));
  const cisdLow  = Math.min(...lows.slice(len - 3, len - 1));

  const cisdBullFVG = bullishCISD ? { low: cisdLow,  high: cisdHigh, entry: cisdLow  } : null;
  const cisdBearFVG = bearishCISD ? { low: cisdLow,  high: cisdHigh, entry: cisdHigh } : null;

  return { bullishCISD, bearishCISD, cisdBullFVG, cisdBearFVG, cisdHigh, cisdLow };
}

/**
 * SMT Divergence check
 */
function checkSMTDivergence(primaryLows, primaryHighs, correlatedLows, correlatedHighs, lookback = 20) {
  const pLen = primaryLows.length;
  const cLen = correlatedLows.length;

  const pRecentLow  = Math.min(...primaryLows.slice(Math.max(0, pLen - lookback), pLen - 1));
  const pPrevLow    = Math.min(...primaryLows.slice(Math.max(0, pLen - lookback * 2), pLen - lookback - 1));
  const cRecentLow  = Math.min(...correlatedLows.slice(Math.max(0, cLen - lookback), cLen - 1));
  const cPrevLow    = Math.min(...correlatedLows.slice(Math.max(0, cLen - lookback * 2), cLen - lookback - 1));

  const pRecentHigh = Math.max(...primaryHighs.slice(Math.max(0, pLen - lookback), pLen - 1));
  const pPrevHigh   = Math.max(...primaryHighs.slice(Math.max(0, pLen - lookback * 2), pLen - lookback - 1));
  const cRecentHigh = Math.max(...correlatedHighs.slice(Math.max(0, cLen - lookback), cLen - 1));
  const cPrevHigh   = Math.max(...correlatedHighs.slice(Math.max(0, cLen - lookback * 2), cLen - lookback - 1));

  const bullishSMT = pRecentLow < pPrevLow && cRecentLow >= cPrevLow;
  const bearishSMT = pRecentHigh > pPrevHigh && cRecentHigh <= cPrevHigh;

  return { bullishSMT, bearishSMT };
}

/**
 * Checks whether price is trading INTO (inside or touching) a given FVG zone.
 */
function isPriceInFVG(currentPrice, fvg) {
  if (!fvg) return false;
  return currentPrice >= fvg.low && currentPrice <= fvg.high;
}

/**
 * Evaluate Scenario Matrix from HTF context + 5M data.
 * Returns one of: STRONG_BUY, STRONG_SELL, MIXED_A, MIXED_B, MIXED_C, MIXED_D, NEUTRAL
 */
export function evaluateScenario(htfContext, currentPrice) {
  const { h4Bull, h4Bear, h1Bull, h1Bear, m15Bull, m15Bear } = htfContext;

  const h4HasBullOnly = h4Bull && !h4Bear;
  const h4HasBearOnly = h4Bear && !h4Bull;
  const h4HasNeither  = !h4Bull && !h4Bear;
  const h4HasBoth     = h4Bull && h4Bear;

  const h1HasBullOnly = h1Bull && !h1Bear;
  const h1HasBearOnly = h1Bear && !h1Bull;
  const h1HasBearish  = !!h1Bear;

  const m15PriceInBullFVG = isPriceInFVG(currentPrice, m15Bull);
  const m15PriceInBearFVG = isPriceInFVG(currentPrice, m15Bear);

  // ── STRONG SELL ──────────────────────────────────────────────────────────
  // 4H: Bearish FVG only | 1H: Bearish FVG only | 15M: Price rallied into bearish FVG
  if (h4HasBearOnly && h1HasBearOnly && m15PriceInBearFVG) {
    return {
      scenario: 'STRONG_SELL',
      label: '🔴 STRONG SELL',
      color: 'var(--sell-red)',
      interpretation: 'All HTF timeframes bearish. Price rallied into 15M bearish FVG — look for sweep of recent high on 5M, then CISD down.',
      action: 'Wait for 5M: (1) Sweep recent high → (2) CISD candle closes below prior up-close → SELL'
    };
  }

  // ── STRONG BUY ───────────────────────────────────────────────────────────
  // 4H: Bullish FVG only | 1H: Bullish FVG only | 15M: Price dropped into bullish FVG
  if (h4HasBullOnly && h1HasBullOnly && m15PriceInBullFVG) {
    return {
      scenario: 'STRONG_BUY',
      label: '🟢 STRONG BUY',
      color: 'var(--buy-green)',
      interpretation: 'All HTF timeframes bullish. Price dropped into 15M bullish FVG — look for sweep of recent low on 5M, then CISD up.',
      action: 'Wait for 5M: (1) Sweep recent low → (2) CISD candle closes above prior down-close → BUY'
    };
  }

  // ── MIXED A: 4H Bearish but 15M Bullish FVG unmitigated ──────────────────
  if (h4HasBearOnly && m15Bull && !m15Bear) {
    return {
      scenario: 'MIXED_A',
      label: '🟡 MIXED — Scenario A',
      color: '#f0b429',
      interpretation: 'HTF wants down, but 15M has a bullish draw on liquidity upward first.',
      action: 'DO NOT BUY — counter-trend. Let price fill the 15M bullish FVG, then look for sell from there.'
    };
  }

  // ── MIXED B: 4H has no FVG, 1H Bearish ───────────────────────────────────
  if (h4HasNeither && h1HasBearish) {
    return {
      scenario: 'MIXED_B',
      label: '🟡 WAIT — Scenario B',
      color: '#f0b429',
      interpretation: 'No 4H FVG magnet. 1H shows bearish structure but there is no high-conviction HTF draw.',
      action: 'Wait for 4H to create a new FVG or for price to reach an existing 4H level before entering.'
    };
  }

  // ── MIXED C: All timeframes show BOTH FVGs (consolidation) ───────────────
  if (h4HasBoth) {
    return {
      scenario: 'MIXED_C',
      label: '🟡 CONSOLIDATION — Scenario C',
      color: '#f0b429',
      interpretation: 'Market is in consolidation / accumulation. Competing FVGs on 4H indicate no directional bias.',
      action: 'Mark the range highs and lows. Wait for a sweep of either side, then look for CISD in the opposite direction.'
    };
  }

  // ── MIXED D: 4H Bullish but 1H Bearish ───────────────────────────────────
  if (h4HasBullOnly && h1HasBearish) {
    return {
      scenario: 'MIXED_D',
      label: '🟡 PULLBACK — Scenario D',
      color: '#f0b429',
      interpretation: 'HTF (4H) is bullish but 1H is in a bearish pullback. Price is retracing within a larger uptrend.',
      action: 'Wait for 1H bearish FVG to get mitigated (price taps it and rejects), then look for BUY on 15M.'
    };
  }

  // ── NEUTRAL / INSUFFICIENT DATA ───────────────────────────────────────────
  return {
    scenario: 'NEUTRAL',
    label: '⚪ NEUTRAL',
    color: 'var(--text-secondary)',
    interpretation: 'No clear FVG alignment across timeframes.',
    action: 'Wait for a clear setup to form.'
  };
}

export function analyzeJustinSetup(primaryData, correlatedData, intervalStr) {
  if (!primaryData || !primaryData.timestamp || primaryData.timestamp.length < 30) {
    return { signal: 'WAIT', reason: 'Gathering data...' };
  }

  const pRaw = primaryData.indicators.quote[0];
  const pTimestamps = [];
  const pH = [], pL = [], pC = [], pO = [];

  for (let i = 0; i < pRaw.close.length; i++) {
    if (pRaw.high[i] != null && pRaw.low[i] != null && pRaw.close[i] != null && pRaw.open[i] != null) {
      pH.push(pRaw.high[i]);
      pL.push(pRaw.low[i]);
      pC.push(pRaw.close[i]);
      pO.push(pRaw.open[i]);
      pTimestamps.push(primaryData.timestamp[i]);
    }
  }

  let cH = [], cL = [];
  if (correlatedData?.indicators) {
    const cRaw = correlatedData.indicators.quote[0];
    for (let i = 0; i < cRaw.close.length; i++) {
      if (cRaw.high[i] != null && cRaw.low[i] != null && cRaw.close[i] != null && cRaw.open[i] != null) {
        cH.push(cRaw.high[i]);
        cL.push(cRaw.low[i]);
      }
    }
  }

  if (pH.length < 20) return { signal: 'WAIT', reason: 'Insufficient data' };

  const currentPrice = pC[pC.length - 2];
  const { bullishFVGs, bearishFVGs } = detectFVGs(pH, pL, pC, pTimestamps);

  const unmitigatedBull = bullishFVGs.filter(f => !f.mitigated);
  const unmitigatedBear = bearishFVGs.filter(f => !f.mitigated);
  const mitigatedBull   = bullishFVGs.filter(f => f.mitigated);
  const mitigatedBear   = bearishFVGs.filter(f => f.mitigated);

  const recentMitigatedBull = mitigatedBull.slice(-3).reverse();
  const recentMitigatedBear = mitigatedBear.slice(-3).reverse();

  const nearestBullFVG = [...unmitigatedBull].sort((a, b) => Math.abs(currentPrice - a.high) - Math.abs(currentPrice - b.high))[0] || null;
  const nearestBearFVG = [...unmitigatedBear].sort((a, b) => Math.abs(currentPrice - a.low)  - Math.abs(currentPrice - b.low))[0]  || null;

  // HTF timeframes (4H, 1H, 15M) — return FVG info only, no entry signal
  if (intervalStr !== '5') {
    return {
      nearestBullFVG,
      nearestBearFVG,
      recentMitigatedBull,
      recentMitigatedBear,
      allBullishFVGs: unmitigatedBull,
      allBearishFVGs: unmitigatedBear,
      currentPrice,
      signal: 'HTF_INFO'
    };
  }

  // ── 5M Entry Logic ────────────────────────────────────────────────────────
  const sweep = detectSweep(pH, pL, pC, 40);
  const { bullishCISD, bearishCISD, cisdBullFVG, cisdBearFVG, cisdHigh, cisdLow } = detectCISD(pH, pL, pC, pO);

  const hasSMT = cH.length > 20;
  const { bullishSMT, bearishSMT } = hasSMT
    ? checkSMTDivergence(pL, pH, cL, cH)
    : { bullishSMT: false, bearishSMT: false };

  const atr = pH.slice(-14).reduce((acc, h, i) => acc + (h - pL[pL.length - 14 + i]), 0) / 14;

  return {
    signal: '5M_DATA',
    currentPrice,
    sweep,
    bullishCISD,
    bearishCISD,
    cisdBullFVG,
    cisdBearFVG,
    cisdHigh,
    cisdLow,
    bullishSMT,
    bearishSMT,
    atr,
    setupTime: pTimestamps[pTimestamps.length - 1],
    nearestBullFVG,
    nearestBearFVG,
    recentMitigatedBull,
    recentMitigatedBear,
    allBullishFVGs: unmitigatedBull,
    allBearishFVGs: unmitigatedBear,
  };
}

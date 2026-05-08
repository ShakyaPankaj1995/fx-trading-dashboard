/**
 * Justin Setup Strategy
 * 
 * Steps:
 * 1. HTF Bullish/Bearish FVG detected
 * 2. Price enters FVG zone ("draw on liquidity")
 * 3. Internal liquidity sweep (Turtle Soup trap)
 * 4. SMT Divergence: primaryData vs correlatedData (NQ vs ES)
 * 5. CISD: violent directional displacement confirms entry
 */

/**
 * Detect all Fair Value Gaps (FVGs) in candle data.
 * FVG: Gap between candle[i-2].high and candle[i].low (bullish)
 *      or candle[i-2].low and candle[i].high (bearish)
 */
function detectFVGs(highs, lows, closes, timestamps) {
  const bullishFVGs = [];
  const bearishFVGs = [];

  for (let i = 2; i < highs.length; i++) {
    const prevHigh = highs[i - 2];
    const prevLow  = lows[i - 2];
    const currHigh = highs[i];
    const currLow  = lows[i];
    const midCandle = closes[i - 1]; // The "imbalance" candle

    // Bullish FVG: gap between i-2 high and i low (price moved up aggressively)
    if (currLow > prevHigh) {
      bullishFVGs.push({
        low: prevHigh,
        high: currLow,
        midCandle,
        index: i,
        time: timestamps[i-1], // Use the middle candle's timestamp
        mitigated: false,
      });
    }

    // Bearish FVG: gap between i-2 low and i high (price moved down aggressively)
    if (currHigh < prevLow) {
      bearishFVGs.push({
        low: currHigh,
        high: prevLow,
        midCandle,
        index: i,
        time: timestamps[i-1],
        mitigated: false,
      });
    }
  }

  // Mark FVGs as mitigated if price later entered the zone
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
 * Detect internal liquidity sweeps in the last N candles
 * A sweep is a wick that goes below a recent swing low / above a swing high
 * then closes back inside.
 */
function detectSweep(highs, lows, closes, lookback = 30) {
  const len = highs.length;
  const start = Math.max(0, len - lookback);

  // Find the most recent swing low and high in the lookback window
  let swingLow = lows[start];
  let swingHigh = highs[start];

  for (let i = start; i < len - 3; i++) {
    swingLow = Math.min(swingLow, lows[i]);
    swingHigh = Math.max(swingHigh, highs[i]);
  }

  // Check the last few candles for a sweep
  for (let i = len - 3; i < len; i++) {
    const sweptDown = lows[i] < swingLow && closes[i] > swingLow;
    const sweptUp   = highs[i] > swingHigh && closes[i] < swingHigh;

    if (sweptDown) return { type: 'BUY_SWEEP', sweepLow: lows[i], sweepIndex: i, swingLow };
    if (sweptUp)   return { type: 'SELL_SWEEP', sweepHigh: highs[i], sweepIndex: i, swingHigh };
  }

  return null;
}

/**
 * Detect CISD (Change in State of Delivery):
 * 2+ strong consecutive candles in one direction that break recent structure
 */
function detectCISD(highs, lows, closes, opens, lookback = 10) {
  const len = closes.length;
  const start = Math.max(0, len - lookback);

  // Find recent swing low/high before last 3 candles
  let recentStructureHigh = highs[start];
  let recentStructureLow  = lows[start];

  for (let i = start; i < len - 3; i++) {
    recentStructureHigh = Math.max(recentStructureHigh, highs[i]);
    recentStructureLow  = Math.min(recentStructureLow,  lows[i]);
  }

  // Check last 3 candles for impulsive move
  let bullishCount = 0;
  let bearishCount = 0;

  for (let i = len - 3; i < len; i++) {
    const body = Math.abs(closes[i] - opens[i]);
    const range = highs[i] - lows[i];
    const isBullish = closes[i] > opens[i] && body > range * 0.6;
    const isBearish = closes[i] < opens[i] && body > range * 0.6;

    if (isBullish) bullishCount++;
    if (isBearish) bearishCount++;
  }

  const bullishCISD = bullishCount >= 2 && closes[len - 1] > recentStructureHigh;
  const bearishCISD = bearishCount >= 2 && closes[len - 1] < recentStructureLow;

  // Find the FVG left by the CISD move
  const cisdBullFVG = bullishCISD ? {
    low: Math.min(...highs.slice(len - 3, len - 1)),
    high: Math.max(...highs.slice(len - 3, len - 1)),
    entry: Math.min(...highs.slice(len - 3, len - 1))
  } : null;

  const cisdBearFVG = bearishCISD ? {
    low: Math.min(...lows.slice(len - 3, len - 1)),
    high: Math.max(...lows.slice(len - 3, len - 1)),
    entry: Math.max(...lows.slice(len - 3, len - 1))
  } : null;

  return { bullishCISD, bearishCISD, cisdBullFVG, cisdBearFVG };
}

/**
 * SMT Divergence check:
 * Primary (NQ) makes a LOWER LOW, but correlated (ES) does NOT → Bullish SMT
 * Primary (NQ) makes a HIGHER HIGH, but correlated (ES) does NOT → Bearish SMT
 */
function checkSMTDivergence(primaryLows, primaryHighs, correlatedLows, correlatedHighs, lookback = 20) {
  const pLen = primaryLows.length;
  const cLen = correlatedLows.length;

  const pRecentLow  = Math.min(...primaryLows.slice(Math.max(0, pLen - lookback)));
  const pPrevLow    = Math.min(...primaryLows.slice(Math.max(0, pLen - lookback * 2), pLen - lookback));
  const cRecentLow  = Math.min(...correlatedLows.slice(Math.max(0, cLen - lookback)));
  const cPrevLow    = Math.min(...correlatedLows.slice(Math.max(0, cLen - lookback * 2), cLen - lookback));

  const pRecentHigh = Math.max(...primaryHighs.slice(Math.max(0, pLen - lookback)));
  const pPrevHigh   = Math.max(...primaryHighs.slice(Math.max(0, pLen - lookback * 2), pLen - lookback));
  const cRecentHigh = Math.max(...correlatedHighs.slice(Math.max(0, cLen - lookback)));
  const cPrevHigh   = Math.max(...correlatedHighs.slice(Math.max(0, cLen - lookback * 2), cLen - lookback));

  // Bullish SMT: Primary made lower low, correlated did NOT
  const bullishSMT = pRecentLow < pPrevLow && cRecentLow >= cPrevLow;

  // Bearish SMT: Primary made higher high, correlated did NOT
  const bearishSMT = pRecentHigh > pPrevHigh && cRecentHigh <= cPrevHigh;

  return { bullishSMT, bearishSMT };
}

export function analyzeJustinSetup(primaryData, correlatedData, intervalStr) {
  if (!primaryData || !primaryData.timestamp || primaryData.timestamp.length < 30) {
    return { signal: 'WAIT', reason: 'Gathering data...' };
  }

  // --- Extract & clean primary candles ---
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

  // --- Extract & clean correlated candles (if available) ---
  let cH = [], cL = [], cC = [], cO = [];
  if (correlatedData && correlatedData.indicators) {
    const cRaw = correlatedData.indicators.quote[0];
    for (let i = 0; i < cRaw.close.length; i++) {
      if (cRaw.high[i] != null && cRaw.low[i] != null && cRaw.close[i] != null && cRaw.open[i] != null) {
        cH.push(cRaw.high[i]);
        cL.push(cRaw.low[i]);
        cC.push(cRaw.close[i]);
        cO.push(cRaw.open[i]);
      }
    }
  }

  if (pH.length < 20) return { signal: 'WAIT', reason: 'Insufficient data' };

  const currentPrice = pC[pC.length - 1];
  const currentClose = currentPrice;

  // --- Step 1: Detect HTF FVGs ---
  const { bullishFVGs, bearishFVGs } = detectFVGs(pH, pL, pC, pTimestamps);

  // Find the most recent unmitigated FVGs
  const activeBullFVG = [...bullishFVGs].reverse().find(f => !f.mitigated);
  const activeBearFVG = [...bearishFVGs].reverse().find(f => !f.mitigated);

  // HTF Confirmation (for 4H, 1H, 15M)
  if (intervalStr !== '5') {
    if (activeBullFVG) return { signal: 'WAIT', reason: 'Bullish FVG Identified (Unmitigated)', color: 'var(--buy-green)' };
    if (activeBearFVG) return { signal: 'WAIT', reason: 'Bearish FVG Identified (Unmitigated)', color: 'var(--sell-red)' };
    return { signal: 'NEUTRAL', reason: 'No unmitigated HTF FVGs found' };
  }

  // --- 5M Entry Logic ---
  // Condition 1: Inside HTF FVG (We use the current timeframe's FVG if HTF data isn't passed, but the strategy is designed to work on the HTF context)
  const inBullFVG = activeBullFVG && currentClose >= activeBullFVG.low && currentClose <= activeBullFVG.high;
  const inBearFVG = activeBearFVG && currentClose <= activeBearFVG.high && currentClose >= activeBearFVG.low;

  // Condition 2: Sweep
  const sweep = detectSweep(pH, pL, pC, 40);

  // Condition 3: CISD
  const { bullishCISD, bearishCISD, cisdBullFVG, cisdBearFVG } = detectCISD(pH, pL, pC, pO);

  // SMT (Optional extra)
  const hasSMT = cH.length > 20;
  const { bullishSMT, bearishSMT } = hasSMT
    ? checkSMTDivergence(pL, pH, cL, cH)
    : { bullishSMT: false, bearishSMT: false };

  // Calculate ATR for SL buffer
  const atr = pH.slice(-14).reduce((acc, h, i) => acc + (h - pL[pL.length - 14 + i]), 0) / 14;

  const confirmations = {
    inFVG: inBullFVG || inBearFVG,
    sweep: !!sweep,
    cisd: bullishCISD || bearishCISD
  };

  // ===== BUY SIGNAL =====
  if (inBullFVG && sweep?.type === 'BUY_SWEEP' && bullishCISD) {
    const sweepLow = sweep.sweepLow;
    const entry    = cisdBullFVG ? cisdBullFVG.low : currentClose;
    const sl       = sweepLow - atr * 0.1;
    const tp       = entry + (entry - sl) * 2.5;
    
    return {
      signal: 'BUY', entry, sl, tp,
      setupTime: pTimestamps[pTimestamps.length - 1],
      confirmations, currentPrice,
      reason: 'Justin Setup — 5M Entry Confirmed',
      reasoning: [
        `✅ Price inside HTF Bullish FVG (${activeBullFVG.low.toFixed(2)}-${activeBullFVG.high.toFixed(2)})`,
        `✅ Internal Low swept at ${sweepLow.toFixed(2)} (Liquidity grabbed)`,
        `✅ Bullish CISD: Displacement shift confirmed`,
        `R:R: 2.5x Target set at ${tp.toFixed(2)}`
      ],
      allBullishFVGs: bullishFVGs.filter(f => !f.mitigated),
      allBearishFVGs: bearishFVGs.filter(f => !f.mitigated)
    };
  }

  // ===== SELL SIGNAL =====
  if (inBearFVG && sweep?.type === 'SELL_SWEEP' && bearishCISD) {
    const sweepHigh = sweep.sweepHigh;
    const entry     = cisdBearFVG ? cisdBearFVG.high : currentClose;
    const sl        = sweepHigh + atr * 0.1;
    const tp        = entry - (sl - entry) * 2.5;

    return {
      signal: 'SELL', entry, sl, tp,
      setupTime: pTimestamps[pTimestamps.length - 1],
      confirmations, currentPrice,
      reason: 'Justin Setup — 5M Entry Confirmed',
      reasoning: [
        `✅ Price inside HTF Bearish FVG (${activeBearFVG.low.toFixed(2)}-${activeBearFVG.high.toFixed(2)})`,
        `✅ Internal High swept at ${sweepHigh.toFixed(2)} (Liquidity grabbed)`,
        `✅ Bearish CISD: Displacement shift confirmed`,
        `R:R: 2.5x Target set at ${tp.toFixed(2)}`
      ],
      allBullishFVGs: bullishFVGs.filter(f => !f.mitigated),
      allBearishFVGs: bearishFVGs.filter(f => !f.mitigated)
    };
  }

  return { 
    signal: 'WAIT', 
    reason: 'Justin Setup: Scanning 5M Conditions...',
    confirmations, currentPrice,
    activeBullFVG,
    activeBearFVG,
    allBullishFVGs: bullishFVGs.filter(f => !f.mitigated),
    allBearishFVGs: bearishFVGs.filter(f => !f.mitigated)
  };
}

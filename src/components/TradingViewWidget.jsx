import React, { useEffect, useRef, memo, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { analyzeData, analyzeCRTData } from '../utils/strategy';
import { analyzeJustinSetup } from '../utils/justinStrategy';
import { useSignalLogContext } from '../context/SignalLogContext';

// Aggregate 60m candles into 4H candles
function aggregateTo4H(candles) {
  const groups = {};
  candles.forEach(c => {
    // Group into 4-hour blocks (0:00, 4:00, 8:00, 12:00, 16:00, 20:00)
    const blockKey = Math.floor(c.time / (4 * 3600)) * (4 * 3600);
    if (!groups[blockKey]) {
      groups[blockKey] = { time: blockKey, open: c.open, high: c.high, low: c.low, close: c.close };
    } else {
      const g = groups[blockKey];
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.close = c.close;
    }
  });
  return Object.values(groups).sort((a, b) => a.time - b.time);
}

// Also aggregate raw Yahoo data for 4H analysis
function aggregateRawTo4H(data) {
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
  // Rebuild into Yahoo-like format for analyzeJustinSetup
  return {
    timestamp: sorted.map(c => c.time),
    indicators: { quote: [{ open: sorted.map(c => c.open), high: sorted.map(c => c.high), low: sorted.map(c => c.low), close: sorted.map(c => c.close) }] }
  };
}

const TradingViewWidget = ({ symbol, interval }) => {
  const chartContainerRef = useRef();
  const chartRef = useRef();
  const fvgDimSeriesRef = useRef();
  const fvgHighlightSeriesRef = useRef();
  const priceLinesRef = useRef([]);
  const { logs } = useSignalLogContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const isForex = !['GOLD', 'XAUUSD', 'GC=F', 'S&P500', 'NASDAQ', 'SPX', 'NDX', 'ES=F', 'NQ=F'].includes(symbol);
    const chartPrecision = symbol.includes('JPY') ? 3 : isForex ? 5 : 2;
    const minMove = 1 / Math.pow(10, chartPrecision);

    // Initialize Chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#181a20' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: 'rgba(43, 49, 57, 0.5)' },
        horzLines: { color: 'rgba(43, 49, 57, 0.5)' },
      },
      width: chartContainerRef.current.clientWidth || 400,
      height: chartContainerRef.current.clientHeight || 300,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    });

    // 1. Add Setup Series first (so they are BEHIND the candles)
    const rewardSeries = chart.addAreaSeries({
      topColor: 'rgba(14, 203, 129, 0.3)',
      bottomColor: 'rgba(14, 203, 129, 0.05)',
      lineColor: 'rgba(14, 203, 129, 0.4)',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      lineWidth: 1,
    });

    const riskSeries = chart.addAreaSeries({
      topColor: 'rgba(246, 70, 93, 0.3)',
      bottomColor: 'rgba(246, 70, 93, 0.05)',
      lineColor: 'rgba(246, 70, 93, 0.4)',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      lineWidth: 1,
    });

    // 2. Add Candle Series on top
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#0ecb81',
      downColor: '#f6465d',
      borderVisible: false,
      wickUpColor: '#0ecb81',
      wickDownColor: '#f6465d',
      priceFormat: {
        type: 'price',
        precision: chartPrecision,
        minMove: minMove,
      },
    });

    chartRef.current = chart;
    priceLinesRef.current = []; // Reset local memory for this new chart instance
    let isMounted = true;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Yahoo Finance intervals: use 60m for both 4H and 1H, then aggregate for 4H
        let yfInterval = '15m';
        let range = '5d';
        switch(interval) {
          case '240': yfInterval = '60m'; range = '1mo'; break;
          case '60':  yfInterval = '60m'; range = '5d';  break;  // 1H: 5d range (not 1mo)
          case '15':  yfInterval = '15m'; range = '5d';  break;
          case '5':   yfInterval = '5m';  range = '5d';  break;
          default:    yfInterval = '15m'; range = '5d';
        }

        let yfSymbol = `${symbol}=X`;
        if (symbol === 'SPX' || symbol === 'S&P500' || symbol === 'SP500') yfSymbol = '^GSPC';
        else if (symbol === 'NDX' || symbol === 'NASDAQ') yfSymbol = '^IXIC';
        else if (symbol === 'XAUUSD' || symbol === 'GOLD') yfSymbol = 'XAUUSD=X';

        const res = await fetch(`/api/finance/v8/finance/chart/${yfSymbol}?interval=${yfInterval}&range=${range}`);
        if (!isMounted) return;
        if (!res.ok) throw new Error('Data fetch failed');
        const json = await res.json();
        const data = json.chart.result[0];

        // Build raw formatted candles
        let formattedData = data.timestamp.map((time, i) => ({
          time: time,
          open: data.indicators.quote[0].open[i],
          high: data.indicators.quote[0].high[i],
          low: data.indicators.quote[0].low[i],
          close: data.indicators.quote[0].close[i],
        })).filter(d => d.open != null && d.high != null && d.low != null && d.close != null);

        // For 4H: aggregate 60m candles into 4H candles
        let analysisData = data;
        if (interval === '240') {
          formattedData = aggregateTo4H(formattedData);
          analysisData = aggregateRawTo4H(data);
        }

        if (formattedData.length === 0) throw new Error('No data');

        candleSeries.setData(formattedData);

        // 3. Justin Setup Analysis (uses the correct-timeframe data)
        const justinSignal = analyzeJustinSetup(analysisData, null, interval);
        
        // --- Multi-Series FVG Rendering (Limited to Mentioned Gaps) ---
        const nearestBull = justinSignal.nearestBullFVG;
        const nearestBear = justinSignal.nearestBearFVG;
        const recentMitBull = (justinSignal.recentMitigatedBull || []).slice(0, 1);
        const recentMitBear = (justinSignal.recentMitigatedBear || []).slice(0, 1);

        // Cleanup existing FVG series pool
        if (!window.fvgSeriesPool) window.fvgSeriesPool = [];
        window.fvgSeriesPool.forEach(s => { try { chart.removeSeries(s); } catch(e) {} });
        window.fvgSeriesPool = [];

        const drawFVGBox = (fvg, isBull, isMitigated, isActive) => {
          if (!fvg || isNaN(fvg.high) || isNaN(fvg.low)) return;
          
          const series = chart.addCandlestickSeries({
            upColor: isMitigated ? 'rgba(0,0,0,0)' : (isBull ? (isActive ? 'rgba(102, 255, 0, 0.65)' : 'rgba(102, 255, 0, 0.35)') : (isActive ? 'rgba(238, 75, 43, 0.65)' : 'rgba(238, 75, 43, 0.35)')),
            downColor: isMitigated ? 'rgba(0,0,0,0)' : (isBull ? (isActive ? 'rgba(102, 255, 0, 0.65)' : 'rgba(102, 255, 0, 0.35)') : (isActive ? 'rgba(238, 75, 43, 0.65)' : 'rgba(238, 75, 43, 0.35)')),
            borderVisible: isMitigated || isActive,
            wickVisible: false,
            lastValueVisible: false,
            priceLineVisible: false,
            borderUpColor: isBull ? 'rgba(102, 255, 0, 0.8)' : 'rgba(238, 75, 43, 0.8)',
            borderDownColor: isBull ? 'rgba(102, 255, 0, 0.8)' : 'rgba(238, 75, 43, 0.8)',
          });
          
          const boxData = formattedData
            .filter(d => d.time >= fvg.time)
            .map(d => ({
              time: d.time,
              open: Number(fvg.high), close: Number(fvg.low),
              high: Number(fvg.high), low: Number(fvg.low),
            }))
            .filter(d => !isNaN(d.open) && !isNaN(d.close));
            
          if (boxData.length > 0) {
            series.setData(boxData);
            window.fvgSeriesPool.push(series);
          } else {
            chart.removeSeries(series);
          }
        };

        // Draw only the "Mentioned" FVGs
        if (nearestBull) drawFVGBox(nearestBull, true, false, true);
        if (nearestBear) drawFVGBox(nearestBear, false, false, true);
        if (recentMitBull[0]) drawFVGBox(recentMitBull[0], true, true, false);
        if (recentMitBear[0]) drawFVGBox(recentMitBear[0], false, true, false);

        // --- Active Trade Price Lines (Ultra-Safe Version) ---
        const activeTrade = logs?.find(l => 
          l.status === 'ACTIVE' && l.symbol === symbol && l.timeframe === interval
        );

        if (activeTrade && candleSeries && formattedData.length > 0) {
          try {
            const entry = Number(activeTrade.entry);
            const tp = Number(activeTrade.tp);
            const sl = Number(activeTrade.sl);
            
            // Get current market price for range check
            const currentPrice = formattedData[formattedData.length - 1].close;
            const priceThreshold = currentPrice * 0.2; // 20% deviation max

            const isPriceRealistic = (p) => {
              return !isNaN(p) && p > 0 && Math.abs(p - currentPrice) < priceThreshold;
            };

            if (isPriceRealistic(entry)) {
              priceLinesRef.current = [];
              const entryLine = candleSeries.createPriceLine({
                price: entry,
                color: 'var(--accent-blue)',
                lineWidth: 2,
                lineStyle: 0,
                axisLabelVisible: true,
                title: 'ENTRY',
              });
              priceLinesRef.current.push(entryLine);

              if (isPriceRealistic(tp)) {
                const tpLine = candleSeries.createPriceLine({
                  price: tp,
                  color: 'var(--buy-green)',
                  lineWidth: 2,
                  lineStyle: 1,
                  axisLabelVisible: true,
                  title: 'TP',
                });
                priceLinesRef.current.push(tpLine);
              }

              if (isPriceRealistic(sl)) {
                const slLine = candleSeries.createPriceLine({
                  price: sl,
                  color: 'var(--sell-red)',
                  lineWidth: 2,
                  lineStyle: 1,
                  axisLabelVisible: true,
                  title: 'SL',
                });
                priceLinesRef.current.push(slLine);
              }
            } else {
              console.warn(`[Chart] Skipping trade lines for ${symbol}: Price ${entry} is too far from market ${currentPrice}`);
            }
          } catch (e) {
            console.error('[Chart] Safe Price Line Error:', e.message);
          }
        }

        // Analysis for Trendline / CRT / Justin
        const trendSignal = analyzeData(analysisData, interval);
        const crtSignal = analyzeCRTData(analysisData, interval);
        
        const activeSignal = (justinSignal.signal === 'BUY' || justinSignal.signal === 'SELL') ? justinSignal :
                             (crtSignal.signal === 'BUY' || crtSignal.signal === 'SELL') ? crtSignal : 
                             (trendSignal.signal === 'BUY' || trendSignal.signal === 'SELL') ? trendSignal : null;

        if (activeSignal && activeSignal.setupTime) {
          // Handle Short vs Long coloring
          if (activeSignal.signal === 'SELL') {
             rewardSeries.applyOptions({ 
               topColor: 'rgba(246, 70, 93, 0.3)', bottomColor: 'rgba(246, 70, 93, 0.05)', lineColor: 'rgba(246, 70, 93, 0.4)' 
             });
             riskSeries.applyOptions({ 
               topColor: 'rgba(14, 203, 129, 0.3)', bottomColor: 'rgba(14, 203, 129, 0.05)', lineColor: 'rgba(14, 203, 129, 0.4)' 
             });
          }

          const startTime = Math.max(activeSignal.setupTime, formattedData[0].time);
          const points = formattedData.filter(d => d.time >= startTime);
          
          if (points.length >= 1) {
            const rewardPoints = points.map(d => ({ time: d.time, value: activeSignal.signal === 'BUY' ? activeSignal.tp : activeSignal.sl }));
            const riskPoints = points.map(d => ({ time: d.time, value: activeSignal.signal === 'BUY' ? activeSignal.sl : activeSignal.tp }));
            
            rewardSeries.setData(rewardPoints);
            riskSeries.setData(riskPoints);
          }

          // Price Lines
          const title = activeSignal === justinSignal ? 'JUSTIN' : activeSignal === crtSignal ? 'CRT' : 'TREND';
          candleSeries.createPriceLine({ price: activeSignal.entry, color: '#3b82f6', lineWidth: 2, title: `${title} ENTRY` });
          candleSeries.createPriceLine({ price: activeSignal.tp, color: '#0ecb81', lineWidth: 1, lineStyle: 2, title: 'TARGET' });
          candleSeries.createPriceLine({ price: activeSignal.sl, color: '#f6465d', lineWidth: 1, lineStyle: 2, title: 'STOP' });
        }

        chart.timeScale().fitContent();
        setLoading(false);
      } catch (err) {
        console.error(err);
        setError(err.message);
        setLoading(false);
      }
    };

    fetchData();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      isMounted = false;
      resizeObserver.disconnect();
      try { chart.remove(); } catch(e) {}
      fvgDimSeriesRef.current = null;
      fvgHighlightSeriesRef.current = null;
    };
  }, [symbol, interval, logs]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
      {loading && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(24, 26, 32, 0.8)', color: '#d1d4dc', fontSize: '0.75rem', zIndex: 10
        }}>
          Analyzing...
        </div>
      )}
      {error && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(24, 26, 32, 0.9)', color: '#f6465d', fontSize: '0.75rem', zIndex: 10,
          textAlign: 'center', padding: '10px'
        }}>
          {error}
        </div>
      )}
    </div>
  );
};

export default memo(TradingViewWidget);

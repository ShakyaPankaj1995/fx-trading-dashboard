import React, { useEffect, useRef, memo, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { analyzeData, analyzeCRTData } from '../utils/strategy';
import { analyzeJustinSetup } from '../utils/justinStrategy';
import { useSignalLogContext } from '../context/SignalLogContext';

// Aggregate 60m candles into 4H candles
function aggregateTo4H(candles) {
  const groups = {};
  candles.forEach(c => {
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
  return {
    timestamp: sorted.map(c => c.time),
    indicators: { quote: [{ open: sorted.map(c => c.open), high: sorted.map(c => c.high), low: sorted.map(c => c.low), close: sorted.map(c => c.close) }] }
  };
}

const TradingViewWidget = ({ symbol, interval }) => {
  const chartContainerRef = useRef();
  const chartRef = useRef();
  const fvgSeriesRef = useRef([]);   // All active FVG box series
  const priceLinesRef = useRef([]);  // Active trade price lines (per-instance)
  const { logs } = useSignalLogContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Precision by asset type
    const isJPY = symbol.includes('JPY');
    const isGoldOrIndex = ['GOLD', 'XAUUSD', 'S&P500', 'NASDAQ', 'SPX', 'NDX'].includes(symbol);
    const chartPrecision = isJPY ? 3 : isGoldOrIndex ? 2 : 5;
    const minMove = isJPY ? 0.001 : isGoldOrIndex ? 0.01 : 0.00001;

    // Create Chart
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
      timeScale: { timeVisible: true, secondsVisible: false },
      localization: { priceFormatter: p => p.toFixed(chartPrecision) },
    });

    // Series: TP/SL shaded zones (drawn FIRST, behind candles)
    const rewardSeries = chart.addAreaSeries({
      topColor: 'rgba(14, 203, 129, 0.3)',
      bottomColor: 'rgba(14, 203, 129, 0.05)',
      lineColor: 'rgba(14, 203, 129, 0.4)',
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, lineWidth: 1,
    });
    const riskSeries = chart.addAreaSeries({
      topColor: 'rgba(246, 70, 93, 0.3)',
      bottomColor: 'rgba(246, 70, 93, 0.05)',
      lineColor: 'rgba(246, 70, 93, 0.4)',
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, lineWidth: 1,
    });

    // Series: Main Candles
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#0ecb81', downColor: '#f6465d',
      borderVisible: false,
      wickUpColor: '#0ecb81', wickDownColor: '#f6465d',
      priceFormat: { type: 'price', precision: chartPrecision, minMove },
    });

    chartRef.current = chart;
    priceLinesRef.current = [];
    fvgSeriesRef.current = [];
    let isMounted = true;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Yahoo Finance ticker & interval mapping
        let yfInterval = '15m', range = '5d';
        switch (interval) {
          case '240': yfInterval = '60m'; range = '1mo'; break;
          case '60':  yfInterval = '60m'; range = '5d';  break;
          case '15':  yfInterval = '15m'; range = '5d';  break;
          case '5':   yfInterval = '5m';  range = '5d';  break;
          default:    yfInterval = '15m'; range = '5d';
        }

        let yfSymbol = `${symbol}=X`;
        if (['SPX', 'S&P500', 'SP500'].includes(symbol)) yfSymbol = 'ES=F';
        else if (['NDX', 'NASDAQ'].includes(symbol))      yfSymbol = 'NQ=F';
        else if (['XAUUSD', 'GOLD'].includes(symbol))     yfSymbol = 'GC=F';

        const res = await fetch(`/api/finance/v8/finance/chart/${yfSymbol}?interval=${yfInterval}&range=${range}`);
        if (!isMounted) return;
        if (!res.ok) throw new Error('Data fetch failed');

        const json = await res.json();
        if (!json?.chart?.result?.[0]) throw new Error('Invalid data from API');
        const data = json.chart.result[0];

        // Build candles — filter out any null/NaN bars
        let formattedData = data.timestamp.map((time, i) => ({
          time,
          open:  data.indicators.quote[0].open[i],
          high:  data.indicators.quote[0].high[i],
          low:   data.indicators.quote[0].low[i],
          close: data.indicators.quote[0].close[i],
        })).filter(d => d.open != null && d.high != null && d.low != null && d.close != null);

        let analysisData = data;
        if (interval === '240') {
          formattedData = aggregateTo4H(formattedData);
          analysisData = aggregateRawTo4H(data);
        }

        if (formattedData.length === 0) throw new Error('No data');
        if (!isMounted) return;

        candleSeries.setData(formattedData);

        // ================================================================
        // FVG RENDERING — v4 Shadow Hack
        // IMPORTANT: cleanup BEFORE creating new series to prevent accumulation
        // ================================================================
        fvgSeriesRef.current.forEach(s => { try { chart.removeSeries(s); } catch (e) {} });
        fvgSeriesRef.current = [];

        const justinSignal = analyzeJustinSetup(analysisData, null, interval);

        const drawFVGBox = (fvg, isBull, isMitigated) => {
          const hi = Number(fvg?.high);
          const lo = Number(fvg?.low);
          if (!fvg || isNaN(hi) || isNaN(lo) || hi <= lo) return;

          // Correct bull/bear colors
          const fillColor = isBull
            ? (isMitigated ? 'rgba(102, 255, 0, 0.08)'  : 'rgba(102, 255, 0, 0.28)')
            : (isMitigated ? 'rgba(238, 75, 43, 0.08)'  : 'rgba(238, 75, 43, 0.28)');
          const borderColor = isBull ? 'rgba(102, 255, 0, 0.6)' : 'rgba(238, 75, 43, 0.6)';

          const fvgSeries = chart.addCandlestickSeries({
            upColor:          fillColor,
            downColor:        fillColor,
            borderVisible:    isMitigated,
            borderUpColor:    borderColor,
            borderDownColor:  borderColor,
            wickVisible:      false,
            lastValueVisible: false,
            priceLineVisible: false,
          });

          const boxData = formattedData
            .filter(d => d.time >= fvg.time)
            .map(d => ({ time: d.time, open: hi, close: lo, high: hi, low: lo }));

          if (boxData.length > 0) {
            fvgSeries.setData(boxData);
            fvgSeriesRef.current.push(fvgSeries);
          } else {
            try { chart.removeSeries(fvgSeries); } catch (e) {}
          }
        };

        // 1 unmitigated bull + 1 unmitigated bear + 1 mitigated bull + 1 mitigated bear
        if (justinSignal.nearestBullFVG)           drawFVGBox(justinSignal.nearestBullFVG,          true,  false);
        if (justinSignal.nearestBearFVG)           drawFVGBox(justinSignal.nearestBearFVG,          false, false);
        if (justinSignal.recentMitigatedBull?.[0]) drawFVGBox(justinSignal.recentMitigatedBull[0],  true,  true);
        if (justinSignal.recentMitigatedBear?.[0]) drawFVGBox(justinSignal.recentMitigatedBear[0],  false, true);

        // ================================================================
        // STRATEGY SIGNAL ZONES (Trendline / CRT / Justin detected signal)
        // ================================================================
        const trendSignal = analyzeData(analysisData, interval);
        const crtSignal   = analyzeCRTData(analysisData, interval);

        const activeSignal =
          (justinSignal.signal === 'BUY' || justinSignal.signal === 'SELL') ? justinSignal :
          (crtSignal.signal   === 'BUY' || crtSignal.signal   === 'SELL') ? crtSignal :
          (trendSignal.signal === 'BUY' || trendSignal.signal === 'SELL') ? trendSignal : null;

        if (activeSignal?.setupTime) {
          const isSell = activeSignal.signal === 'SELL';

          rewardSeries.applyOptions(isSell
            ? { topColor: 'rgba(246, 70, 93, 0.3)',  bottomColor: 'rgba(246, 70, 93, 0.05)',  lineColor: 'rgba(246, 70, 93, 0.4)'  }
            : { topColor: 'rgba(14, 203, 129, 0.3)', bottomColor: 'rgba(14, 203, 129, 0.05)', lineColor: 'rgba(14, 203, 129, 0.4)' }
          );
          riskSeries.applyOptions(isSell
            ? { topColor: 'rgba(14, 203, 129, 0.3)', bottomColor: 'rgba(14, 203, 129, 0.05)', lineColor: 'rgba(14, 203, 129, 0.4)' }
            : { topColor: 'rgba(246, 70, 93, 0.3)',  bottomColor: 'rgba(246, 70, 93, 0.05)',  lineColor: 'rgba(246, 70, 93, 0.4)'  }
          );

          const startTime = Math.max(activeSignal.setupTime, formattedData[0].time);
          const points    = formattedData.filter(d => d.time >= startTime);

          if (points.length >= 1) {
            rewardSeries.setData(points.map(d => ({ time: d.time, value: isSell ? activeSignal.sl : activeSignal.tp })));
            riskSeries.setData(  points.map(d => ({ time: d.time, value: isSell ? activeSignal.tp : activeSignal.sl })));
          }

          // Signal price lines — use hex colors (CSS vars not supported in canvas)
          const sigTitle = activeSignal === justinSignal ? 'JUSTIN' : activeSignal === crtSignal ? 'CRT' : 'TREND';
          candleSeries.createPriceLine({ price: Number(activeSignal.entry), color: '#3b82f6', lineWidth: 2, title: `${sigTitle} ENTRY` });
          candleSeries.createPriceLine({ price: Number(activeSignal.tp),    color: '#0ecb81', lineWidth: 1, lineStyle: 2, title: 'TARGET' });
          candleSeries.createPriceLine({ price: Number(activeSignal.sl),    color: '#f6465d', lineWidth: 1, lineStyle: 2, title: 'STOP'   });
        } else {
          rewardSeries.setData([]);
          riskSeries.setData([]);
        }

        // ================================================================
        // ACTIVE TRADE LINES (from Signal Log)
        // Runs 150ms after chart renders — fully decoupled so it cannot crash the chart
        // ================================================================
        setTimeout(() => {
          if (!isMounted || !candleSeries) return;
          try {
            const activeTrade = logs?.find(l =>
              l.status === 'ACTIVE' && l.symbol === symbol && l.timeframe === interval
            );

            // Always clear previous logged-trade lines first
            priceLinesRef.current.forEach(l => { try { candleSeries.removePriceLine(l); } catch (e) {} });
            priceLinesRef.current = [];

            if (activeTrade && formattedData.length > 0) {
              const currentPrice = formattedData[formattedData.length - 1].close;
              const entry = Number(activeTrade.entry);
              const tp    = Number(activeTrade.tp);
              const sl    = Number(activeTrade.sl);

              // Only draw if within 25% of market price (prevents crashes from stale/mismatched data)
              const limit  = currentPrice * 0.25;
              const isSafe = p => !isNaN(p) && p > 0 && Math.abs(p - currentPrice) < limit;

              if (isSafe(entry)) {
                priceLinesRef.current.push(candleSeries.createPriceLine({
                  price: entry, color: '#3b82f6', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: 'ENTRY'
                }));
                if (isSafe(tp)) {
                  priceLinesRef.current.push(candleSeries.createPriceLine({
                    price: tp, color: '#0ecb81', lineWidth: 2, lineStyle: 1, axisLabelVisible: true, title: 'TP'
                  }));
                }
                if (isSafe(sl)) {
                  priceLinesRef.current.push(candleSeries.createPriceLine({
                    price: sl, color: '#f6465d', lineWidth: 2, lineStyle: 1, axisLabelVisible: true, title: 'SL'
                  }));
                }
              }
            }
          } catch (err) {
            console.error('[Chart] Trade line error:', err.message);
          }
        }, 150);

        // Default view: show last 30 candles (zoomed in)
        if (formattedData.length > 0) {
          const lastIndex = formattedData.length - 1;
          const firstIndex = Math.max(0, lastIndex - 29);
          chart.timeScale().setVisibleRange({
            from: formattedData[firstIndex].time,
            to: formattedData[lastIndex].time,
          });
        }

        setLoading(false);
      } catch (err) {
        if (isMounted) {
          console.error('[Chart]', err);
          setError(err.message);
          setLoading(false);
        }
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
      fvgSeriesRef.current = [];
      priceLinesRef.current = [];
      try { chart.remove(); } catch (e) {}
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

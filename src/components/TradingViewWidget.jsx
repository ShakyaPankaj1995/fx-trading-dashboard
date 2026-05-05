import React, { useEffect, useRef, memo, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { analyzeData, analyzeCRTData } from '../utils/strategy';

const TradingViewWidget = ({ symbol, interval }) => {
  const chartContainerRef = useRef();
  const chartRef = useRef();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

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
        precision: 5,
        minMove: 0.00001,
      },
    });

    chartRef.current = chart;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        let yfInterval = '15m';
        let range = '5d';
        switch(interval) {
          case '240': yfInterval = '60m'; range = '1mo'; break;
          case '60':  yfInterval = '60m'; range = '1mo'; break;
          case '15':  yfInterval = '15m'; range = '5d';  break;
          case '5':   yfInterval = '5m';  range = '5d';  break;
          default:    yfInterval = '15m'; range = '5d';
        }

        let yfSymbol = `${symbol}=X`;
        if (symbol === 'SPX' || symbol === 'S&P500' || symbol === 'SP500') yfSymbol = 'ES=F';
        else if (symbol === 'NDX' || symbol === 'NASDAQ') yfSymbol = 'NQ=F';
        else if (symbol === 'XAUUSD' || symbol === 'GOLD') yfSymbol = 'GC=F';

        const res = await fetch(`/api/finance/v8/finance/chart/${yfSymbol}?interval=${yfInterval}&range=${range}`);
        if (!res.ok) throw new Error('Data fetch failed');
        const json = await res.json();
        const data = json.chart.result[0];

        const formattedData = data.timestamp.map((time, i) => ({
          time: time,
          open: data.indicators.quote[0].open[i],
          high: data.indicators.quote[0].high[i],
          low: data.indicators.quote[0].low[i],
          close: data.indicators.quote[0].close[i],
        })).filter(d => d.open != null && d.high != null && d.low != null && d.close != null);

        if (formattedData.length === 0) throw new Error('No data');

        candleSeries.setData(formattedData);

        // Analysis
        const trendSignal = analyzeData(data, interval);
        const crtSignal = analyzeCRTData(data, interval);
        const activeSignal = (crtSignal.signal === 'BUY' || crtSignal.signal === 'SELL') ? crtSignal : 
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

          // Generate data for boxes - ensure we have at least 2 points
          const startTime = Math.max(activeSignal.setupTime, formattedData[0].time);
          const points = formattedData.filter(d => d.time >= startTime);
          
          if (points.length >= 1) {
            const rewardPoints = points.map(d => ({ time: d.time, value: activeSignal.signal === 'BUY' ? activeSignal.tp : activeSignal.sl }));
            const riskPoints = points.map(d => ({ time: d.time, value: activeSignal.signal === 'BUY' ? activeSignal.sl : activeSignal.tp }));
            
            rewardSeries.setData(rewardPoints);
            riskSeries.setData(riskPoints);
          }

          // Price Lines
          candleSeries.createPriceLine({ price: activeSignal.entry, color: '#3b82f6', lineWidth: 2, title: 'ENTRY' });
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
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [symbol, interval]);

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

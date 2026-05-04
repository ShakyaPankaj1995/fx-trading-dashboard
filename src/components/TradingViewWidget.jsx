import React, { useEffect, useRef, memo, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { analyzeData, analyzeCRTData } from '../utils/strategy';

const TradingViewWidget = ({ symbol, interval }) => {
  const chartContainerRef = useRef();
  const chartRef = useRef();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chartContainerRef.current) return;

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
        // ... (rest of the logic remains similar)
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
        if (!res.ok) throw new Error('Failed to fetch price data');
        const json = await res.json();
        
        if (!json.chart || !json.chart.result || !json.chart.result[0]) {
           throw new Error('Invalid data format');
        }
        const data = json.chart.result[0];

        // Format for Lightweight Charts
        const formattedData = data.timestamp.map((time, i) => ({
          time: time,
          open: data.indicators.quote[0].open[i],
          high: data.indicators.quote[0].high[i],
          low: data.indicators.quote[0].low[i],
          close: data.indicators.quote[0].close[i],
        })).filter(d => d.open != null && d.high != null && d.low != null && d.close != null);

        if (formattedData.length === 0) throw new Error('No candle data available');

        candleSeries.setData(formattedData);

        // Run strategies
        const trendSignal = analyzeData(data, interval);
        const crtSignal = analyzeCRTData(data, interval);

        const drawSetup = (signal) => {
          if (signal.signal === 'BUY' || signal.signal === 'SELL') {
            candleSeries.createPriceLine({
              price: signal.entry,
              color: '#3b82f6',
              lineWidth: 2,
              title: 'ENTRY',
              axisLabelVisible: true,
            });
            candleSeries.createPriceLine({
              price: signal.tp,
              color: '#0ecb81',
              lineWidth: 2,
              lineStyle: 2,
              title: 'TARGET',
              axisLabelVisible: true,
            });
            candleSeries.createPriceLine({
              price: signal.sl,
              color: '#f6465d',
              lineWidth: 2,
              lineStyle: 2,
              title: 'STOP',
              axisLabelVisible: true,
            });
          }
        };

        if (crtSignal.signal === 'BUY' || crtSignal.signal === 'SELL') drawSetup(crtSignal);
        else if (trendSignal.signal === 'BUY' || trendSignal.signal === 'SELL') drawSetup(trendSignal);

        chart.timeScale().fitContent();
        setLoading(false);
      } catch (err) {
        console.error('Chart fetch error:', err);
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

  const [error, setError] = useState(null);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
      {loading && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(24, 26, 32, 0.8)', color: '#d1d4dc', fontSize: '0.8rem', zIndex: 10
        }}>
          Analyzing {symbol} {interval}m...
        </div>
      )}
      {error && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(24, 26, 32, 0.9)', color: '#f6465d', fontSize: '0.8rem', zIndex: 10,
          textAlign: 'center', padding: '20px'
        }}>
          {error}<br/>Retrying shortly...
        </div>
      )}
    </div>
  );
};

export default memo(TradingViewWidget);

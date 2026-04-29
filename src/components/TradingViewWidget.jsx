import React, { useEffect, useRef, memo } from 'react';

function TradingViewWidget({ symbol, interval }) {
  const container = useRef();

  useEffect(() => {
    // Clean up container
    container.current.innerHTML = "";
    
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    let tvSymbol = symbol;
    if (symbol === 'S&P500' || symbol === 'SP500') tvSymbol = 'OANDA:SPX500USD';
    if (symbol === 'NASDAQ') tvSymbol = 'OANDA:NAS100USD';
    if (symbol === 'XAUUSD' || symbol === 'GOLD') tvSymbol = 'OANDA:XAUUSD';
    
    script.innerHTML = `
      {
        "autosize": true,
        "symbol": "${tvSymbol}",
        "interval": "${interval}",
        "timezone": "Etc/UTC",
        "theme": "dark",
        "style": "1",
        "locale": "en",
        "enable_publishing": false,
        "backgroundColor": "rgba(24, 26, 32, 1)",
        "gridColor": "rgba(43, 49, 57, 0.5)",
        "hide_top_toolbar": false,
        "hide_legend": false,
        "save_image": false,
        "container_id": "tradingview_${interval}_${symbol}",
        "support_host": "https://www.tradingview.com"
      }`;
      
    container.current.appendChild(script);
  }, [symbol, interval]);

  return (
    <div className="tradingview-widget-container" ref={container} style={{ height: "100%", width: "100%" }}>
      <div className="tradingview-widget-container__widget" style={{ height: "calc(100% - 32px)", width: "100%" }}></div>
    </div>
  );
}

export default memo(TradingViewWidget);

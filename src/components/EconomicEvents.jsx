import React, { useState, useEffect } from 'react';
import { Calendar, AlertTriangle, TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';

const EconomicEvents = ({ symbol }) => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEvents = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/events?symbol=${symbol}`);
        const data = await res.json();
        setEvents(data);
      } catch (error) {
        console.error('Failed to fetch events');
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, [symbol]);

  if (loading) {
    return (
      <div className="strategy-card loading-card">
        <div className="card-header">
          <Calendar size={20} className="header-icon" />
          <h2>High Impact Events</h2>
        </div>
        <div className="loading-state">Analyzing calendar...</div>
      </div>
    );
  }

  const relevantEvents = events.filter(e => e.prediction !== null);

  return (
    <div className="strategy-card events-card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Calendar size={20} className="header-icon events-icon" />
          <div>
            <h2>Upcoming High Impact</h2>
            <p className="card-subtitle">Economic events impacting {symbol}</p>
          </div>
        </div>
      </div>

      <div className="events-list">
        {relevantEvents.length === 0 ? (
          <div className="empty-events">
            <Info size={32} color="var(--text-secondary)" />
            <p>No high-impact events for {symbol} this week.</p>
          </div>
        ) : (
          relevantEvents.map((event, idx) => (
            <div key={idx} className={`event-item ${event.prediction?.direction?.toLowerCase()}`}>
              <div className="event-main">
                <div className="event-info">
                  <span className="event-country">{event.country}</span>
                  <span className="event-title">{event.title}</span>
                  <div className="event-meta">
                    <span className="event-date">{new Date(event.date).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    <span className={`event-impact ${event.impact.toLowerCase()}`}>{event.impact.toUpperCase()} IMPACT</span>
                  </div>
                </div>
                
                <div className="event-prediction">
                  <div className="prediction-box">
                    <span className="prediction-label">Prediction</span>
                    <div className={`prediction-badge ${event.prediction?.direction?.toLowerCase()}`}>
                      {event.prediction?.direction === 'UP' && <TrendingUp size={14} />}
                      {event.prediction?.direction === 'DOWN' && <TrendingDown size={14} />}
                      {event.prediction?.direction === 'NEUTRAL' && <Minus size={14} />}
                      <span>{event.prediction?.direction}</span>
                    </div>
                  </div>
                  <div className="forecast-box">
                    <span className="prediction-label">Forecast</span>
                    <span className="forecast-value">{event.forecast || 'N/A'}</span>
                  </div>
                </div>
              </div>
              <div className="event-reason">
                {event.prediction?.reason || 'Awaiting consensus data'}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default EconomicEvents;

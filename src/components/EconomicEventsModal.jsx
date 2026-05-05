import React, { useState, useEffect } from 'react';
import { Calendar, X, TrendingUp, TrendingDown, Minus, Info, Clock, Globe } from 'lucide-react';

const EconomicEventsModal = ({ symbol, onClose }) => {
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

  const relevantEvents = events.filter(e => e.prediction !== null);

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div className="modal-content log-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '800px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Calendar size={24} color="var(--accent-blue)" />
            <div>
              <h2 style={{ margin: 0 }}>Economic Calendar</h2>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                High & Medium Impact Events for {symbol}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto', padding: '20px' }}>
          {loading ? (
            <div className="loading-state" style={{ padding: '40px', textAlign: 'center' }}>
              Analyzing global macro events...
            </div>
          ) : relevantEvents.length === 0 ? (
            <div className="empty-events" style={{ padding: '40px', textAlign: 'center' }}>
              <Info size={48} color="var(--text-secondary)" style={{ marginBottom: '16px' }} />
              <p>No high-impact events identified for {symbol} this week.</p>
            </div>
          ) : (
            <div className="events-grid" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {relevantEvents.map((event, idx) => (
                <div key={idx} className={`event-item ${event.prediction?.direction?.toLowerCase()}`} style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  padding: '16px',
                  transition: 'all 0.2s ease'
                }}>
                  <div className="event-main" style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
                    <div className="event-info" style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <Globe size={14} color="var(--text-secondary)" />
                        <span style={{ fontWeight: 700, color: 'var(--accent-blue)', fontSize: '0.9rem' }}>{event.country}</span>
                        <span style={{ 
                          fontSize: '0.65rem', 
                          padding: '2px 6px', 
                          borderRadius: '4px', 
                          background: event.impact === 'High' ? 'rgba(246, 70, 93, 0.2)' : 'rgba(251, 191, 36, 0.2)',
                          color: event.impact === 'High' ? '#f6465d' : '#fbbf24'
                        }}>
                          {event.impact.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '8px' }}>{event.title}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={12} />
                          {new Date(event.date).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                    
                    <div className="event-prediction" style={{ display: 'flex', gap: '12px' }}>
                      <div className="prediction-box" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>BIAS</div>
                        <div className={`prediction-badge ${event.prediction?.direction?.toLowerCase()}`} style={{
                          display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '8px',
                          background: event.prediction?.direction === 'UP' ? 'rgba(14, 203, 129, 0.15)' : event.prediction?.direction === 'DOWN' ? 'rgba(246, 70, 93, 0.15)' : 'rgba(255,255,255,0.05)',
                          color: event.prediction?.direction === 'UP' ? '#0ecb81' : event.prediction?.direction === 'DOWN' ? '#f6465d' : 'var(--text-secondary)',
                          fontWeight: 700, fontSize: '0.85rem'
                        }}>
                          {event.prediction?.direction === 'UP' && <TrendingUp size={14} />}
                          {event.prediction?.direction === 'DOWN' && <TrendingDown size={14} />}
                          {event.prediction?.direction === 'NEUTRAL' && <Minus size={14} />}
                          {event.prediction?.direction}
                        </div>
                      </div>
                      <div className="forecast-box" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>FORECAST</div>
                        <div style={{ fontWeight: 600, fontSize: '1rem' }}>{event.forecast || 'N/A'}</div>
                      </div>
                    </div>
                  </div>
                  <div className="event-reason" style={{ 
                    marginTop: '12px', 
                    paddingTop: '12px', 
                    borderTop: '1px dashed var(--border-color)',
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    lineHeight: '1.4'
                  }}>
                    <strong>Analysis:</strong> {event.prediction?.reason || 'Market impact depends on deviation from consensus.'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="modal-footer" style={{ borderTop: '1px solid var(--border-color)', padding: '15px 20px', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={onClose}>Close Calendar</button>
        </div>
      </div>
    </div>
  );
};

export default EconomicEventsModal;

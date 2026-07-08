import React, { useState, useEffect, useRef } from 'react';

/**
 * BioChewTelemetryDashboard
 * Refactored React Component for Real-Time Multi-Modal IoT Telemetry.
 * Fits into a modern dark slate (#1a1f2c) theme dashboard design system.
 */
export default function BioChewTelemetryDashboard({ wsUrl = 'ws://192.168.1.15/' }) {
  // 1. COMPONENT STATES & DATA PARSING
  const [isConnected, setIsConnected] = useState(false);
  const [chewCount, setChewCount] = useState(0);
  const [systemState, setSystemState] = useState(0); // 0: IDLE, 1: CHEWING, 2: SWALLOW_CHECK, 3: ALERT_TRIGGER
  
  // Multi-Modal Sensor States
  const [force, setForce] = useState(0.0);
  const [angle, setAngle] = useState(0.0);
  const [sound, setSound] = useState(0.0);

  // 1. NEW STATE HOOKS (PRECISE SPECS)
  const [dietType, setDietType] = useState("IDLE / NO INTAKE");
  const [dietColor, setDietColor] = useState("#64748b"); // Slate Grey

  // Websocket reference for lifecycle management
  const ws = useRef(null);
  
  // Custom beep trigger (using browser Web Audio API)
  const triggerDashboardBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = 'sawtooth';
      osc.frequency.value = 380; // 380Hz warning tone
      
      gain.gain.setValueAtTime(0.65, audioCtx.currentTime); // 65% volume
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.0); // 1-second decay
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start();
      osc.stop(audioCtx.currentTime + 1.0);
    } catch (e) {
      console.error("Dashboard synthesizer beep failed:", e);
    }
  };

  useEffect(() => {
    console.log(`[IoT Dashboard] Connecting to WebSocket at ${wsUrl}`);
    
    // Connect WebSocket
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      setIsConnected(true);
      console.log('[IoT Dashboard] WebSocket Connected.');
    };

    ws.current.onmessage = (event) => {
      try {
        // Parse incoming down-sampled JSON packet
        const data = JSON.parse(event.data);
        
        // Update existing state hooks (completely intact)
        setChewCount(data.chews);
        setSystemState(data.state);
        setForce(data.force);
        setAngle(data.angle);
        setSound(data.sound);

        // 2. WEBSOCKET LISTENER & CLASSIFIER INJECTION (PRECISE SPECS)
        if (data.state === 0) {
          setDietType("IDLE / NO INTAKE");
          setDietColor("#64748b"); // Neutral Grey (Slate Grey)
        } else if (data.state === 1 || data.state === 2) {
          if (data.force > 12000 || data.sound > 15000) {
            setDietType("DIET DETECTED: SOLID FOOD 🍏");
            setDietColor("#28a745"); // Vibrant Green
          } else if (data.force < 5000 && data.sound < 6000) {
            setDietType("DIET DETECTED: LIQUID / SIP 🥤");
            setDietColor("#17a2b8"); // Info Cyan
          } else {
            setDietType("DIET DETECTED: SEMI-LIQUID / SOFT FOOD 🥣");
            setDietColor("#ffc107"); // Warning Yellow
          }
        } else if (data.state === 3) {
          setDietType("🚨 COMPLIANCE DEFICIT: SWALLOWED PREMATURELY!");
          setDietColor("#dc3545"); // Alert Red
          triggerDashboardBeep(); // Call the existing audio beep alert function
        }

      } catch (parseError) {
        console.error('[IoT Dashboard] JSON parsing/processing error:', parseError);
      }
    };

    ws.current.onerror = (error) => {
      console.error('[IoT Dashboard] WebSocket error:', error);
    };

    ws.current.onclose = () => {
      setIsConnected(false);
      console.log('[IoT Dashboard] WebSocket closed.');
    };

    // Cleanup connection on unmount
    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [wsUrl]);

  // Normalize 16-bit raw ADC values to percentages (0 - 65535)
  const forcePercent = Math.min(Math.max((force / 65535) * 100, 0), 100);
  const anglePercent = Math.min(Math.max((angle / 65535) * 100, 0), 100);

  // Helper to map state number to text labels
  const getStateLabel = (state) => {
    switch (state) {
      case 0: return 'IDLE (State 0)';
      case 1: return 'CHEWING (State 1)';
      case 2: return 'SWALLOW CHECK (State 2)';
      case 3: return 'ALERT ACTIVE (State 3)';
      default: return `UNKNOWN (${state})`;
    }
  };

  return (
    <div style={styles.container}>
      {/* A. Top Header Bar */}
      <div style={styles.connectionHeader}>
        <div style={styles.connectionGroup}>
          <span style={{
            ...styles.connectionDot,
            backgroundColor: isConnected ? '#28a745' : '#dc3545'
          }}></span>
          <span style={styles.connectionText}>
            {isConnected ? `Connected to ${wsUrl}` : `Disconnected (${wsUrl})`}
          </span>
        </div>
        <div style={styles.chewCounterBadge}>
          Chews: <strong style={{ color: '#00f0ff' }}>{chewCount}</strong>
        </div>
      </div>

      {/* 3. NEW DIET CHARACTERIZATION CARD (WITH GLOW AND GLOW BORDER ACCENT) */}
      <div style={{
        ...styles.dietCard,
        borderLeft: `8px solid ${dietColor}` // Dynamic 8px left border
      }}>
        <div style={styles.cardHeaderArea}>
          <span style={styles.cardLabel}>CURRENT DIET CHARACTERIZATION</span>
          <span style={{ ...styles.fsmStateBadge, borderColor: dietColor, color: dietColor }}>
            {getStateLabel(systemState)}
          </span>
        </div>
        <h2 style={{ 
          ...styles.dietTypeTitle, 
          color: '#ffffff', // High contrast typography
          textShadow: `0 0 10px ${dietColor}33` // Subtle text-shadow glow
        }}>
          {dietType}
        </h2>
        <div style={styles.sensorStatusIndicator}>
          <span style={styles.sensorBubble}>Force: {Math.round(force)}</span>
          <span style={styles.sensorBubble}>Acoustic: {Math.round(sound)}</span>
        </div>
      </div>

      {/* B. Main Waveform Plot & Metrics Visual Container */}
      <div style={styles.waveformPlaceholderCard}>
        <div style={styles.metricHeader}>
          <span style={styles.metricTitle}>Real-Time Waveform & Multimodal Sensor Streams</span>
          <span style={styles.liveIndicator}>● LIVE STREAM</span>
        </div>
        
        {/* Metric Progress Visualizers */}
        <div style={styles.metricsContainer}>
          {/* Bite Force Intensity */}
          <div style={styles.subMetric}>
            <div style={styles.metricTitleRow}>
              <span>Bite Force Intensity (FSR)</span>
              <span style={styles.monoValue}>{Math.round(force).toLocaleString()} ADC</span>
            </div>
            <div style={styles.progressBarBg}>
              <div style={{
                ...styles.progressBarFill,
                width: `${forcePercent}%`,
                backgroundColor: '#00f0ff',
                boxShadow: '0 0 8px rgba(0, 240, 255, 0.4)'
              }}></div>
            </div>
          </div>

          {/* Jaw Opening Angle */}
          <div style={styles.subMetric}>
            <div style={styles.metricTitleRow}>
              <span>Jaw Opening Angle (Flex)</span>
              <span style={styles.monoValue}>{Math.round(angle).toLocaleString()} ADC</span>
            </div>
            <div style={styles.progressBarBg}>
              <div style={{
                ...styles.progressBarFill,
                width: `${anglePercent}%`,
                backgroundColor: '#ff9f43',
                boxShadow: '0 0 8px rgba(255, 159, 67, 0.4)'
              }}></div>
            </div>
          </div>
        </div>

        {/* Acoustic Visualizer Indicator */}
        <div style={styles.acousticStrip}>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Acoustic Activity:</span>
          <span style={{
            fontSize: '0.8rem',
            fontFamily: 'monospace',
            color: sound > 15000 ? '#28a745' : '#64748b',
            fontWeight: 'bold'
          }}>
            {sound > 15000 ? '🔊 HIGH VIBRATION' : '🔈 NORMAL NOISE'} ({Math.round(sound)} ADC)
          </span>
        </div>
      </div>
    </div>
  );
}

// Inline CSS Styles for absolute portability and modern visual aesthetics (Premium Dark Slate Theme)
const styles = {
  container: {
    fontFamily: "'Inter', system-ui, sans-serif",
    backgroundColor: '#0a0d14',
    color: '#f8fafc',
    padding: '1.5rem',
    borderRadius: '16px',
    boxShadow: '0 12px 40px 0 rgba(0, 0, 0, 0.5)',
    border: '1px solid #1e293b',
    maxWidth: '850px',
    margin: '0 auto',
  },
  connectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.25rem',
  },
  connectionGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  connectionDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  connectionText: {
    fontSize: '0.8rem',
    color: '#94a3b8',
    fontWeight: '500',
  },
  chewCounterBadge: {
    fontSize: '0.85rem',
    fontWeight: '600',
    backgroundColor: '#1a1f2c',
    padding: '0.3rem 0.75rem',
    borderRadius: '20px',
    border: '1px solid #2e3748',
  },
  
  // 3. DIET CARD CUSTOM SPEC STYLES
  dietCard: {
    backgroundColor: '#1a1f2c', // Dynamic Card Background (Slate Dark)
    padding: '20px',             // Spec Padding
    borderRadius: '12px',       // Spec Border-radius
    border: '1px solid #2e3748', // Spec Border
    marginBottom: '1.5rem',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  cardHeaderArea: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem',
  },
  cardLabel: {
    fontSize: '0.72rem',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    fontWeight: '700',
  },
  dietTypeTitle: {
    fontSize: '1.45rem',
    fontWeight: '800',
    margin: '0.5rem 0',
    letterSpacing: '-0.02em',
  },
  fsmStateBadge: {
    fontSize: '0.75rem',
    fontWeight: '700',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    padding: '0.2rem 0.5rem',
    borderRadius: '6px',
    border: '1px solid',
  },
  sensorStatusIndicator: {
    display: 'flex',
    gap: '0.5rem',
    marginTop: '0.5rem',
  },
  sensorBubble: {
    fontSize: '0.72rem',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: '0.15rem 0.4rem',
    borderRadius: '4px',
    color: '#94a3b8',
    fontFamily: 'monospace',
  },

  // Main Waveform Container (Matches right panel)
  waveformPlaceholderCard: {
    backgroundColor: '#1a1f2c',
    borderRadius: '12px',
    border: '1px solid #2e3748',
    padding: '20px',
  },
  metricHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.25rem',
  },
  metricTitle: {
    fontSize: '0.85rem',
    fontWeight: '600',
    color: '#94a3b8',
  },
  liveIndicator: {
    fontSize: '0.75rem',
    color: '#e2e8f0',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    padding: '0.15rem 0.45rem',
    borderRadius: '4px',
    fontWeight: 'bold',
  },
  metricsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  subMetric: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
  },
  metricTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.8rem',
    fontWeight: '500',
    color: '#cbd5e1',
  },
  monoValue: {
    fontFamily: 'monospace',
    fontWeight: '700',
    color: '#f8fafc',
  },
  progressBarBg: {
    width: '100%',
    height: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 0.1s linear',
  },
  acousticStrip: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '1.25rem',
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    padding: '0.5rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.03)',
  }
};

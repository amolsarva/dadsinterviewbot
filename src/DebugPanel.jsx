import React, { useEffect, useRef, useState } from 'react';

let _debugLog = [];
let _listeners = [];

function addDebug(message, type = 'log') {
  _debugLog.push({ message, type, time: new Date() });
  if (_debugLog.length > 200) _debugLog = _debugLog.slice(-200);
  _listeners.forEach(fn => fn(_debugLog));
}

export function patchConsole() {
  if (typeof window === 'undefined') return;
  if (window.__console_patched) return;
  window.__console_patched = true;
  ['log', 'error', 'warn', 'info'].forEach(key => {
    const orig = console[key];
    if (!orig) return;
    console[key] = function (...args) {
      try {
        addDebug(args.map(a => {
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch { return String(a); }
        }).join(' '), key);
      } catch (e) {
        // ignore
      }
      orig.apply(console, args);
    };
  });
}

export function debugSubscribe(fn) {
  _listeners.push(fn);
  fn(_debugLog);
  return () => {
    _listeners = _listeners.filter(f => f !== fn);
  };
}

export default function DebugPanel() {
  const [logs, setLogs] = useState(_debugLog);
  const [open, setOpen] = useState(false);
  const panelRef = useRef();
  useEffect(() => {
    patchConsole();
    return debugSubscribe(setLogs);
  }, []);
  // Scroll to bottom when new logs arrive
  useEffect(() => {
    if (open && panelRef.current) {
      panelRef.current.scrollTop = panelRef.current.scrollHeight;
    }
  }, [logs, open]);
  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      zIndex: 1001,
      background: 'rgba(255,255,255,0.97)',
      border: '1px solid #ccc',
      borderRadius: 8,
      boxShadow: '0 2px 8px #0002',
      fontSize: 13,
      color: '#333',
      width: open ? 380 : 110,
      height: open ? 280 : 36,
      transition: 'all 0.1s',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          cursor: 'pointer',
          background: '#222',
          color: '#fff',
          padding: '4px 12px',
          fontWeight: 600,
          borderBottom: open ? '1px solid #ccc' : 'none',
          userSelect: 'none'
        }}
      >
        {open ? 'Debug Logs (click to close)' : 'Debug Logs'}
      </div>
      {open && (
        <div
          ref={panelRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 8,
            background: '#fafaff',
            fontFamily: 'monospace'
          }}
        >
          {logs.length === 0 && <div style={{ color: '#aaa' }}>(no logs)</div>}
          {logs.map((l, i) => (
            <div key={i} style={{
              color: l.type === 'error' ? '#c00' : l.type === 'warn' ? '#c60' : '#222',
              marginBottom: 2
            }}>
              <span style={{ opacity: 0.6, fontSize: 11, marginRight: 6 }}>
                {new Date(l.time).toLocaleTimeString()}
              </span>
              <span>{l.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
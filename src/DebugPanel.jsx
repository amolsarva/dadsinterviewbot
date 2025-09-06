import React, { useEffect, useState } from 'react';

const DebugPanel = () => {
    const [logs, setLogs] = useState([]);

    useEffect(() => {
        const originalConsoleLog = console.log;
        const originalConsoleError = console.error;

        console.log = (...args) => {
            setLogs((prevLogs) => [...prevLogs, { type: 'log', message: args.join(' ') }]);
            originalConsoleLog(...args);
        };

        console.error = (...args) => {
            setLogs((prevLogs) => [...prevLogs, { type: 'error', message: args.join(' ') }]);
            originalConsoleError(...args);
        };

        return () => {
            console.log = originalConsoleLog;
            console.error = originalConsoleError;
        };
    }, []);

    return (
        <div style={{ position: 'fixed', bottom: 20, right: 20, background: 'rgba(255, 255, 255, 0.9)', border: '1px solid #ccc', padding: '10px', borderRadius: '5px' }}>
            <h4>Debug Logs</h4>
            <div style={{ maxHeight: '200px', overflowY: 'scroll' }}>
                {logs.map((log, index) => (
                    <div key={index} style={{ color: log.type === 'error' ? 'red' : 'black' }}>
                        {log.message}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default DebugPanel;
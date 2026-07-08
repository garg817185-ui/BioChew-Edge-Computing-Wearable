/**
 * BioChew Web Dashboard Controller
 * Implements Web Serial (USB), Web Bluetooth (BLE), Canvas Plotting (Chart.js),
 * Calibration control, Session CSV exports, and full offline biological chew simulation.
 */

// --- 1. BLE & SERVICE UUIDS ---
const BLE_UUIDS = {
    service: "4fafc201-1fb5-459e-8fcc-c5c9c331914b",
    telemetry: "beb5483e-36e1-4688-b7f5-ea07361b26a8",
    sensor: "cba1d00f-1234-5678-9abc-def012345678",
    config: "362831c0-0f2c-47bc-ad3e-7c3c545b743a",
    control: "9b1deb4d-3b14-4ad5-a6b4-d6abba69159f"
};

// ========================================================
// B. Web Wi-Fi Connection (Pico W WebSocket Stream)
// ========================================================
let socketClient = null;
let isWifiConnected = false;
let shouldAutoReconnect = false;
let reconnectTimeoutId = null;
let wifiTargetIp = "";

// ==========================================

// --- 2. APPLICATION STATE ---
let appState = {
    connectionMode: 'none', // 'none', 'serial', 'ble'
    sessionState: 'IDLE',   // 'IDLE', 'ACTIVE', 'PAUSED'
    chewCount: 0,
    chewRateCPM: 0.0,
    sessionDuration: 0.0,
    calibration: {
        threshold: 0.4,     // rad/s (Lowered default to match new IMU sensitivity)
        debounce: 500       // ms
    },
    fsrBaseline: 800,
    fsrMax: 7000,
    // Simulation / Sandbox fields
    demoModeActive: false,
    demoIntervalId: null,
    demoChewActive: false,
    demoAutoChewId: null,
    simTime: 0,
    // Native Hardware Interface references
    serial: {
        port: null,
        reader: null,
        writer: null,
        inputBuffer: ''
    },
    ble: {
        device: null,
        server: null,
        service: null,
        telemetryChar: null,
        sensorChar: null,
        configChar: null,
        controlChar: null,
        inputBuffer: ''
    },
    // Telemetry logs for exporting
    logs: [], // elements: { timestamp, rawX, rawY, rawZ, gyroMag, chewCount, cpm, sessionDuration }
    // Biofeedback tracking state
    biofeedback: {
        currentBiteChews: 0,
        lastChewTime: Date.now(),
        perfectBiteTriggered: false,
        warningAlarmIntervalId: null,
        isWarningAlarmActive: false
    }
};

function isSessionActive() {
    return ['ACTIVE', 'CHEWING', 'SWALLOW_CHECK', 'ALERT_TRIGGER'].includes(appState.sessionState);
}

// --- 3. CHART SETUP ---
let telemetryChart = null;
const CHART_WINDOW_SIZE = 100;
let chartLabels = Array(CHART_WINDOW_SIZE).fill('');
let chartForceData = Array(CHART_WINDOW_SIZE).fill(0.0);
let chartAngleData = Array(CHART_WINDOW_SIZE).fill(0.0);
let chartSoundData = Array(CHART_WINDOW_SIZE).fill(0.0);
let chartGyroData = Array(CHART_WINDOW_SIZE).fill(0.0); // For IMU Gyro magnitude

// --- 4. DOM ELEMENTS ---
const elements = {
    // Connection Buttons
    btnConnectUsb: document.getElementById('btn-connect-usb'),
    btnConnectBle: document.getElementById('btn-connect-ble'),
    btnDisconnect: document.getElementById('btn-disconnect'),
    connectionStatus: document.getElementById('connection-status'),
    
    // Core Dashboard Statistics
    valChews: document.getElementById('val-chews'),
    valCpm: document.getElementById('val-cpm'),
    valTime: document.getElementById('val-time'),
    rateStatus: document.getElementById('rate-status'),
    sessionBadge: document.getElementById('session-badge'),
    chewCircle: document.getElementById('chew-circle'),
    pulseRing: document.getElementById('pulse-ring'),
    chewIndicatorText: document.getElementById('chew-indicator-text'),
    
    // Control Buttons
    btnStart: document.getElementById('btn-start'),
    btnPause: document.getElementById('btn-pause'),
    btnReset: document.getElementById('btn-reset'),
    btnExport: document.getElementById('btn-export'),
    
    // Sliders
    inputThresh: document.getElementById('input-thresh'),
    inputDebounce: document.getElementById('input-debounce'),
    valThreshSlider: document.getElementById('val-thresh-slider'),
    valDebounceSlider: document.getElementById('val-debounce-slider'),
    btnApplyCal: document.getElementById('btn-apply-cal'),
    
    // Sandbox Elements
    demoModeToggle: document.getElementById('demo-mode-toggle'),
    demoButtons: document.getElementById('demo-buttons'),
    btnSimChew: document.getElementById('btn-sim-chew'),
    btnSimContinuous: document.getElementById('btn-sim-continuous'),
    
    // Console log
    consoleLogs: document.getElementById('console-logs'),
    btnClearConsole: document.getElementById('btn-clear-console')
};

// --- 5. INITIALIZATION & SETUP ---
document.addEventListener('DOMContentLoaded', () => {
    initChart();
    setupEventListeners();
    updateUIStates();
    startBiofeedbackMonitor();
});

// Initialize Beautiful Gradient Chart using Chart.js
function initChart() {
    const ctx = document.getElementById('telemetryChart').getContext('2d');
    
    telemetryChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [
                {
                    label: 'Bite Force (FSR)',
                    data: chartForceData,
                    borderColor: '#00f0ff',
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.35
                },
                {
                    label: 'Mandibular Angle (Flex)',
                    data: chartAngleData,
                    borderColor: '#ff9f43',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.35
                },
                {
                    label: 'Head/Jaw Rotation (IMU x10k)',
                    data: chartGyroData,
                    borderColor: '#a55eea',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.35
                },
                {
                    label: 'Acoustic Vibrations (Mic)',
                    data: chartSoundData,
                    borderColor: '#1dd1a1',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.35
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#9aa8b8',
                        font: { family: 'Inter', size: 11 }
                    }
                }
            },
            scales: {
                x: { display: false },
                y: {
                    min: 0,
                    max: 65535,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#64748b',
                        font: { family: 'JetBrains Mono', size: 10 }
                    }
                }
            },
            animation: { duration: 0 } // Disabled for ultra high-speed rendering
        }
    });
}

function logToConsole(message, type = 'system') {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('span');
    line.className = `log-line ${type}`;
    line.innerHTML = `[${time}] ${message}`;
    elements.consoleLogs.appendChild(line);
    elements.consoleLogs.scrollTop = elements.consoleLogs.scrollHeight;
}

// --- 6. EVENT BINDINGS ---
function setupEventListeners() {
    // Hardware Connections
    elements.btnConnectUsb.addEventListener('click', connectWebSerial);
    elements.btnConnectBle.addEventListener('click', connectWebBluetooth);
    elements.btnDisconnect.addEventListener('click', disconnectAll);
    
    // Session Controls
    elements.btnStart.addEventListener('click', () => sendControlCommand('START'));
    elements.btnPause.addEventListener('click', () => sendControlCommand('PAUSE'));
    elements.btnReset.addEventListener('click', () => sendControlCommand('RESET'));
    elements.btnExport.addEventListener('click', exportToCSV);

    // Calibration Sliders
    elements.inputThresh.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value).toFixed(2);
        elements.valThreshSlider.innerText = `${val} rad/s`;
        appState.calibration.threshold = parseFloat(val);
    });

    elements.inputDebounce.addEventListener('input', (e) => {
        elements.valDebounceSlider.innerText = `${e.target.value} ms`;
        appState.calibration.debounce = parseInt(e.target.value);
    });

    elements.btnApplyCal.addEventListener('click', sendCalibrationSettings);

    // Sandbox Simulation Mode
    elements.demoModeToggle.addEventListener('change', toggleDemoSimulation);
    elements.btnSimChew.addEventListener('click', triggerSimulatedChew);
    elements.btnSimContinuous.addEventListener('click', toggleAutoChewing);

    // Clear logs
    elements.btnClearConsole.addEventListener('click', () => {
        elements.consoleLogs.innerHTML = '';
        logToConsole('Console logs cleared.', 'system');
    });
}

// --- 7. HARDWARE COMMUNICATIONS LAYER ---

// A. Web Serial Connection (USB)
async function connectWebSerial() {
    if (!('serial' in navigator)) {
        logToConsole("Your browser does not support the Web Serial API. Please use Google Chrome or Edge.", 'error');
        alert("Web Serial is not supported in this browser. Try Chrome or Edge, or use Simulation Mode!");
        return;
    }

    try {
        logToConsole("Requesting Serial Device...", "info");
        appState.serial.port = await navigator.serial.requestPort();
        
        logToConsole("Opening COM Port...", "info");
        updateConnectionStatus('connecting', 'Serial Connecting');
        
        await appState.serial.port.open({ baudRate: 115200 });
        appState.connectionMode = 'serial';
        
        logToConsole("USB Serial Connected! Starting stream reader...", "success");
        updateConnectionStatus('connected', 'USB Connected');

        // Start async read loop
        readSerialDataStream();
        
    } catch (err) {
        logToConsole(`Serial connection failed: ${err.message}`, 'error');
        disconnectAll();
    }
}

async function readSerialDataStream() {
    const decoder = new TextDecoderStream();
    const readableStreamClosed = appState.serial.port.readable.pipeTo(decoder.writable);
    appState.serial.reader = decoder.readable.getReader();

    try {
        while (true) {
            const { value, done } = await appState.serial.reader.read();
            if (done) {
                logToConsole("Serial stream closed by hardware.", "warn");
                break;
            }
            if (value) {
                appState.serial.inputBuffer += value;
                let lines = appState.serial.inputBuffer.split('\n');
                appState.serial.inputBuffer = lines.pop(); // Hold onto partial line
                
                for (let line of lines) {
                    line = line.trim();
                    if (line.startsWith('{') && line.endsWith('}')) {
                        parseHardwareJSON(line);
                    }
                }
            }
        }
    } catch (err) {
        logToConsole(`Error reading Serial stream: ${err.message}`, 'error');
    } finally {
        appState.serial.reader.releaseLock();
    }
}

// Parse Telemetry JSON from ESP32 UART
function parseHardwareJSON(jsonString) {
    try {
        const data = JSON.parse(jsonString);
        processIncomingTelemetry(data);
    } catch (e) {
        // Suppress parsing errors on garbage serial frames during init
    }
}

// Centralized processing for parsed telemetry data (USB, BLE, or Wi-Fi)
let localSessionStartTime = null;

// Centralized processing for parsed telemetry data (USB, BLE, or Wi-Fi)
function processIncomingTelemetry(data) {
    // 1. Plot Filtered Multi-Modal Sensor Signals (Scaling gyro magnitude * 10000)
    pushChartData(data.force || 0.0, data.angle || 0.0, data.sound || 0.0, (data.gyro || 0.0) * 10000);

    // 2. Local State Sync
    const prevCount = appState.chewCount;
    appState.chewCount = data.chews;

    // FSM State Sync
    const states = ['IDLE', 'CHEWING', 'SWALLOW_CHECK', 'ALERT_TRIGGER'];
    appState.sessionState = states[data.state] || 'IDLE';

    if (appState.connectionMode !== 'none') {
        appState.biofeedback.currentBiteChews = appState.chewCount;
        if (appState.chewCount === 0 || appState.chewCount < prevCount) {
            appState.biofeedback.perfectBiteTriggered = false;
        }
    }

    // Dynamic FSR Calibration Tracking (tracks minimum/baseline and maximum/peak force during session)
    if (data.force && data.force > 100) {
        if (data.force < appState.fsrBaseline) {
            appState.fsrBaseline = data.force;
        }
        if (data.force > appState.fsrMax) {
            appState.fsrMax = data.force;
        }
    }

    const fsrRange = appState.fsrMax - appState.fsrBaseline;
    const fsrDelta = (data.force || 0) - appState.fsrBaseline;

    // 2. Solid vs Liquid Diet Characterization Logic
    let dietType = "IDLE / NO INTAKE";
    let dietColor = "#64748b"; // Neutral Grey (Slate Grey)

    if (data.state === 0) {
        dietType = "IDLE / NO INTAKE";
        dietColor = "#64748b";
    } else if (data.state === 1 || data.state === 2) {
        const relativeForce = fsrRange > 200 ? (fsrDelta / fsrRange) : 0.0;
        
        // Solid Food: Upper 35% of FSR range, or strong acoustic chewing sound
        if (relativeForce > 0.35 || (data.sound || 0.0) > 12000) {
            dietType = "DIET DETECTED: SOLID FOOD 🍏";
            dietColor = "#28a745"; // Vibrant Green
        } else if (relativeForce < 0.15 && (data.sound || 0.0) < 4000) {
            dietType = "DIET DETECTED: LIQUID / SIP 🥤";
            dietColor = "#17a2b8"; // Info Cyan
        } else {
            dietType = "DIET DETECTED: SEMI-LIQUID / SOFT FOOD 🥣";
            dietColor = "#ffc107"; // Warning Yellow
        }
    } else if (data.state === 3) {
        dietType = "🚨 COMPLIANCE DEFICIT: SWALLOWED PREMATURELY!";
        dietColor = "#dc3545"; // Alert Red
    }

    // Update DOM elements for Diet Characterization Card
    const dietCard = document.getElementById('diet-card');
    const dietTypeTitle = document.getElementById('diet-type-title');
    const dietStateBadge = document.getElementById('diet-state-badge');
    const dietForceVal = document.getElementById('diet-force-val');
    const dietForceBar = document.getElementById('diet-force-bar');
    const dietAngleVal = document.getElementById('diet-angle-val');
    const dietAngleBar = document.getElementById('diet-angle-bar');
    const dietGyroVal = document.getElementById('diet-gyro-val');
    const dietGyroBar = document.getElementById('diet-gyro-bar');
    const dietSoundVal = document.getElementById('diet-sound-val');
    const dietSoundBar = document.getElementById('diet-sound-bar');
    const imuStatusBadge = document.getElementById('imu-status-badge');

    const stateLabels = {
        0: 'IDLE (State 0)',
        1: 'CHEWING (State 1)',
        2: 'SWALLOW CHECK (State 2)',
        3: 'ALERT ACTIVE (State 3)'
    };

    if (dietCard) {
        dietCard.style.borderLeft = `8px solid ${dietColor}`;
    }
    if (dietTypeTitle) {
        dietTypeTitle.innerText = dietType;
        dietTypeTitle.style.textShadow = `0 0 10px ${dietColor}33`;
    }
    if (dietStateBadge) {
        dietStateBadge.innerText = stateLabels[data.state] || `STATE ${data.state}`;
        dietStateBadge.style.color = dietColor;
        dietStateBadge.style.borderColor = dietColor;
    }
    
    // IMU Status Indicator
    if (imuStatusBadge) {
        if (data.imu_ok === 1) {
            imuStatusBadge.innerText = "IMU: OK";
            imuStatusBadge.style.color = "#28a745";
            imuStatusBadge.style.borderColor = "#28a745";
        } else {
            imuStatusBadge.innerText = "IMU: OFF";
            imuStatusBadge.style.color = "#dc3545";
            imuStatusBadge.style.borderColor = "#dc3545";
        }
    }

    // FSR Bite Force Progress Bar
    // baseline = 0g (0 N), max = 1000g (10 N)
    let forceGrams = 0;
    let forceNewtons = 0.0;
    if (data.force > appState.fsrBaseline && fsrRange > 100) {
        const pct = (data.force - appState.fsrBaseline) / fsrRange;
        forceGrams = Math.round(pct * 1000);
        forceNewtons = pct * 10.0;
    }

    if (dietForceVal) {
        dietForceVal.innerText = `${forceGrams}g (${forceNewtons.toFixed(1)} N) [${Math.round(data.force || 0).toLocaleString()} ADC]`;
    }
    if (dietForceBar) {
        const forcePct = Math.min(Math.max(((data.force || 0) / 65535) * 100, 0), 100);
        dietForceBar.style.width = `${forcePct}%`;
    }

    // Flex Jaw Angle Progress Bar
    // Flex baseline is ~8000 and decreases when mouth is open. 
    // 8000 baseline = 0 degrees (closed), 4000 or lower = 45 degrees (fully open).
    const angleBaseline = 8000;
    const flexValue = data.angle || 8000;
    const diff = Math.max(angleBaseline - flexValue, 0);
    const jawDegrees = Math.min((diff / 4000) * 45, 45); // Map to 0-45 degrees range
    const anglePct = Math.min((diff / 4000) * 100, 100);

    if (dietAngleVal) {
        dietAngleVal.innerText = `${jawDegrees.toFixed(1)}° (${Math.round(flexValue).toLocaleString()} ADC)`;
    }
    if (dietAngleBar) {
        dietAngleBar.style.width = `${anglePct}%`;
    }

    // IMU Gyro Progress Bar
    if (dietGyroVal) {
        dietGyroVal.innerText = `${(data.gyro || 0.0).toFixed(2)} rad/s`;
    }
    if (dietGyroBar) {
        const gyroPct = Math.min(Math.max(((data.gyro || 0.0) / 2.5) * 100, 0), 100);
        dietGyroBar.style.width = `${gyroPct}%`;
    }

    // Acoustic Volume Progress Bar
    if (dietSoundVal) {
        dietSoundVal.innerText = `${Math.round(data.sound || 0).toLocaleString()} ADC`;
    }
    if (dietSoundBar) {
        const soundPct = Math.min(Math.max(((data.sound || 0) / 65535) * 100, 0), 100);
        dietSoundBar.style.width = `${soundPct}%`;
    }



    // Play/stop alert alarm based on FSM State 3 (ALERT_TRIGGER)
    if (appState.sessionState === 'ALERT_TRIGGER') {
        if (!appState.biofeedback.isWarningAlarmActive) {
            playWarningAlarm();
            logToConsole("[BIOFEEDBACK] Swallowed too early! Alert Trigger (State 3) active.", "error");
        }
        // Immediately update warning banner UI
        const banner = document.getElementById('biofeedback-banner');
        const icon = document.getElementById('biofeedback-icon');
        const text = document.getElementById('biofeedback-text');
        if (banner && icon && text) {
            banner.className = 'biofeedback-banner warning';
            icon.innerText = '🛑';
            text.innerHTML = `<strong>Warning: Swallowed too early!</strong> You only chewed <strong>${appState.chewCount}</strong> times. Chew at least 32 times for better digestion!`;
        }
    } else {
        if (appState.biofeedback.isWarningAlarmActive) {
            stopWarningAlarm();
        }
    }

    // Calculate local cpm and session duration
    const isActive = ['ACTIVE', 'CHEWING', 'SWALLOW_CHECK', 'ALERT_TRIGGER'].includes(appState.sessionState);
    if (isActive) {
        if (!localSessionStartTime) {
            localSessionStartTime = Date.now();
        }
        appState.sessionDuration = (Date.now() - localSessionStartTime) / 1000.0;
    } else {
        localSessionStartTime = null;
        appState.sessionDuration = 0.0;
    }

    // CPM estimation
    const timeElapsedMin = appState.sessionDuration / 60;
    if (timeElapsedMin > 0.05) {
        appState.chewRateCPM = appState.chewCount / timeElapsedMin;
    } else if (appState.chewCount > 0 && appState.sessionDuration > 0) {
        appState.chewRateCPM = (appState.chewCount / appState.sessionDuration) * 60;
    } else {
        appState.chewRateCPM = 0.0;
    }

    // 3. Handle Auto-Calibration Status indicators dynamically from firmware
    const calBadge = document.getElementById('calibration-badge');
    if (calBadge) {
        if (data.calib === 1) {
            calBadge.style.display = 'inline-block';
            calBadge.innerText = 'CALIBRATING';
            calBadge.className = 'badge calibrating';
        } else if (data.calib_comp === 1) {
            calBadge.style.display = 'inline-block';
            calBadge.innerText = 'CALIBRATED';
            calBadge.className = 'badge active';
            // Automatically hide calibration complete badge after 5 seconds
            setTimeout(() => {
                const isStillActive = ['ACTIVE', 'CHEWING', 'SWALLOW_CHECK', 'ALERT_TRIGGER'].includes(appState.sessionState);
                if (isStillActive) {
                    calBadge.style.display = 'none';
                }
            }, 5000);
        } else {
            calBadge.style.display = 'none';
        }
    }

    // 4. Detect Chew Event (if value increased on device)
    if (appState.chewCount > prevCount) {
        triggerChewVisualEffects();
    }
    if (appState.chewCount !== prevCount) {
        handleChewBiofeedback();
    }

    // 4. Handle auto-adjust values from device calibrations
    if (document.activeElement !== elements.inputThresh && data.thresh) {
        elements.inputThresh.value = data.thresh;
        elements.valThreshSlider.innerText = `${parseFloat(data.thresh).toFixed(2)} rad/s`;
        appState.calibration.threshold = parseFloat(data.thresh);
    }
    if (document.activeElement !== elements.inputDebounce && data.db) {
        elements.inputDebounce.value = data.db;
        elements.valDebounceSlider.innerText = `${data.db} ms`;
        appState.calibration.debounce = parseInt(data.db);
    }

    // 5. Save logs
    if (isActive) {
        appState.logs.push({
            timestamp: new Date().toLocaleTimeString(),
            force: data.force || 0.0,
            angle: data.angle || 0.0,
            sound: data.sound || 0.0,
            chewsCount: appState.chewCount,
            cpm: appState.chewRateCPM,
            sessionDurationSec: appState.sessionDuration
        });
    }

    updateDashboardMetrics();
}

// B. Web Bluetooth Connection (BLE)
// Centralized BLE State Cleanup
function cleanupBleState() {
    if (appState.ble.device) {
        try {
            appState.ble.device.removeEventListener('gattserverdisconnected', onGattDisconnected);
        } catch (e) {}
        
        if (appState.ble.device.gatt && appState.ble.device.gatt.connected) {
            try {
                appState.ble.device.gatt.disconnect();
                logToConsole("Explicitly disconnected GATT server to release socket.", "info");
            } catch (e) {}
        }
    }
    appState.ble.device = null;
    appState.ble.server = null;
    appState.ble.service = null;
    appState.ble.telemetryChar = null;
    appState.ble.sensorChar = null;
    appState.ble.configChar = null;
    appState.ble.controlChar = null;
    appState.ble.inputBuffer = ''; // Clear stream accumulator buffer

    appState.connectionMode = 'none';
    if (!appState.demoModeActive) {
        appState.sessionState = 'IDLE';
    }
}

// Abrupt disconnection handler to recover browser pairing lock states
function onGattDisconnected(event) {
    const device = event.target;
    logToConsole(`BLE connection lost with ${device.name || "PicoW_ChewingTracker"} abruptly. Running recovery...`, 'warn');
    
    if (device.gatt && device.gatt.connected) {
        try {
            device.gatt.disconnect();
        } catch (e) {}
    }
    
    cleanupBleState();
    
    updateConnectionStatus('disconnected', 'Disconnected');
    logToConsole("Hardware socket released. Ready for reconnection.", 'warn');
    updateUIStates();
}

// Promise wrapper to enforce a connection timeout
function connectGattWithTimeout(gatt, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            logToConsole("GATT Connection timing out. Explicitly disconnecting to release lock...", "warn");
            try {
                gatt.disconnect();
            } catch (e) {
                console.error("Failed to disconnect GATT on timeout:", e);
            }
            reject(new Error(`GATT connection timed out after ${ms / 1000}s`));
        }, ms);
        
        gatt.connect()
            .then(server => {
                clearTimeout(timer);
                resolve(server);
            })
            .catch(err => {
                clearTimeout(timer);
                reject(err);
            });
    });
}

async function connectWebBluetooth() {
    if (!('bluetooth' in navigator)) {
        logToConsole("Your browser does not support Web Bluetooth. Please try Chrome/Edge or use Simulation.", 'error');
        alert("Web Bluetooth is not supported in this browser. Try Chrome or Edge!");
        return;
    }

    try {
        logToConsole("Scanning for BioChew Tracker BLE device...", "info");
        updateConnectionStatus('connecting', 'BLE Scanning');

        // Safe filters to catch MicroPython device named "PicoW_ChewingTracker" directly.
        // We include namePrefixes 'PicoW_' and 'Pico_' and keep service UUID in optionalServices.
        // This avoids mismatches if MicroPython excludes the Service UUID in the advertisement payload.
        appState.ble.device = await navigator.bluetooth.requestDevice({
            filters: [
                { name: 'PicoW_ChewingTracker' },
                { name: 'Pico_ChewingTracker' },
                { name: 'ESP32_ChewingTracker' },
                { namePrefix: 'PicoW_Chewing' },
                { namePrefix: 'Pico_Chewing' },
                { namePrefix: 'PicoW_' },
                { namePrefix: 'Pico_' },
                { namePrefix: 'ESP32_' }
            ],
            optionalServices: [BLE_UUIDS.service]
        });

        const deviceName = appState.ble.device.name || "PicoW_ChewingTracker";
        logToConsole(`Device discovered: ${deviceName}. Connecting to GATT Server (Timeout 8s)...`, 'info');
        
        // Bind abrupt disconnection event listener
        appState.ble.device.addEventListener('gattserverdisconnected', onGattDisconnected);

        // Attempt connection with strict 8-second timeout to prevent paired hang locks
        appState.ble.server = await connectGattWithTimeout(appState.ble.device.gatt, 8000);

        logToConsole("GATT Service negotiation in progress...", 'info');
        appState.ble.service = await appState.ble.server.getPrimaryService(BLE_UUIDS.service);

        logToConsole("Negotiating BLE characteristics...", 'info');
        
        // 1. Telemetry characteristic: Primary pipeline for RPi Pico W (Strictly Required)
        try {
            appState.ble.telemetryChar = await appState.ble.service.getCharacteristic(BLE_UUIDS.telemetry);
            await appState.ble.telemetryChar.startNotifications();
            appState.ble.telemetryChar.addEventListener('characteristicvaluechanged', handleBleTelemetryNotification);
            logToConsole("Successfully subscribed to primary Telemetry notifications.", "success");
        } catch (err) {
            logToConsole(`Critical: Failed to bind Telemetry characteristic: ${err.message}`, 'error');
            throw err; // Fail connection if core telemetry pipeline is missing
        }

        // 2. Sensor characteristic (Optional fallback)
        try {
            appState.ble.sensorChar = await appState.ble.service.getCharacteristic(BLE_UUIDS.sensor);
            await appState.ble.sensorChar.startNotifications();
            appState.ble.sensorChar.addEventListener('characteristicvaluechanged', handleBleSensorNotification);
            logToConsole("Subscribed to optional high-rate Sensor notifications.", "info");
        } catch (err) {
            logToConsole("Sensor characteristic is not exposed on this hardware. Bypassing...", "info");
            appState.ble.sensorChar = null;
        }

        // 3. Config characteristic (Optional fallback)
        try {
            appState.ble.configChar = await appState.ble.service.getCharacteristic(BLE_UUIDS.config);
            const configVal = await appState.ble.configChar.readValue();
            parseBleConfigBytes(configVal);
            logToConsole("Exposed and synchronized optional Config settings.", "info");
        } catch (err) {
            logToConsole("Config characteristic is not exposed on this hardware. Bypassing...", "info");
            appState.ble.configChar = null;
        }

        // 4. Control characteristic (Optional fallback)
        try {
            appState.ble.controlChar = await appState.ble.service.getCharacteristic(BLE_UUIDS.control);
            logToConsole("Exposed optional Control command characteristic.", "info");
        } catch (err) {
            logToConsole("Control characteristic is not exposed on this hardware. Bypassing...", "info");
            appState.ble.controlChar = null;
        }

        appState.connectionMode = 'ble';
        logToConsole("Wireless Bluetooth BLE Connected & Synchronized!", "success");
        updateConnectionStatus('connected', 'BLE Connected');

    } catch (err) {
        logToConsole(`BLE Connection Failed: ${err.message}`, 'error');
        // Explicitly disconnect to clean up incomplete pairings/locks
        if (appState.ble.device && appState.ble.device.gatt.connected) {
            try {
                appState.ble.device.gatt.disconnect();
            } catch (e) {}
        }
        disconnectAll();
    }
}

// Read telemetry stream from BLE notification packets using an asynchronous TextDecoder stream accumulator
function handleBleTelemetryNotification(event) {
    try {
        const decodedChunk = new TextDecoder().decode(event.target.value);
        appState.ble.inputBuffer = (appState.ble.inputBuffer || '') + decodedChunk;
        
        // Split by newlines to parse separate streaming frames
        let lines = appState.ble.inputBuffer.split('\n');
        appState.ble.inputBuffer = lines.pop(); // Keep any trailing partial line in the buffer
        
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            processTelemetryLine(line);
        }
        
        // Fallback: check if the remaining buffer itself forms a complete JSON object (e.g. no trailing newline)
        let remaining = appState.ble.inputBuffer.trim();
        if (remaining.startsWith('{') && remaining.endsWith('}')) {
            processTelemetryLine(remaining);
            appState.ble.inputBuffer = '';
        }
    } catch (err) {
        logToConsole(`Error decoding BLE telemetry data packet: ${err.message}`, 'error');
    }
}

// Parse a single telemetry frame line (JSON or legacy comma-separated)
function processTelemetryLine(line) {
    if (line.startsWith('{') && line.endsWith('}')) {
        parseHardwareJSON(line);
    } else {
        // Fallback: Legacy comma-separated format "chewCount,cpm,sessionDurationSec,sessionState"
        const parts = line.split(',');
        if (parts.length >= 4) {
            const prevCount = appState.chewCount;
            appState.chewCount = parseInt(parts[0]);
            appState.chewRateCPM = parseFloat(parts[1]);
            appState.sessionDuration = parseFloat(parts[2]);
            
            const states = ['IDLE', 'ACTIVE', 'PAUSED'];
            appState.sessionState = states[parseInt(parts[3])] || 'IDLE';

            if (appState.chewCount > prevCount) {
                triggerChewVisualEffects();
            }
            updateDashboardMetrics();
        }
    }
}

// Read live filtered sensor stream from BLE notification packets
function handleBleSensorNotification(event) {
    try {
        const value = new TextDecoder().decode(event.target.value);
        // Expected format: "fax,fay,faz,fgx,fgy,fgz"
        const parts = value.split(',');
        if (parts.length >= 6) {
            // Filtered gyroscope magnitude (sqrt(fgx^2 + fgy^2 + fgz^2))
            const fgx = parseFloat(parts[3]);
            const fgy = parseFloat(parts[4]);
            const fgz = parseFloat(parts[5]);
            const magnitude = Math.sqrt(fgx*fgx + fgy*fgy + fgz*fgz);
            
            pushChartData(0, 0, 0, magnitude * 10000);

            const isActive = ['ACTIVE', 'CHEWING', 'SWALLOW_CHECK', 'ALERT_TRIGGER'].includes(appState.sessionState);
            if (isActive) {
                appState.logs.push({
                    timestamp: new Date().toLocaleTimeString(),
                    force: 0.0,
                    angle: 0.0,
                    sound: magnitude,
                    chewsCount: appState.chewCount,
                    cpm: appState.chewRateCPM,
                    sessionDurationSec: appState.sessionDuration
                });
            }
        }
    } catch (err) {
        logToConsole(`Error decoding BLE sensor data packet: ${err.message}`, 'error');
    }
}

function parseBleConfigBytes(valueDataView) {
    try {
        const valString = new TextDecoder().decode(valueDataView);
        const parts = valString.split(',');
        if (parts.length >= 2) {
            const thresh = parseFloat(parts[0]);
            const db = parseInt(parts[1]);

            appState.calibration.threshold = thresh;
            appState.calibration.debounce = db;

            elements.inputThresh.value = thresh;
            elements.valThreshSlider.innerText = `${thresh.toFixed(2)} rad/s`;
            
            elements.inputDebounce.value = db;
            elements.valDebounceSlider.innerText = `${db} ms`;
        }
    } catch (err) {
        logToConsole(`Error decoding BLE config: ${err.message}`, 'error');
    }
}

// C. Outbound Control Packets to Pico W
async function sendControlCommand(cmd) {
    if (cmd === 'RESET') {
        if (appState.chewCount > 0) {
            if (typeof saveSessionToHistory === 'function') {
                saveSessionToHistory(appState.chewCount, appState.chewRateCPM, appState.sessionDuration);
            }
        }
        
        // Reset client variables synchronously for instant snappy UI feedback
        appState.chewCount = 0;
        appState.chewRateCPM = 0.0;
        appState.sessionDuration = 0.0;
        appState.sessionState = 'IDLE';
        appState.logs = [];
        
        // Clear biofeedback text and alarms
        appState.biofeedback.currentBiteChews = 0;
        appState.biofeedback.perfectBiteTriggered = false;
        if (appState.biofeedback.isWarningAlarmActive) {
            stopWarningAlarm();
        }
        const banner = document.getElementById('biofeedback-banner');
        const icon = document.getElementById('biofeedback-icon');
        const text = document.getElementById('biofeedback-text');
        if (banner && icon && text) {
            banner.className = 'biofeedback-banner info';
            icon.innerText = '💡';
            text.innerHTML = 'Ready to analyze your chewing. Start eating!';
        }
        
        updateDashboardMetrics();
        updateUIStates();
    }
    
    logToConsole(`Sending Session Command: ${cmd}...`, 'info');
    
    // Offline simulation handling
    if (appState.demoModeActive) {
        handleSimulatedControlCommand(cmd);
        return;
    }

    if (appState.connectionMode === 'serial' && appState.serial.port) {
        try {
            const encoder = new TextEncoder();
            const writer = appState.serial.port.writable.getWriter();
            await writer.write(encoder.encode(cmd + '\n'));
            writer.releaseLock();
            logToConsole(`Command '${cmd}' sent over USB successfully.`, 'success');
        } catch (err) {
            logToConsole(`Failed sending serial command: ${err.message}`, 'error');
        }
    } else if (appState.connectionMode === 'ble' && appState.ble.controlChar) {
        try {
            const encoder = new TextEncoder();
            await appState.ble.controlChar.writeValue(encoder.encode(cmd));
            logToConsole(`Command '${cmd}' written to BLE characteristic.`, 'success');
        } catch (err) {
            logToConsole(`Failed writing BLE control: ${err.message}`, 'error');
        }
    } else if (appState.connectionMode === 'wifi' && socketClient && socketClient.readyState === WebSocket.OPEN) {
        try {
            socketClient.send(cmd);
            logToConsole(`Command '${cmd}' sent over Wi-Fi successfully.`, 'success');
        } catch (err) {
            logToConsole(`Failed sending Wi-Fi command: ${err.message}`, 'error');
        }
    } else {
        logToConsole("No hardware is currently connected.", 'warn');
    }
}

// D. Send calibration settings back to the Pico W
async function sendCalibrationSettings() {
    const thresh = appState.calibration.threshold.toFixed(2);
    const db = appState.calibration.debounce;
    const payload = `${thresh},${db}`;
    
    logToConsole(`Sending Calibration: Threshold=${thresh} rad/s, Debounce=${db} ms`, 'info');
    
    if (appState.demoModeActive) {
        logToConsole("Offline Calibration Updated.", 'success');
        return;
    }

    if (appState.connectionMode === 'serial' && appState.serial.port) {
        try {
            logToConsole("Calibration updates are fully supported wirelessly over Bluetooth BLE.", 'info');
        } catch (e) {}
    } else if (appState.connectionMode === 'ble' && appState.ble.configChar) {
        try {
            const encoder = new TextEncoder();
            await appState.ble.configChar.writeValue(encoder.encode(payload));
            logToConsole("Calibration variables successfully synchronized with Pico W!", 'success');
        } catch (err) {
            logToConsole(`Failed writing BLE config: ${err.message}`, 'error');
        }
    } else if (appState.connectionMode === 'wifi' && socketClient && socketClient.readyState === WebSocket.OPEN) {
        try {
            socketClient.send(`CAL:${payload}`);
            logToConsole("Calibration variables successfully synchronized with Pico W over Wi-Fi!", 'success');
        } catch (err) {
            logToConsole(`Failed writing Wi-Fi config: ${err.message}`, 'error');
        }
    } else {
        logToConsole("Calibration updated locally. Connect via Bluetooth BLE or Wi-Fi to sync hardware.", 'warn');
    }
}

// Disconnect from serial and Bluetooth interfaces
async function disconnectAll() {
    // Save session to history if active
    if (appState.chewCount > 0) {
        if (typeof saveSessionToHistory === 'function') {
            saveSessionToHistory(appState.chewCount, appState.chewRateCPM, appState.sessionDuration);
        }
    }
    
    // Clear auto-reconnection loop
    shouldAutoReconnect = false;
    if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
    }
    
    logToConsole("Closing hardware connections...", 'info');
    
    // Wi-Fi Cleanup
    if (socketClient) {
        try {
            socketClient.onopen = null;
            socketClient.onmessage = null;
            socketClient.onerror = null;
            socketClient.onclose = null;
            socketClient.close();
        } catch (e) {}
        socketClient = null;
    }
    
    const wasWifiConnected = isWifiConnected;
    isWifiConnected = false;
    
    const connectBtn = document.getElementById('connectWifiBtn');
    const ipField = document.getElementById('picoWifiIp');
    if (connectBtn) {
        connectBtn.disabled = false;
        connectBtn.innerHTML = '<i data-lucide="wifi"></i> Connect Wi-Fi';
        connectBtn.classList.remove('active-wifi-style');
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }
    }
    if (ipField) {
        ipField.disabled = false;
    }
    
    if (wasWifiConnected || appState.connectionMode === 'wifi') {
        logToConsole("Wi-Fi Streaming Disconnected.", "warn");
    }

    // Web Serial Cleanup
    if (appState.serial.reader) {
        try {
            await appState.serial.reader.cancel();
        } catch (e) {}
        appState.serial.reader = null;
    }
    if (appState.serial.port) {
        try {
            await appState.serial.port.close();
        } catch (e) {}
        appState.serial.port = null;
    }
    
    // BLE Cleanup
    if (appState.ble.device && appState.ble.device.gatt.connected) {
        try {
            await appState.ble.device.gatt.disconnect();
        } catch (e) {}
    }
    cleanupBleState();
    
    updateConnectionStatus('disconnected', 'Disconnected');
    logToConsole("Hardware disconnected.", 'warn');
    updateUIStates();
    updateDashboardMetrics();
}

// C. Wi-Fi (WebSocket) Connection
function connectWifiSocket(targetIp) {
    if (!targetIp) return;
    wifiTargetIp = targetIp;

    logToConsole(`Connecting to Wi-Fi stream at ws://${targetIp}/ ...`, "info");
    updateConnectionStatus('connecting', shouldAutoReconnect ? 'Reconnecting...' : 'Wi-Fi Connecting');

    const ipField = document.getElementById('picoWifiIp');
    const connectBtn = document.getElementById('connectWifiBtn');

    if (ipField) {
        ipField.disabled = true;
    }
    if (connectBtn) {
        connectBtn.disabled = true; // Temporary disable while connecting
    }

    try {
        socketClient = new WebSocket(`ws://${targetIp}/`);

        // Connection Timeout handler
        const connectionTimeout = setTimeout(() => {
            if (socketClient && socketClient.readyState !== WebSocket.OPEN) {
                logToConsole("Wi-Fi WebSocket connection timed out.", "error");
                handleWifiConnectionFailure();
            }
        }, 4000); // 4-second timeout for quick retries

        socketClient.onopen = () => {
            clearTimeout(connectionTimeout);
            isWifiConnected = true;
            appState.connectionMode = 'wifi';
            shouldAutoReconnect = true; // Enable auto-reconnect on successful connection

            logToConsole("Wi-Fi WebSocket stream connected! Channel open.", "success");
            updateConnectionStatus('connected', 'Wi-Fi Connected');

            if (connectBtn) {
                connectBtn.disabled = false;
                connectBtn.innerHTML = '<i data-lucide="power"></i> Disconnect';
                connectBtn.classList.add('active-wifi-style');
                if (typeof lucide !== 'undefined' && lucide.createIcons) {
                    lucide.createIcons();
                }
            }
        };

        socketClient.onmessage = (event) => {
            try {
                const telemetryData = JSON.parse(event.data);
                processIncomingTelemetry(telemetryData);
            } catch (parseError) {
                // Suppress fragment/split JSON parsing errors
                console.debug("JSON Parse frame error ignored.");
            }
        };

        socketClient.onerror = (error) => {
            clearTimeout(connectionTimeout);
            logToConsole("Wi-Fi WebSocket pipeline error occurred.", "error");
        };

        socketClient.onclose = () => {
            clearTimeout(connectionTimeout);
            logToConsole("Wi-Fi Connection channel closed.", "warn");
            handleWifiConnectionFailure();
        };

    } catch (err) {
        logToConsole(`Wi-Fi Setup error: ${err.message}`, 'error');
        handleWifiConnectionFailure();
    }
}

function handleWifiConnectionFailure() {
    // Clean up current socket
    if (socketClient) {
        try {
            socketClient.onopen = null;
            socketClient.onmessage = null;
            socketClient.onerror = null;
            socketClient.onclose = null;
            socketClient.close();
        } catch (e) {}
        socketClient = null;
    }
    isWifiConnected = false;

    const connectBtn = document.getElementById('connectWifiBtn');
    const ipField = document.getElementById('picoWifiIp');

    if (shouldAutoReconnect) {
        updateConnectionStatus('connecting', 'Reconnecting...');
        logToConsole("Attempting automatic reconnection in 2 seconds...", "info");

        if (connectBtn) {
            connectBtn.disabled = false;
            connectBtn.innerHTML = '<i data-lucide="power"></i> Cancel Reconnect';
            connectBtn.classList.add('active-wifi-style');
            if (typeof lucide !== 'undefined' && lucide.createIcons) {
                lucide.createIcons();
            }
        }

        if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = setTimeout(() => {
            if (shouldAutoReconnect) {
                connectWifiSocket(wifiTargetIp);
            }
        }, 2000);
    } else {
        disconnectAll();
    }
}

function toggleWifiStream() {
    const ipField = document.getElementById('picoWifiIp');
    const connectBtn = document.getElementById('connectWifiBtn');
    const targetIp = ipField ? ipField.value.trim() : "";

    if (!targetIp) {
        alert("Please enter a valid Pico W IP Address first.");
        return;
    }

    if (isWifiConnected || socketClient || shouldAutoReconnect) {
        // Disconnect Routine
        shouldAutoReconnect = false;
        if (reconnectTimeoutId) {
            clearTimeout(reconnectTimeoutId);
            reconnectTimeoutId = null;
        }
        disconnectAll();
    } else {
        // Connect & Stream Routine
        // Terminate any active USB/BLE/Demo streams
        disconnectAll();
        shouldAutoReconnect = true;
        connectWifiSocket(targetIp);
    }
}

// --- 8. OFFLINE INTERACTIVE DEMO SIMULATION ENGINE ---
function toggleDemoSimulation(e) {
    const active = e.target.checked;
    appState.demoModeActive = active;
    
    if (active) {
        disconnectAll(); // Terminate real hardware streams
        logToConsole("Simulation Mode active! Emulating physical 50Hz MPU6050...", "event");
        updateConnectionStatus('connected', 'Simulated Hardware');
        elements.demoButtons.style.opacity = '1';
        elements.demoButtons.style.pointerEvents = 'auto';
        
        // Start simulated sensor clock loop (50Hz = 20ms period)
        appState.simTime = 0;
        appState.demoIntervalId = setInterval(runSensorSimulationStep, 20);
    } else {
        logToConsole("Simulation Mode deactivated.", "system");
        clearInterval(appState.demoIntervalId);
        clearInterval(appState.demoAutoChewId);
        appState.demoIntervalId = null;
        appState.demoAutoChewId = null;
        elements.demoButtons.style.opacity = '0.5';
        elements.demoButtons.style.pointerEvents = 'none';
        elements.btnSimContinuous.innerHTML = '<i data-lucide="repeat"></i> Auto-Chewing (70 CPM)';
        lucide.createIcons();
        disconnectAll();
    }
    updateUIStates();
}

// Simulate one clock cycle of jaw movement
function runSensorSimulationStep() {
    appState.simTime += 0.02; // 20ms step
    
    // 1. Generate ambient noise and small breathing/mouth tremors (noise floor around 0.1 to 0.3 rad/s)
    let gyroSignal = 0.15 + 0.08 * Math.sin(appState.simTime * 2.5) + 0.04 * Math.cos(appState.simTime * 12.0) + Math.random() * 0.05;
    
    // Simulate multi-modal sensors
    let simForce = 800 + 0.04 * Math.cos(appState.simTime * 12.0) + Math.random() * 50;
    let simAngle = 8000 - 50 * Math.sin(appState.simTime * 2.5) - Math.random() * 50;
    let simSound = 500 + Math.random() * 100;

    // 2. Add chew impulse if active
    if (appState.demoChewActive) {
        const chewElapsedTime = appState.simTime - appState.demoChewStartTime;
        if (chewElapsedTime < 0.5) { // Chew duration = 500ms
            const chewPhase = (chewElapsedTime / 0.5) * Math.PI;
            gyroSignal += 2.5 * Math.sin(chewPhase); // Peak amplitude = 2.5 rad/s
            simForce += 4500 * Math.sin(chewPhase); // user FSR max is 7000, baseline 800
            simAngle -= 3000 * Math.sin(chewPhase); // Flex drops from 8000 down to 5000 on chew
            simSound += 14000 * Math.sin(chewPhase) * Math.random(); // Sound spikes up to 14k
        } else {
            appState.demoChewActive = false; // Reset chew trigger
        }
    }
    
    // 3. Update Chart plotting (pushing scaled gyro as 4th dataset)
    pushChartData(simForce, simAngle, simSound, gyroSignal * 10000);
    
    // 4. Simulated session telemetry logic (timers, counts, rates)
    if (appState.sessionState === 'ACTIVE') {
        appState.sessionDuration += 0.02;
        
        // Local Web Detector Peak-Triggering Algorithm
        if (gyroSignal >= appState.calibration.threshold) {
            const timeSinceLastChew = (appState.simTime - appState.simLastChewTime) * 1000;
            if (!appState.simAboveThreshold && (timeSinceLastChew >= appState.calibration.debounce)) {
                appState.chewCount++;
                appState.simLastChewTime = appState.simTime;
                
                triggerChewVisualEffects();
                logToConsole(`[SIMULATOR EVENT] Chew detected! Count: ${appState.chewCount}`, 'event');
            }
            appState.simAboveThreshold = true;
        } else if (gyroSignal < (appState.calibration.threshold * 0.8)) {
            appState.simAboveThreshold = false;
        }
        
        // Rolling CPM estimation
        const timeElapsedMin = appState.sessionDuration / 60;
        if (timeElapsedMin > 0.05) {
            appState.chewRateCPM = appState.chewCount / timeElapsedMin;
        } else if (appState.chewCount > 0) {
            appState.chewRateCPM = (appState.chewCount / appState.sessionDuration) * 60;
        }

        // Save mock data point
        appState.logs.push({
            timestamp: new Date().toLocaleTimeString(),
            force: simForce,
            angle: simAngle,
            sound: simSound,
            chewsCount: appState.chewCount,
            cpm: appState.chewRateCPM,
            sessionDurationSec: appState.sessionDuration
        });
    }

    // Update Diet Characterization Card for Demo/Simulation Mode
    let simState = 0;
    if (appState.sessionState === 'ACTIVE') {
        simState = 1;
    } else if (appState.sessionState === 'PAUSED') {
        simState = 0;
    }
    
    let dietType = "IDLE / NO INTAKE";
    let dietColor = "#64748b"; // Neutral Grey (Slate Grey)

    if (simState === 0) {
        dietType = "IDLE / NO INTAKE";
        dietColor = "#64748b";
    } else if (simState === 1) {
        const simRange = 6500 - 800;
        const simDelta = simForce - 800;
        const relativeForce = simDelta / simRange;
        
        if (relativeForce > 0.35 || simSound > 12000) {
            dietType = "DIET DETECTED: SOLID FOOD 🍏";
            dietColor = "#28a745"; // Vibrant Green
        } else if (relativeForce < 0.15 && simSound < 4000) {
            dietType = "DIET DETECTED: LIQUID / SIP 🥤";
            dietColor = "#17a2b8"; // Info Cyan
        } else {
            dietType = "DIET DETECTED: SEMI-LIQUID / SOFT FOOD 🥣";
            dietColor = "#ffc107"; // Warning Yellow
        }
    }

    const dietCard = document.getElementById('diet-card');
    const dietTypeTitle = document.getElementById('diet-type-title');
    const dietStateBadge = document.getElementById('diet-state-badge');
    const dietForceVal = document.getElementById('diet-force-val');
    const dietForceBar = document.getElementById('diet-force-bar');
    const dietAngleVal = document.getElementById('diet-angle-val');
    const dietAngleBar = document.getElementById('diet-angle-bar');
    const dietGyroVal = document.getElementById('diet-gyro-val');
    const dietGyroBar = document.getElementById('diet-gyro-bar');
    const dietSoundVal = document.getElementById('diet-sound-val');
    const dietSoundBar = document.getElementById('diet-sound-bar');
    const imuStatusBadge = document.getElementById('imu-status-badge');

    if (dietCard) {
        dietCard.style.borderLeft = `8px solid ${dietColor}`;
    }
    if (dietTypeTitle) {
        dietTypeTitle.innerText = dietType;
        dietTypeTitle.style.textShadow = `0 0 10px ${dietColor}33`;
    }
    if (dietStateBadge) {
        dietStateBadge.innerText = simState === 1 ? 'CHEWING (State 1)' : 'IDLE (State 0)';
        dietStateBadge.style.color = dietColor;
        dietStateBadge.style.borderColor = dietColor;
    }
    if (imuStatusBadge) {
        imuStatusBadge.innerText = "IMU: SIM";
        imuStatusBadge.style.color = "#a55eea";
        imuStatusBadge.style.borderColor = "#a55eea";
    }
    // Simulated FSR Bite Force (Convert ADC to Grams & Newtons)
    // baseline (800) = 0g, max (6500) = 1000g
    let simForceGrams = 0;
    let simForceNewtons = 0.0;
    const simFsrRange = 6500 - 800;
    if (simForce > 800) {
        const pct = (simForce - 800) / simFsrRange;
        simForceGrams = Math.round(pct * 1000);
        simForceNewtons = pct * 10.0;
    }

    if (dietForceVal) {
        dietForceVal.innerText = `${simForceGrams}g (${simForceNewtons.toFixed(1)} N) [${Math.round(simForce).toLocaleString()} ADC]`;
    }
    if (dietForceBar) {
        const forcePct = Math.min(Math.max((simForce / 65535) * 100, 0), 100);
        dietForceBar.style.width = `${forcePct.toFixed(1)}%`;
    }
    const simAngleBaseline = 8000;
    const simDiff = Math.max(simAngleBaseline - simAngle, 0);
    const simJawDegrees = Math.min((simDiff / 4000) * 45, 45);
    const simAnglePct = Math.min((simDiff / 4000) * 100, 100);

    if (dietAngleVal) {
        dietAngleVal.innerText = `${simJawDegrees.toFixed(1)}° (${Math.round(simAngle).toLocaleString()} ADC)`;
    }
    if (dietAngleBar) {
        dietAngleBar.style.width = `${simAnglePct.toFixed(1)}%`;
    }
    if (dietGyroVal) {
        dietGyroVal.innerText = `${gyroSignal.toFixed(2)} rad/s`;
    }
    if (dietGyroBar) {
        const gyroPct = Math.min(Math.max((gyroSignal / 2.5) * 100, 0), 100);
        dietGyroBar.style.width = `${gyroPct.toFixed(1)}%`;
    }
    if (dietSoundVal) {
        dietSoundVal.innerText = `${Math.round(simSound).toLocaleString()} ADC`;
    }
    if (dietSoundBar) {
        const soundPct = Math.min(Math.max((simSound / 65535) * 100, 0), 100);
        dietSoundBar.style.width = `${soundPct.toFixed(1)}%`;
    }

    updateDashboardMetrics();
}

function triggerSimulatedChew() {
    if (appState.sessionState !== 'ACTIVE') {
        logToConsole("Please click 'Start Session' first to enable chew logging.", 'warn');
        return;
    }
    if (!appState.demoChewActive) {
        appState.demoChewActive = true;
        appState.demoChewStartTime = appState.simTime;
        logToConsole("Simulating biomechanical jaw stroke...", 'info');
    }
}

function toggleAutoChewing() {
    if (appState.sessionState !== 'ACTIVE') {
        logToConsole("Please click 'Start Session' first to enable continuous chewing.", 'warn');
        return;
    }

    if (appState.demoAutoChewId) {
        clearInterval(appState.demoAutoChewId);
        appState.demoAutoChewId = null;
        elements.btnSimContinuous.innerHTML = '<i data-lucide="repeat"></i> Auto-Chewing (70 CPM)';
        logToConsole("Continuous simulated chewing halted.", 'info');
    } else {
        // 70 CPM = approx every 850 ms a chew triggers
        appState.demoAutoChewId = setInterval(triggerSimulatedChew, 850);
        elements.btnSimContinuous.innerHTML = '<i data-lucide="square"></i> Stop Auto-Chewing';
        logToConsole("Continuous simulated chewing active (70 CPM).", 'success');
    }
    lucide.createIcons();
}

// Sandbox local command controller
function handleSimulatedControlCommand(cmd) {
    if (cmd === 'START') {
        appState.sessionState = 'ACTIVE';
        if (appState.chewCount === 0) {
            appState.sessionDuration = 0;
            appState.simLastChewTime = 0;
            appState.simAboveThreshold = false;
        }
        logToConsole("Simulated Session Started.", 'success');
    } else if (cmd === 'PAUSE') {
        appState.sessionState = 'PAUSED';
        logToConsole("Simulated Session Paused.", 'warn');
    } else if (cmd === 'RESET') {
        if (appState.chewCount > 0) {
            if (typeof saveSessionToHistory === 'function') {
                saveSessionToHistory(appState.chewCount, appState.chewRateCPM, appState.sessionDuration);
            }
        }
        appState.sessionState = 'IDLE';
        appState.chewCount = 0;
        appState.chewRateCPM = 0.0;
        appState.sessionDuration = 0.0;
        appState.logs = [];
        if (appState.demoAutoChewId) {
            clearInterval(appState.demoAutoChewId);
            appState.demoAutoChewId = null;
            elements.btnSimContinuous.innerHTML = '<i data-lucide="repeat"></i> Auto-Chewing (70 CPM)';
            lucide.createIcons();
        }
        logToConsole("Simulated Session Reset.", 'warn');
    }
    updateUIStates();
    updateDashboardMetrics();
}

// --- 9. VIEW CONTROLLER (GRAPHING & STATS UPDATE) ---

// Real-time canvas shift
function pushChartData(force, angle, sound) {
    chartForceData.push(force);
    chartForceData.shift();
    
    chartAngleData.push(angle);
    chartAngleData.shift();
    
    chartSoundData.push(sound);
    chartSoundData.shift();
    
    // Redraw graph (zero animations for low latency)
    telemetryChart.update('none');
}

// Perform beautiful HTML glow, pulse ring expansions upon chew detection
function triggerChewVisualEffects() {
    // Pulse animation rings
    elements.pulseRing.classList.remove('chew-trigger');
    void elements.pulseRing.offsetWidth; // Force CSS reflow
    elements.pulseRing.classList.add('chew-trigger');

    // Bounce Chew circle
    elements.chewCircle.classList.add('chewing');
    elements.chewIndicatorText.innerText = "CHEW DETECTED!";
    elements.chewIndicatorText.style.color = '#39ff14';

    setTimeout(() => {
        elements.chewCircle.classList.remove('chewing');
        elements.chewIndicatorText.innerText = "Chewing...";
        elements.chewIndicatorText.style.color = '';
    }, 400);
}

function updateDashboardMetrics() {
    // Format Numbers beautifully
    elements.valChews.innerText = String(appState.chewCount).padStart(3, '0');
    elements.valCpm.innerText = appState.chewRateCPM.toFixed(1);
    
    // Formatting session timer MM:SS.d
    const minutes = Math.floor(appState.sessionDuration / 60);
    const seconds = Math.floor(appState.sessionDuration % 60);
    const tenths = Math.floor((appState.sessionDuration * 10) % 10);
    
    const minStr = String(minutes).padStart(2, '0');
    const secStr = String(seconds).padStart(2, '0');
    
    elements.valTime.innerText = `${minStr}:${secStr}.${tenths}`;
    
    // CPM qualitative thresholds (rate status colors)
    let cpmStatusText = "Stationary";
    elements.rateStatus.style.color = '';
    
    if (appState.chewRateCPM > 0) {
        if (appState.chewRateCPM < 40) {
            cpmStatusText = "Slow/Under-chewing";
            elements.rateStatus.style.color = 'var(--warning-orange)';
        } else if (appState.chewRateCPM >= 40 && appState.chewRateCPM <= 90) {
            cpmStatusText = "Ideal Chewing Pace";
            elements.rateStatus.style.color = 'var(--primary-green)';
        } else {
            cpmStatusText = "Aggressive Chewing";
            elements.rateStatus.style.color = 'var(--danger-red)';
        }
    }
    elements.rateStatus.innerText = cpmStatusText;

    // Call live update for history & health score in real-time
    const isActive = ['ACTIVE', 'CHEWING', 'SWALLOW_CHECK', 'ALERT_TRIGGER'].includes(appState.sessionState);
    if (typeof window.updateLiveHealthScoreAndHistory === 'function') {
        window.updateLiveHealthScoreAndHistory(
            appState.chewCount,
            appState.chewRateCPM,
            appState.sessionDuration,
            isActive
        );
    }
}

// Sync buttons states based on session states
function updateUIStates() {
    const isConnected = appState.connectionMode !== 'none' || appState.demoModeActive;
    const isActive = ['ACTIVE', 'CHEWING', 'SWALLOW_CHECK', 'ALERT_TRIGGER'].includes(appState.sessionState);
    
    elements.btnStart.disabled = !isConnected || isActive;
    elements.btnPause.disabled = !isConnected || !isActive;
    
    const hasData = appState.chewCount > 0 || appState.sessionDuration > 0;
    const isSessionRunningOrPaused = isActive || appState.sessionState === 'PAUSED';
    elements.btnReset.disabled = !((isConnected && isSessionRunningOrPaused) || hasData);
    elements.btnApplyCal.disabled = !isConnected;
    
    // Export only if logs exist
    elements.btnExport.disabled = appState.logs.length === 0;

    // Badges
    elements.sessionBadge.innerText = appState.sessionState;
    elements.sessionBadge.className = 'badge';
    
    if (appState.sessionState === 'ACTIVE' || appState.sessionState === 'CHEWING') {
        elements.sessionBadge.classList.add('active');
        elements.chewIndicatorText.innerText = "Chewing...";
    } else if (appState.sessionState === 'SWALLOW_CHECK') {
        elements.sessionBadge.classList.add('calibrating');
        elements.chewIndicatorText.innerText = "Swallow Check...";
    } else if (appState.sessionState === 'ALERT_TRIGGER') {
        elements.sessionBadge.classList.add('paused');
        elements.chewIndicatorText.innerText = "Alert! Chew more!";
    } else if (appState.sessionState === 'PAUSED') {
        elements.sessionBadge.classList.add('paused');
        elements.chewIndicatorText.innerText = "Session Halted";
    } else {
        elements.chewIndicatorText.innerText = "Ready to start";
    }
}

// Set connection badge status
function updateConnectionStatus(state, text) {
    const dot = elements.connectionStatus.querySelector('.status-dot');
    const label = elements.connectionStatus.querySelector('.status-label');
    
    dot.className = 'status-dot';
    dot.classList.add(state);
    label.innerText = text;

    const connectWifiBtn = document.getElementById('connectWifiBtn');
    const picoWifiIp = document.getElementById('picoWifiIp');

    if (state === 'connected') {
        elements.btnConnectBle.disabled = true;
        elements.btnConnectUsb.disabled = true;
        if (connectWifiBtn && appState.connectionMode !== 'wifi') {
            connectWifiBtn.disabled = true;
        }
        if (picoWifiIp && appState.connectionMode !== 'wifi') {
            picoWifiIp.disabled = true;
        }
        elements.btnDisconnect.disabled = false;
    } else if (state === 'disconnected') {
        elements.btnConnectBle.disabled = false;
        elements.btnConnectUsb.disabled = false;
        if (connectWifiBtn) {
            connectWifiBtn.disabled = false;
        }
        if (picoWifiIp) {
            picoWifiIp.disabled = false;
        }
        elements.btnDisconnect.disabled = true;
    }
    updateUIStates();
}

// --- 10. EXPORT SESSION TO CSV ---
function exportToCSV() {
    if (appState.logs.length === 0) {
        logToConsole("No session telemetry log data to export.", 'warn');
        return;
    }

    logToConsole("Compiling CSV telemetry file for export...", 'info');
    
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Timestamp,Bite Force (FSR),Mandibular Angle (Flex),Acoustic Volume (Mic),Total Chews,Chewing Rate (CPM),Session Duration (s)\n";

    appState.logs.forEach(log => {
        const row = [
            `"${log.timestamp}"`,
            (log.force || 0).toFixed(0),
            (log.angle || 0).toFixed(0),
            (log.sound || 0).toFixed(0),
            log.chewsCount,
            log.cpm.toFixed(1),
            log.sessionDurationSec.toFixed(2)
        ].join(",");
        csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `biochew_session_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link); // Required for FF
    
    link.click();
    document.body.removeChild(link);
    logToConsole("Session telemetry data CSV exported successfully!", 'success');
}

// --- 11. BIOFEEDBACK HEALTHY EATING ALERTS ENGINE ---
function handleChewBiofeedback() {
    if (!isSessionActive()) return;

    const now = Date.now();
    const gapSinceLastChew = (now - appState.biofeedback.lastChewTime) / 1000; // in seconds

    if (appState.connectionMode === 'none') {
        // 1. Smart bite detection for local/simulation mode: If there was a gap of 2.5+ seconds between chews,
        // or if the warning alarm is currently sounding, we know this is a NEW bite!
        if (gapSinceLastChew >= 2.5 || appState.biofeedback.isWarningAlarmActive || appState.biofeedback.currentBiteChews === 0) {
            appState.biofeedback.currentBiteChews = 1;
            appState.biofeedback.perfectBiteTriggered = false;
            
            // Stop warning alarm instantly when they start their next bite
            if (appState.biofeedback.isWarningAlarmActive) {
                stopWarningAlarm();
            }
            logToConsole("[BIOFEEDBACK] New bite detected! Chew counter reset.", "info");
        } else {
            // Continue counting for the current bite
            appState.biofeedback.currentBiteChews++;
        }
    } else {
        // Hardware mode: chewCount is synchronized directly from hardware packets
        if (appState.biofeedback.isWarningAlarmActive) {
            stopWarningAlarm();
        }
    }
    appState.biofeedback.lastChewTime = now;

    const banner = document.getElementById('biofeedback-banner');
    const icon = document.getElementById('biofeedback-icon');
    const text = document.getElementById('biofeedback-text');

    // 2. Visual and audio updates based on count
    if (appState.biofeedback.currentBiteChews === 0) {
        if (banner && icon && text) {
            banner.className = 'biofeedback-banner info';
            icon.innerText = '💡';
            text.innerHTML = 'Ready to analyze your chewing. Start eating!';
        }
    } else if (appState.biofeedback.currentBiteChews === 32 && !appState.biofeedback.perfectBiteTriggered) {
        appState.biofeedback.perfectBiteTriggered = true;
        
        if (banner && icon && text) {
            banner.className = 'biofeedback-banner success';
            icon.innerText = '✅';
            text.innerHTML = '<strong>Bite Perfect!</strong> You can swallow now.';
        }
        
        playBeepChime('success');
        logToConsole("[BIOFEEDBACK] Bite Perfect! 32 chews reached.", "success");
    } else if (appState.biofeedback.currentBiteChews < 32) {
        if (banner && icon && text) {
            banner.className = 'biofeedback-banner info';
            icon.innerText = '🔄';
            text.innerHTML = `Active Bite: Chewed <strong>${appState.biofeedback.currentBiteChews}</strong> / 32 times. Keep chewing!`;
        }
    } else {
        // Chew count > 32 (keeps updating dynamically past 32 so it doesn't freeze!)
        if (banner && icon && text) {
            banner.className = 'biofeedback-banner success';
            icon.innerText = '✅';
            text.innerHTML = `<strong>Bite Perfect!</strong> Chewed <strong>${appState.biofeedback.currentBiteChews}</strong> times. You can swallow!`;
        }
    }
}

function startBiofeedbackMonitor() {
    setInterval(() => {
        if (!isSessionActive()) return;

        const now = Date.now();
        const timeSinceLastChew = (now - appState.biofeedback.lastChewTime) / 1000; // in seconds
        
        const banner = document.getElementById('biofeedback-banner');
        const icon = document.getElementById('biofeedback-icon');
        const text = document.getElementById('biofeedback-text');

        // Rule 1: Swallowed too early (stopped chewing for 3.5 seconds and chews < 32)
        if (timeSinceLastChew >= 3.5 && appState.biofeedback.currentBiteChews > 0) {
            if (appState.biofeedback.currentBiteChews < 32) {
                if (banner && icon && text) {
                    banner.className = 'biofeedback-banner warning';
                    icon.innerText = '🛑';
                    text.innerHTML = `<strong>Warning: Swallowed too early!</strong> You only chewed <strong>${appState.biofeedback.currentBiteChews}</strong> times. Chew at least 32 times for better digestion!`;
                }
                
                // Trigger repeating loud warning alarm
                playWarningAlarm();
                logToConsole(`[BIOFEEDBACK WARNING] Swallowed too early! Only chewed ${appState.biofeedback.currentBiteChews} times. Alarm activated.`, "error");
            } else {
                if (banner && icon && text) {
                    banner.className = 'biofeedback-banner info';
                    icon.innerText = '💡';
                    text.innerHTML = `Perfect bite registered (${appState.biofeedback.currentBiteChews} chews). Ready for your next bite!`;
                }
                logToConsole(`[BIOFEEDBACK] Bite successfully completed with ${appState.biofeedback.currentBiteChews} chews.`, "info");
            }
            
            // Reset state variables for next bite
            appState.biofeedback.currentBiteChews = 0;
            appState.biofeedback.perfectBiteTriggered = false;
        }
        
        // Rule 2: Idle reminder (no chew detected for 10 seconds and current bite is 0)
        if (timeSinceLastChew >= 10.0 && appState.biofeedback.currentBiteChews === 0 && !appState.biofeedback.isWarningAlarmActive) {
            if (text && !text.innerHTML.includes("Time for your next bite")) {
                if (banner && icon && text) {
                    banner.className = 'biofeedback-banner info';
                    icon.innerText = '🔔';
                    text.innerHTML = `<strong>Time for your next bite!</strong> Keep chewing for better health.`;
                }
                playBeepChime('reminder');
                logToConsole("[BIOFEEDBACK REMINDER] Idle for 10 seconds. Take your next bite!", "info");
            }
        }
    }, 1000);
}

// Warning Alarm Loops (plays constantly until they start the next bite)
function playWarningAlarm() {
    if (appState.biofeedback.isWarningAlarmActive) return;

    appState.biofeedback.isWarningAlarmActive = true;
    
    // Play the first beep immediately
    playBeepChime('warning_loud');

    // Repeat every 1.5 seconds
    appState.biofeedback.warningAlarmIntervalId = setInterval(() => {
        if (appState.biofeedback.isWarningAlarmActive && isSessionActive()) {
            playBeepChime('warning_loud');
        } else {
            stopWarningAlarm();
        }
    }, 1500);
}

function stopWarningAlarm() {
    if (appState.biofeedback.warningAlarmIntervalId) {
        clearInterval(appState.biofeedback.warningAlarmIntervalId);
        appState.biofeedback.warningAlarmIntervalId = null;
    }
    appState.biofeedback.isWarningAlarmActive = false;
    logToConsole("[BIOFEEDBACK] Warning alarm stopped. Keep chewing!", "success");
}

function playBeepChime(type) {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        const playTone = (freq, duration, synthType = 'sine', volume = 0.25) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.type = synthType;
            osc.frequency.value = freq;
            
            // Soft ramp out for clean synth sound
            gain.gain.setValueAtTime(volume, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.start();
            osc.stop(audioCtx.currentTime + duration);
        };
        
        if (type === 'success') {
            // High-pitched cheerful double beep chime
            playTone(880, 0.12, 'sine', 0.25);
            setTimeout(() => {
                playTone(1174.66, 0.25, 'sine', 0.25);
            }, 100);
        } else if (type === 'warning') {
            // Standard single warning beep
            playTone(293.66, 0.4, 'triangle', 0.35);
        } else if (type === 'warning_loud') {
            // 1-second long, high-volume repeating alert beep (sawtooth for clear attention)
            playTone(380, 1.0, 'sawtooth', 0.65); // 1-second duration, high volume (65%)
        } else if (type === 'reminder') {
            // Soft double chime reminder
            playTone(523.25, 0.15, 'sine', 0.20);
            setTimeout(() => {
                playTone(659.25, 0.22, 'sine', 0.20);
            }, 150);
        }
    } catch (e) {
        console.error("Audio synthesiser failed:", e);
    }
}
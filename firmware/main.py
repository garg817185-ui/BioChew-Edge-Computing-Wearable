import machine
from machine import Pin, I2C, ADC
import time
import math
import network
import socket
import hashlib
import binascii
import errno

# Setup standard errno fallbacks for MicroPython compatibility
EAGAIN = getattr(errno, 'EAGAIN', 11)
EWOULDBLOCK = getattr(errno, 'EWOULDBLOCK', 11)

# ==========================================
# 1. WI-FI & WEBSOCKET CONFIGURATION
# ==========================================
WIFI_SSID = "Anshul"        # <--- Apna Wi-Fi Name daalo
WIFI_PASS = "81718512"    # <--- Apna Wi-Fi Password daalo

status_led = Pin("LED", Pin.OUT)
status_led.off()

# Wi-Fi Connection
wlan = network.WLAN(network.STA_IF)
wlan.active(True)

# Disable Wi-Fi power saving mode to prevent high latency and random disconnections
try:
    # 0xa11140 is the standard constant for PM_NONE (High performance mode)
    wlan.config(pm=0xa11140)
    print("[WIFI] Power management disabled (PM_NONE).")
except Exception as pm_err:
    pass

print("[INFO] Connecting to Wi-Fi...")
wlan.connect(WIFI_SSID, WIFI_PASS)

timeout = 15
while not wlan.isconnected() and timeout > 0:
    status_led.toggle()
    time.sleep(0.5)
    timeout -= 0.5

if wlan.isconnected():
    pico_ip = wlan.ifconfig()[0]
    print("\n[SUCCESS] Connected! Pico W IP Address:", pico_ip)
    # 3 Baar blink matlab Wi-Fi Ready
    for _ in range(3):
        status_led.on()
        time.sleep(0.1)
        status_led.off()
        time.sleep(0.1)
else:
    pico_ip = "0.0.0.0"
    print("\n[ERROR] Wi-Fi Connection Failed.")

# Setup Dual HTTP/WebSocket Socket Server (Port 80)
server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    server_socket.bind(('0.0.0.0', 80))
    server_socket.listen(1)
    server_socket.setblocking(False) # Non-blocking taaki sampling loop na ruke
    print("[SUCCESS] Server listening on port 80 (Dual HTTP / WebSocket)")
except Exception as e:
    print("[ERROR] Server bind failed:", e)

# WebSocket Helper Functions
def calculate_ws_accept(key):
    GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
    accept_str = key + GUID
    sha1 = hashlib.sha1(accept_str.encode('utf-8')).digest()
    accept_b64 = binascii.b2a_base64(sha1).decode('utf-8').strip()
    return accept_b64

def send_ws_frame(socket_client, payload):
    payload_bytes = payload.encode('utf-8')
    length = len(payload_bytes)
    
    frame = bytearray()
    frame.append(0x81)  # Text frame, FIN
    
    if length < 126:
        frame.append(length)
    elif length <= 65535:
        frame.append(126)
        frame.append((length >> 8) & 0xFF)
        frame.append(length & 0xFF)
    else:
        frame.append(127)
        for i in range(7, -1, -1):
            frame.append((length >> (i * 8)) & 0xFF)
            
    frame.extend(payload_bytes)
    socket_client.send(frame)

def decode_ws_frame(data):
    if len(data) < 6:
        return None
    
    mask = data[1] & 0x80
    if not mask:
        return None  # Clients must mask frames
    
    length = data[1] & 0x7F
    offset = 2
    if length == 126:
        length = (data[2] << 8) | data[3]
        offset = 4
    elif length == 127:
        return None
        
    masking_key = data[offset:offset+4]
    offset += 4
    
    payload = data[offset:offset+length]
    unmasked = bytearray(len(payload))
    for i in range(len(payload)):
        unmasked[i] = payload[i] ^ masking_key[i % 4]
        
    try:
        return unmasked.decode('utf-8').strip()
    except Exception:
        return None

# ==========================================
# 2. HARDWARE CONFIGURATION
# ==========================================
# Initialize MPU6050 (I2C)
imu_available = False
i2c = None
MPU_ADDR = 0x68

try:
    # Try default pins GP4, GP5 on I2C0
    i2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400000)
    devices = i2c.scan()
    print("[I2C SCAN] Found devices:", devices)
    
    if MPU_ADDR not in devices and 0x69 in devices:
        MPU_ADDR = 0x69
        print("[I2C] MPU6050 found at address 0x69 instead of 0x68")
        
    if MPU_ADDR in devices:
        i2c.writeto_mem(MPU_ADDR, 0x6B, b'\x00') # Wake up
        imu_available = True
        print("[SUCCESS] MPU6050 Initialized on I2C0 (GP4/GP5)")
    else:
        print("[WARNING] MPU6050 not found on I2C0. Checking I2C1 on GP2/GP3...")
        try:
            i2c_alt = I2C(1, sda=Pin(2), scl=Pin(3), freq=400000)
            alt_devices = i2c_alt.scan()
            print("[I2C ALT SCAN] Found devices:", alt_devices)
            if MPU_ADDR in alt_devices or 0x69 in alt_devices:
                i2c = i2c_alt
                if 0x69 in alt_devices and MPU_ADDR not in alt_devices:
                    MPU_ADDR = 0x69
                i2c.writeto_mem(MPU_ADDR, 0x6B, b'\x00')
                imu_available = True
                print("[SUCCESS] MPU6050 Initialized on I2C1 (GP2/GP3)")
        except Exception as alt_err:
            print("[ERROR] Alt I2C setup failed:", alt_err)
except Exception as e:
    print("[ERROR] MPU6050 Initialization Failed:", e)

if not imu_available:
    print("[WARNING] Running in degraded mode: IMU (MPU6050) is unavailable. Falling back to FSR/Flex chew detection.")

# Initialize Analog Sensors (ADC)
try:
    flex_adc = ADC(Pin(26))       # GP26 (ADC0) - Mandibular Angle Tracker
    fsr_adc = ADC(Pin(27))        # GP27 (ADC1) - Occlusal Bite Force Transducer
    acoustic_adc = ADC(Pin(28))   # GP28 (ADC2) - Bone-Conductive Contact Mic
    print("[SUCCESS] Analog Sensors Initialized (Flex: GP26, FSR: GP27, Acoustic: GP28)")
except Exception as e:
    print("[ERROR] Analog Sensors Initialization Failed:", e)

# ==========================================
# 2.5. BASELINE SENSOR CALIBRATION (BOOT TIME)
# ==========================================
FSR_BASELINE = 800.0
FLEX_BASELINE = 8000.0
ACOUSTIC_BASELINE = 2000.0

print("[CALIB] Starting baseline calibration. Keep sensors completely still...")
fsr_samples = []
flex_samples = []
acoustic_samples = []

# Blink quickly during boot-time calibration (approx 1.5 seconds)
for _ in range(30):
    status_led.toggle()
    try:
        fsr_samples.append(fsr_adc.read_u16())
        flex_samples.append(flex_adc.read_u16())
        acoustic_samples.append(acoustic_adc.read_u16())
    except Exception:
        pass
    time.sleep_ms(50)

status_led.off()

if fsr_samples:
    FSR_BASELINE = sum(fsr_samples) / len(fsr_samples)
if flex_samples:
    FLEX_BASELINE = sum(flex_samples) / len(flex_samples)
if acoustic_samples:
    ACOUSTIC_BASELINE = sum(acoustic_samples) / len(acoustic_samples)

print("[CALIB] Baseline values -> FSR: {:.1f}, Flex: {:.1f}, Acoustic: {:.1f}".format(FSR_BASELINE, FLEX_BASELINE, ACOUSTIC_BASELINE))

# ==========================================
# 3. ALGORITHM CONFIGURATIONS & VARIABLES
# ==========================================
SAMPLE_INTERVAL_MS = 8  
CHEW_THRESHOLD = 0.40     # Gyro magnitude threshold in rad/s, lowered for better jaw sensitivity
DEBOUNCE_TIME_MS = 500   

# FSM State Constants
STATE_IDLE = 0
STATE_CHEWING = 1
STATE_SWALLOW_CHECK = 2
STATE_ALERT_TRIGGER = 3

# FSM Thresholds (relative to measured baselines)
# FSR ranges from ~800 to ~7000. A spike of 1200 is a perfect trigger.
FSR_CHEW_THRESHOLD = int(FSR_BASELINE + 1200)
# Near baseline: goes back towards baseline (e.g., +400)
FSR_NEAR_ZERO_THRESHOLD = int(FSR_BASELINE + 400)
SWALLOW_TIMEOUT_MS = 1200        # 1.2 seconds continuous duration
# Ingestion threshold for FSR (> baseline + 2500)
INGESTION_FSR_THRESHOLD = int(FSR_BASELINE + 2500)
# Flex ranges around 8000 and decreases on bend. Drop of 1500 indicates mouth open.
INGESTION_FLEX_THRESHOLD = int(FLEX_BASELINE - 1500)

print("[CALIB] Thresholds -> FSR Chew: {}, FSR Near Zero: {}, Ingestion FSR: {}, Ingestion Flex: {}".format(
    FSR_CHEW_THRESHOLD, FSR_NEAR_ZERO_THRESHOLD, INGESTION_FSR_THRESHOLD, INGESTION_FLEX_THRESHOLD
))

# TESTING CONFIGURATION
BYPASS_ANALOG_FOR_CHEW = False    # Set to False when physical FSR/Flex sensors are connected!

# DSP Moving Average Filter buffers
WINDOW_SIZE = 10
gyro_mag_buffer = [0.0] * WINDOW_SIZE
flex_buffer = [0.0] * WINDOW_SIZE
fsr_buffer = [0.0] * WINDOW_SIZE
acoustic_buffer = [0.0] * WINDOW_SIZE
buffer_index = 0

# FSM Variables
current_state = STATE_IDLE
chew_count = 0
last_chew_time = 0
swallow_check_start_time = 0
session_start_time = time.ticks_ms()

latest_signal = 0.0
filtered_flex = 0.0
filtered_fsr = 0.0
filtered_acoustic = 0.0

latest_packet = "{}" # Will hold the latest telemetry JSON

def get_average(buffer_list):
    return sum(buffer_list) / len(buffer_list)

# ==========================================
# 4. MAIN LOOP (DSP + Network Handling)
# ==========================================
last_sample_time = time.ticks_ms()
led_off_time = 0
led_active = False

ws_client = None
ws_handshake_done = False
ws_buffer = b""
new_packet_ready = False
wifi_send_counter = 0

while True:
    now = time.ticks_ms()
    
    if led_active and time.ticks_diff(now, led_off_time) >= 0:
        status_led.off()
        led_active = False

    # 1. MPU6050 Sampling (Strict 8ms)
    if time.ticks_diff(now, last_sample_time) >= SAMPLE_INTERVAL_MS:
        last_sample_time = now
        try:
            raw_gyro_mag = 0.0
            if imu_available:
                try:
                    # Read MPU6050 Gyro
                    data = i2c.readfrom_mem(MPU_ADDR, 0x3B, 14)
                    def scale_data(high, low):
                        val = (high << 8) | low
                        return val if val < 32768 else val - 65536

                    gx = (scale_data(data[8], data[9]) / 131.0) * (math.pi / 180.0)
                    gy = (scale_data(data[10], data[11]) / 131.0) * (math.pi / 180.0)
                    gz = (scale_data(data[12], data[13]) / 131.0) * (math.pi / 180.0)
                    
                    raw_gyro_mag = math.sqrt(gx*gx + gy*gy + gz*gz)
                except Exception as imu_err:
                    pass
            
            # 2. Read Analog ADC channels (0 - 65535 raw)
            raw_flex = flex_adc.read_u16()
            raw_fsr = fsr_adc.read_u16()
            raw_acoustic = acoustic_adc.read_u16()
            
            # 3. DSP Moving Average Filters (rolling 10-sample windows)
            gyro_mag_buffer[buffer_index] = raw_gyro_mag
            flex_buffer[buffer_index] = raw_flex
            fsr_buffer[buffer_index] = raw_fsr
            acoustic_buffer[buffer_index] = raw_acoustic
            buffer_index = (buffer_index + 1) % WINDOW_SIZE
            
            # Compute rolling averages
            latest_signal = get_average(gyro_mag_buffer)
            filtered_flex = get_average(flex_buffer)
            filtered_fsr = get_average(fsr_buffer)
            filtered_acoustic = get_average(acoustic_buffer)
            
            # 4. FSM Logic & State Transitions
            chew_detected = False
            
            # Determine if motion (IMU Gyro) trigger condition is met
            # If IMU is not available, we bypass gyro checks and rely solely on FSR/Flex
            motion_trigger = (latest_signal >= CHEW_THRESHOLD) if imu_available else True
            motion_quiet = (latest_signal < CHEW_THRESHOLD) if imu_available else True
            
            # Continuous monitoring for next food ingestion (active only in STATE_ALERT_TRIGGER)
            # Flex decreases when mouth is open (bent), so we check if it is less than the threshold
            if current_state == STATE_ALERT_TRIGGER:
                if filtered_fsr > INGESTION_FSR_THRESHOLD or filtered_flex < INGESTION_FLEX_THRESHOLD:
                    current_state = STATE_CHEWING
                    chew_count = 0
                    last_chew_time = now
                    swallow_check_start_time = 0
                    print("[FSM] Ingestion detected! Resetting chew count, forcing STATE_CHEWING.")
            
            elif current_state == STATE_IDLE:
                # Idle state waiting for eating behavior to begin
                if motion_trigger and (BYPASS_ANALOG_FOR_CHEW or filtered_fsr >= FSR_CHEW_THRESHOLD):
                    if time.ticks_diff(now, last_chew_time) >= DEBOUNCE_TIME_MS:
                        current_state = STATE_CHEWING
                        chew_count = 1
                        last_chew_time = now
                        session_start_time = now
                        chew_detected = True
                        print("[FSM] Chew detected (IDLE -> CHEWING). Count=1")
            
            elif current_state == STATE_CHEWING:
                # Active chewing state
                if motion_trigger and (BYPASS_ANALOG_FOR_CHEW or filtered_fsr >= FSR_CHEW_THRESHOLD):
                    if time.ticks_diff(now, last_chew_time) >= DEBOUNCE_TIME_MS:
                        chew_count += 1
                        last_chew_time = now
                        chew_detected = True
                        print("[FSM] Chew detected. Count =", chew_count)
                
                # Check for transition to Swallow Check
                elif motion_quiet and (BYPASS_ANALOG_FOR_CHEW or filtered_fsr < FSR_NEAR_ZERO_THRESHOLD):
                    current_state = STATE_SWALLOW_CHECK
                    swallow_check_start_time = now
                    print("[FSM] Signals dropped below threshold. Starting Swallow Check.")
            
            elif current_state == STATE_SWALLOW_CHECK:
                # Check if activity resumed
                if motion_trigger or (not BYPASS_ANALOG_FOR_CHEW and filtered_fsr >= FSR_NEAR_ZERO_THRESHOLD):
                    current_state = STATE_CHEWING
                    # If this is a valid chew, increment count
                    if motion_trigger and (BYPASS_ANALOG_FOR_CHEW or filtered_fsr >= FSR_CHEW_THRESHOLD):
                        if time.ticks_diff(now, last_chew_time) >= DEBOUNCE_TIME_MS:
                            chew_count += 1
                            last_chew_time = now
                            chew_detected = True
                            print("[FSM] Chew detected in Swallow Check! Count =", chew_count)
                    else:
                        print("[FSM] Activity resumed. Returning to STATE_CHEWING.")
                else:
                    # Signals remain low, check timeout
                    if time.ticks_diff(now, swallow_check_start_time) >= SWALLOW_TIMEOUT_MS:
                        print("[FSM] Virtual Swallowing Event inferred!")
                        if chew_count < 32:
                            current_state = STATE_ALERT_TRIGGER
                            print("[FSM] chew_count =", chew_count, "< 32. Transitioning to STATE_ALERT_TRIGGER.")
                        else:
                            current_state = STATE_IDLE
                            chew_count = 0
                            print("[FSM] chew_count =", chew_count, ">= 32. Resetting to STATE_IDLE.")
            
            # Blink LED when chew is detected (visual verification helper)
            if chew_detected:
                status_led.on()
                led_active = True
                led_off_time = time.ticks_add(now, 150)
            
            # 5. Down-sampled Telemetry Packet (~42Hz)
            wifi_send_counter += 1
            if wifi_send_counter >= 3:
                wifi_send_counter = 0
                latest_packet = (
                    '{{"chews":{},"force":{:.1f},"angle":{:.1f},"sound":{:.1f},"gyro":{:.2f},"imu_ok":{},"state":{}}}\n'
                ).format(
                    chew_count, filtered_fsr, filtered_flex, filtered_acoustic, latest_signal, 1 if imu_available else 0, current_state
                )
                new_packet_ready = True
        except Exception as err:
            print("[ERROR] Sampling failed:", err)

    # 2. Network Handling (Dual HTTP & WebSocket Server)
    if ws_client is not None and ws_handshake_done:
        # Stream live data frames to the active WebSocket client
        if new_packet_ready:
            try:
                send_ws_frame(ws_client, latest_packet)
                new_packet_ready = False
            except OSError as e:
                # Catch EAGAIN, EWOULDBLOCK, and standard buffer full codes (e.g., ENOBUFS=105 or 12 in MicroPython)
                if e.args[0] in (EAGAIN, EWOULDBLOCK, 105, 12):
                    # Buffer temporarily saturated, skip this single frame and keep connection alive
                    pass
                else:
                    print("[WIFI] Stream send error, closing socket:", e)
                    ws_client.close()
                    ws_client = None
                    ws_handshake_done = False
        
        # Read commands from WebSocket
        try:
            data = ws_client.recv(1024)
            if data:
                # Inspect opcode (lower 4 bits of first byte)
                opcode = data[0] & 0x0F
                if opcode == 0x08:
                    print("[WIFI] WebSocket Close frame received from client.")
                    ws_client.close()
                    ws_client = None
                    ws_handshake_done = False
                else:
                    cmd_str = decode_ws_frame(data)
                    if cmd_str:
                        print(f"[WIFI CONTROL] Received command: {cmd_str}")
                        if cmd_str == "START":
                            current_state = STATE_CHEWING
                            session_start_time = time.ticks_ms()
                        elif cmd_str == "PAUSE":
                            current_state = STATE_IDLE
                        elif cmd_str == "RESET":
                            current_state = STATE_IDLE
                            chew_count = 0
                            session_start_time = time.ticks_ms()
                            last_chew_time = 0
                            swallow_check_start_time = 0
                        elif cmd_str.startswith("CAL:"):
                            try:
                                cal_payload = cmd_str[4:]
                                parts = cal_payload.split(',')
                                if len(parts) >= 2:
                                    CHEW_THRESHOLD = float(parts[0])
                                    DEBOUNCE_TIME_MS = int(parts[1])
                                    print(f"[CALIB] Settings updated via Wi-Fi: Threshold={CHEW_THRESHOLD} rad/s, Debounce={DEBOUNCE_TIME_MS} ms")
                            except Exception as cal_err:
                                print("[WIFI ERROR] Calibration command parse error:", cal_err)
            else:
                print("[WIFI] WebSocket connection closed by client.")
                ws_client.close()
                ws_client = None
                ws_handshake_done = False
        except OSError as e:
            if e.args[0] not in (EAGAIN, EWOULDBLOCK):
                print("[WIFI] Client read error, disconnecting:", e)
                ws_client.close()
                ws_client = None
                ws_handshake_done = False
    else:
        # No active WebSocket client, listen for new incoming connections (Dual HTTP/WS)
        try:
            conn, addr = server_socket.accept()
            
            # Read incoming request bytes (blocking read to guarantee headers are loaded)
            req_buffer = b""
            try:
                # Set a 1-second timeout to prevent blocking MPU6050 indefinitely
                conn.settimeout(1.0)
                data = conn.recv(1024)
                if data:
                    req_buffer += data
            except OSError:
                pass
                
            if req_buffer:
                request = req_buffer.decode('utf-8', 'ignore')
                
                # Check if it's a WebSocket Upgrade handshake request
                if "upgrade: websocket" in request.lower():
                    headers = request.split("\r\n")
                    ws_key = None
                    for header in headers:
                        if header.lower().startswith("sec-websocket-key:"):
                            ws_key = header.split(":", 1)[1].strip()
                            break
                    
                    if ws_key:
                        accept_key = calculate_ws_accept(ws_key)
                        response = (
                            "HTTP/1.1 101 Switching Protocols\r\n"
                            "Upgrade: websocket\r\n"
                            "Connection: Upgrade\r\n"
                            "Sec-WebSocket-Accept: {}\r\n\r\n"
                        ).format(accept_key)
                        conn.send(response.encode('utf-8'))
                        print(f"[WIFI] WebSocket Handshake successful with {addr}!")
                        
                        # Now switch to non-blocking mode for the telemetry stream loop
                        conn.setblocking(False)
                        ws_client = conn
                        ws_handshake_done = True
                        ws_buffer = b""
                        new_packet_ready = False
                    else:
                        conn.close()
                else:
                    # Regular HTTP Fetch Request (CORS supported!)
                    response = "HTTP/1.1 200 OK\r\n"
                    response += "Content-Type: application/json\r\n"
                    response += "Access-Control-Allow-Origin: *\r\n"
                    response += "Access-Control-Allow-Headers: *\r\n"
                    response += "Connection: close\r\n\r\n"
                    response += latest_packet
                    conn.send(response.encode('utf-8'))
                    conn.close()
            else:
                conn.close()
        except OSError as e:
            if e.args[0] not in (EAGAIN, EWOULDBLOCK):
                print("[WIFI] Accept/read error:", e)

    # prevent loop from pegging CPU core completely
    time.sleep_ms(1)
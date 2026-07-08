# Helpers for generating BLE advertising payloads.
# Adapted for MicroPython on Raspberry Pi Pico W.

import struct

# Advertising payloads are binary data. The payload is a sequence of AD structures:
# length (1 byte) | AD Type (1 byte) | AD Data (length - 1 bytes)

_ADV_TYPE_FLAGS = 0x01
_ADV_TYPE_NAME = 0x09
_ADV_TYPE_UUID16_COMPLETE = 0x03
_ADV_TYPE_UUID32_COMPLETE = 0x05
_ADV_TYPE_UUID128_COMPLETE = 0x07
_ADV_TYPE_UUID16_MORE_AVAILABLE = 0x02
_ADV_TYPE_UUID128_MORE_AVAILABLE = 0x06
_ADV_TYPE_APPEARANCE = 0x19

def advertising_payload(limited_disc=False, br_edr_supported=False, name=None, services=None, appearance=None):
    payload = bytearray()

    def append(adv_type, value):
        nonlocal payload
        payload.append(len(value) + 1)
        payload.append(adv_type)
        payload.extend(value)

    flags = (0x01 if limited_disc else 0x02)
    if not br_edr_supported:
        flags |= 0x04
    append(_ADV_TYPE_FLAGS, struct.pack("<B", flags))

    if name:
        append(_ADV_TYPE_NAME, name.encode("utf-8"))

    if services:
        for uuid in services:
            b = bytes(uuid)
            if len(b) == 2:
                append(_ADV_TYPE_UUID16_COMPLETE, b)
            elif len(b) == 4:
                append(_ADV_TYPE_UUID32_COMPLETE, b)
            elif len(b) == 16:
                # Web BLE and standard BLE GATT services typically expect little endian layout for UUIDs in advertisements
                append(_ADV_TYPE_UUID128_COMPLETE, b)

    if appearance is not None:
        append(_ADV_TYPE_APPEARANCE, struct.pack("<H", appearance))

    return payload

def decode_uuid(data):
    # Decode little-endian UUID from bytes
    if len(data) == 2:
        return struct.unpack("<H", data)[0]
    elif len(data) == 4:
        return struct.unpack("<I", data)[0]
    elif len(data) == 16:
        return bytes(reversed(data))
    return None

# A stand-in for the sensor board on a pseudo-terminal: prints the port's path,
# then writes one JSON line like the chip's every 50 ms until killed.
# Used by scripts/e2e.ts to hammer the hub while it switches missions.
import os, pty, select, sys, time, json, random
master, slave = pty.openpty()
print(os.ttyname(slave), flush=True)
chip = sys.argv[1] if len(sys.argv) > 1 else 'cabin-1'
while True:
    line = {"chip": chip, "r": [["co2", round(1.0 + random.random() * 0.2, 2), "mmHg", "m"], ["temperature", round(22 + random.random(), 1), "C", "m"]], "missing": []}
    try:
        os.write(master, (json.dumps(line) + "\n").encode())
    except OSError:
        pass
    r, _, _ = select.select([master], [], [], 0.05)
    if r:
        try: os.read(master, 4096)
        except OSError: pass

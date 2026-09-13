# Diagnose the observed failure

Preserve the failing command, input identity, exit code and useful log excerpt before
editing. Use the smallest next observation; avoid a full clean or SDK replacement
unless the evidence points to stale configuration or an incompatible installation.

| Symptom | Next observation / recovery |
|---|---|
| Tool missing | Check active SDK export environment and target tool installation; do not silently install a different release. |
| Compile/link failure | Read the first relevant compiler/linker diagnostic, component dependencies and selected configuration; rebuild the affected project. |
| Port missing | Verify the selected device, data cable, USB interface and actual port name. Do not switch to a different connected board automatically. |
| Port busy | Identify the owning monitor/debug session; release it through its owner. Bounded wait ends as busy. |
| Flash timeout/disconnect | Preserve the uncertain result; reconnect and inspect chip/boot state before retry. Never use erase-all as default repair. |
| Panic/reset | Preserve the matching ELF/map and boot log; decode with the pinned SDK's IDF Monitor/core-dump tools. Check watchdog, stack and heap evidence as relevant. |
| Indexer error, build succeeds | Refresh compiler database and target language-server configuration; preserve actual build flags. |

## Hardware debugger

Confirm whether the exact board exposes built-in USB JTAG or requires an external
probe and wiring. A USB serial connector alone does not establish JTAG capability.
Use Espressif OpenOCD, the target's GDB, board/probe configuration and matching ELF.
Pin tool paths through the selected SDK rather than tutorial-specific version strings.
Terminate only owned debugger/server processes and release device ownership at exit.
Do not assume persistent sessions are reliable on an untested board.

Prove the recipe by hitting a known breakpoint, inspecting a value, resuming and
releasing the connection. For crash localization, inject a controlled development
fault and match the decoded source location. A log-only diagnostic check does not
count as a hardware debugger test. Inspect native `idf.py size` output before setting
a meaningful board/application memory budget; do not invent a universal threshold.

## Hardware-independent checks

Build-only CI validates compilation/configuration and artifact sizes. Native unit
tests or [Espressif QEMU](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/tools/qemu.html)
can exercise supported software behavior. Match target/peripheral support first.
Neither substitutes for selected-device boot, radio behavior, timing, power, wiring,
or ten observed physical stimulus/response cycles. Record unavailable checks as such.

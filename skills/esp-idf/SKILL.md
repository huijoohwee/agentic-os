---
name: esp-idf
description: Develop and diagnose ESP32-family firmware with the native ESP-IDF toolchain, including project setup, build, selected-device flash, serial evidence, and optional editor/debugger configuration.
---

# ESP-IDF firmware development

Use the user's firmware project and pinned SDK as build authority. This skill is an
on-demand instruction asset; it requires neither the Agentic OS runtime nor an IDE.
The host supplies file and process tools. Discover their actual interface instead of
inventing a firmware MCP endpoint. Use existing authorized scope for local work.

## Establish the project and board contract

Read the project's instructions, CMake/component manifests, SDK pin, configuration
defaults, partition settings and existing tests. Distinguish chip target from board:
record the board revision, flash size, USB interface, pinout and intended behavior.
If hardware is unidentified, continue build-only work with a labelled compile target;
do not guess an LED GPIO, select an arbitrary serial device, or claim physical proof.

Inspect `IDF_PATH`, `idf.py`, Python environment, CMake, Ninja and target compiler.
Missing PATH entries can mean an inactive installation. Activate the selected SDK
with its documented export script; report missing prerequisites before installing.
Use the official example/BSP matching the identified hardware. Pin SDK/component
versions and retain the native component lock; never copy a whole legacy IDE plugin.

## Run the smallest native loop

Use explicit project and build paths, one target/configuration per build directory,
and argument arrays through the host's process tool. Reuse incremental builds.
Typical native actions are `idf.py build`, `menuconfig`, `size`, `flash`, and `monitor`.
Do not run `set-target` on every edit: it can invalidate configuration/build state.
Read the pinned SDK's documentation for release-specific arguments.

Before flash, match the intended device and target to the exact successful build.
Retain source/working-diff identity, SDK version, configuration and dependency-lock
hashes, and binary/ELF/map hashes. Capture tool exit codes and actual boot output.
If the project already provides a checked runner, reuse it rather than introducing
another wrapper or persistent service. Plain native CLI operation remains available.

Serialize flash, monitor and debug access to each device. Release owned processes
and ports on completion/cancellation; do not kill another owner's monitor. Separate
Monitor from Flash so observing logs does not silently change firmware. Use bounded
automated operations: initial ceilings are 10 minutes build, 120 seconds flash,
60 seconds capture and 30 seconds contention wait, adjusted from actual board needs.
After a timeout/disconnect during flash, inspect the board before deciding to retry.
Stop after three repair attempts, or two identical failures without new evidence.

Check a boot identity/marker and the specified physical response separately. Mocks,
emulator output and serial heartbeat logs are not physical peripheral evidence.
Keep bounded logs local; review application data before sharing them. Do not erase
the whole device, change security eFuses, or enable fleet OTA as routine recovery.

## Load details only when needed

- [Editors and navigation](references/editors.md): an existing editor, compiler
  database, or parity issue; keep native compilation authoritative.
- [Debugging and failures](references/debugging.md): build/port failures, crashes,
  source symbolization or an explicitly supported hardware debugger.

Report the changed source, exact successful checks, failed checks and missing board
evidence. A successful compile is build proof; a reusable procedure becomes proven
only after real device use and repeat-checkout evidence. This skill supplies no
external publication, purchasing or hardware-provisioning authority.

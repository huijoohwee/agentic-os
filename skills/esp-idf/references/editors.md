# Optional editors and navigation

Keep one firmware project, SDK pin, target, component lock and configuration source.
Use the current editor already preferred by the developer. An editor is optional;
native ESP-IDF and a FOSS text editor provide the full fallback.

## CLion

Follow the [current integration guide](https://www.jetbrains.com/help/clion/esp-idf.html).
Open the **application** CMake project. Configure the toolchain with that SDK's
environment script and set the same target, SDKCONFIG and build directory used by
the native command. Use one active build writer per directory. Store machine paths,
serial ports and local preferences outside shared source.

Reuse native build/flash/menuconfig/size actions. Give monitoring its own action
without a flash step. CLion 2026.2 uses
[Debug Profiles](https://www.jetbrains.com/help/clion/debug-servers.html); older
tutorials use a removed Debug Servers settings page. Select the installed version's
instructions and the actual board/probe rather than copying a tutorial's pin/path.
The IDE is proprietary; existing appropriate entitlement is an optional choice,
not a dependency of this skill. No purchase is selected.

## VS Code

Use the [official ESP-IDF extension](https://docs.espressif.com/projects/vscode-esp-idf-extension/en/latest/)
for SDK selection, project configuration, Doctor diagnostics and native actions.
Select the same SDK and configuration as the shell. Avoid adding another SDK install
just because the editor did not discover the existing one. Optional AI/chat features
are unnecessary for the local build/flash loop.

## Compiler metadata and parity

Run native reconfiguration to produce the selected build's `compile_commands.json`.
Configure one language server/indexer to consume it, with the target compiler from
that pinned SDK. Regenerate metadata after target/component/configuration changes.
Never edit firmware compile flags to silence an indexer's unsupported-flag warning;
use a version-appropriate indexer configuration and preserve the native database.
Do not commit generated indexes containing absolute machine paths.

Verify one component definition resolves. Compare editor and shell SDK commit,
target, SDKCONFIG, dependency lock and artifact locations for the same build profile.
Separate profiles may use different output directories, but never conflicting
writers. A green editor diagnostic panel does not substitute for a compiler result.

The historical [paoloach/ESP32 plugin](https://github.com/paoloach/ESP32/blob/e5be05f1baea4a40ab81d0b1fc8e7756ee34c6f9/build.gradle)
targets CLion 2020.3. Borrow its setup/action grouping, not its implementation.
PlatformIO adds a package/build environment owner; adopt it only for a demonstrated
need after checking the exact platform-to-SDK mapping and maintenance cost.

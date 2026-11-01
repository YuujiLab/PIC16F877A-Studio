# PIC16F877A Studio - Architecture Simulator & MPASM Engine

*Maintained by **[Yuuji Lab](https://github.com/YuujiLab)**.*

Live Application: **[pic16.yuujilab.com](https://pic16.yuujilab.com)**

## 1. Overview

This repository contains the cycle-accurate hardware emulator, two-pass MPASM assembler, and interactive visual circuit simulator for the **Microchip PIC16F877A** 8-bit mid-range microcontroller.

The implementation is engineered entirely from silicon specifications (Microchip DS39582B), providing an exact instruction-level execution pipeline, hardware banking logic with Common RAM aliasing, precise ALU flag conventions, and a responsive web development environment built with React, Vite, and TypeScript.

## 2. Microcontroller Specifications

- **Target Architecture:** PIC16 Mid-Range (14-bit Program Word, 8-bit Data Path)
- **Program Memory (Flash):** 8,192 words (8K x 14 bits), addressing range `0x0000` to `0x1FFF`
- **Data Memory (SRAM):** 512 bytes total across 4 banks (`0x000` to `0x1FF`), 368 bytes General Purpose RAM
- **Common RAM:** 16 bytes (`0x70` to `0x7F`) mirrored across all 4 banks
- **Hardware Stack:** 8-level deep circular push/pop hardware stack
- **Instruction Cycle Timing:** $T_{CY} = 4 / F_{OSC}$ (1 instruction cycle = 4 oscillator clocks; 1 µs per instruction at 4 MHz)
- **Interrupts:** Reset vector at `0x0000`, Interrupt vector at `0x0004`
- **I/O Ports:** PORTA (6-bit), PORTB (8-bit), PORTC (8-bit), PORTD (8-bit), PORTE (3-bit) with bidirectional TRIS control

## 3. Core Engine Architecture

### 3.1 Instruction Set & ALU Implementation
The CPU core (`src/core/pic16_cpu.ts`) implements all 35 mid-range RISC instructions categorized into:
- **Byte-Oriented Operations:** `ADDWF`, `ANDWF`, `CLRF`, `CLRW`, `COMF`, `DECF`, `DECFSZ`, `INCF`, `INCFSZ`, `IORWF`, `MOVF`, `MOVWF`, `NOP`, `RLF`, `RRF`, `SUBWF`, `SWAPF`, `XORWF`.
- **Bit-Oriented Operations:** `BCF`, `BSF`, `BTFSC`, `BTFSS`.
- **Literal Operations:** `ADDLW`, `ANDLW`, `IORLW`, `MOVLW`, `RETLW`, `SUBLW`, `XORLW`.
- **Control Operations:** `CALL`, `GOTO`, `RETURN`, `RETFIE`, `SLEEP`, `CLRWDT`.

#### Inverted Borrow Convention
In accordance with Microchip mid-range architecture, subtraction uses two's complement addition with an inverted borrow indicator:
- **Carry Flag ($C$):** Cleared ($C=0$) if a borrow occurred ($f < W$ or $k < W$), and set ($C=1$) if no borrow occurred ($f \ge W$ or $k \ge W$).
- **Digit Carry Flag ($DC$):** Cleared ($DC=0$) if a half-borrow occurred on low nibble bits 3:0, and set ($DC=1$) if no half-borrow occurred.
- **Zero Flag ($Z$):** Set ($Z=1$) if the result equals `0x00`.

### 3.2 Memory Banking & Physical Address Resolution
The PIC16F877A maps registers into four 128-byte banks selected via `STATUS<RP1:RP0>`:
- **Special Function Registers (SFR):** Core registers (`INDF`, `PCL`, `STATUS`, `FSR`, `PCLATH`, `INTCON`) are mirrored across Banks 0, 1, 2, and 3.
- **Common RAM Aliasing:** In accordance with DS39582B Figure 2-3, addresses `0x70–0x7F`, `0xF0–0xFF`, `0x170–0x17F`, and `0x1F0–0x1FF` resolve to the identical 16 physical storage bytes regardless of active bank selection.
- **Indirect Addressing (`INDF` & `FSR`):** When accessing address `0x00`, the core evaluates the 8-bit pointer in `FSR`, combined with `STATUS<IRP>` for Bank 0/1 (`IRP=0`) vs Bank 2/3 (`IRP=1`) resolution.

### 3.3 Hardware Call Stack & Execution Timing
- The circular 8-level stack maintains top-of-stack indices. Stack overflow wraps to index 0, matching physical mid-range hardware behavior.
- Single-cycle instructions execute in 1 $T_{CY}$.
- Two-cycle operations (`GOTO`, `CALL`, `RETURN`, `RETLW`, and skipped conditions `BTFSS`, `BTFSC`, `DECFSZ`, `INCFSZ`) execute in 2 $T_{CY}$.

## 4. Assembler Subsystem

The embedded assembler (`src/core/pic16_asm.ts`) implements a complete two-pass MPASM-compatible compilation pipeline:

1. **Pass 1 (Symbol Table & Macro Expansion):**
   - Strips single-line comments (`;`) and trailing whitespace.
   - Evaluates origin declarations (`ORG <addr>`) and equates (`<label> EQU <value>`).
   - Allocates general-purpose RAM addresses via `CBLOCK <start> ... ENDC` blocks.
   - Resolves labels with or without colons, including column-0 labels.
   - Filters assembler metadata directives (`LIST`, `#INCLUDE`, `__CONFIG`, `__IDLOCS`).

2. **Pass 2 (Opcode Emission):**
   - Translates mnemonics and operands into 14-bit mid-range machine code words.
   - Resolves destination designators (`d = 0` for `W`, `d = 1` for `F`).
   - Maps 7-bit direct RAM file register addresses (`0x00–0x7F`).
   - Validates branch target ranges (`GOTO` / `CALL` 11-bit address masks).

3. **Intel HEX Output:**
   - Produces standard Record Type 00 (Data) and Record Type 01 (End of File) Intel HEX streams.
   - Formats address offsets, byte counts, two-byte low-endian words, and checksum validations suitable for physical PIC programmers (e.g., PICkit, TL866).

## 5. Virtual Circuit & Interface Architecture

The simulator interface is developed with React 18, Vite 6, and TypeScript:

- **Bidirectional GPIO Engine:** Reads and writes to `PORTB` and `PORTD` respect the direction latches in `TRISB` and `TRISD`. Output pins display logic levels; input pins resolve external stimuli from virtual push-buttons.
- **Visual LED Arrays:** Real-time LED states with luminescent neon glow shaders for logic high (`1`) and idle off (`0`).
- **Active Instruction Pointer:** Associates program counter values (`PC`) back to source code lines in the editor, providing execution tracing.
- **Speed Scaler:** Supports stepped tracing (10 Hz, 60 Hz), high speed (10 kHz), and frame-batched real-time execution (500 kHz / 1 MHz) to simulate 4 MHz crystal delays at true human eye clock speed.
- **Responsive Workspace:** Desktop split-screen layout with automated tabbed viewport switching for mobile devices and tablets.

## 6. Verification & Datasheet Compliance

The simulation engine has been tested against Microchip DS39582B specifications across 25 automated unit and stress test suites:

- Exhaustive execution verification of all 35 mid-range opcodes.
- ALU borrow and digit carry validations against 8-bit subtraction truth tables.
- Common RAM mirroring across all bank combinations (`0x70`, `0xF0`, `0x170`, `0x1F0`).
- Bank-independent GPIO pin state reads during active I/O bank switching.
- Hardware stack unwinding across nested `CALL` / `RETURN` execution trees.
- Assembly verification of multi-nested delay loops and counter logic.

## 7. License

This software is released under the **PolyForm Noncommercial License 1.0.0**.

- **Educational Institutions:** Universities, schools, and educational platforms may freely utilize, teach, and demonstrate this software.
- **Personal & Research Use:** Personal study, academic research, experimentation, and hobby pursuits are permitted.
- **Commercial Use:** Any commercial distribution, closed-source integration, or monetized deployment is strictly prohibited without prior written permission from the licensor.

See the full [LICENSE](LICENSE) text for complete terms.

Copyright &copy; 2026 Yuuji Lab. All rights reserved.

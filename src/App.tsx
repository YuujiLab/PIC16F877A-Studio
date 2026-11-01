import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Pause,
  StepForward,
  RotateCcw,
  Cpu,
  Download,
  BookOpen,
  Gauge,
  FileCode,
  Terminal,
  Trash2,
  Globe,
  Smartphone,
  Radio,
  Sliders,
  Activity,
  Database,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronRight
} from 'lucide-react';
import { PIC16F877A } from './core/pic16_cpu';
import { Assembler, AssemblerError } from './core/pic16_asm';
import { EXAMPLES } from './core/examples';

export default function App() {
  const [cpu] = useState(() => new PIC16F877A());
  const [asm] = useState(() => new Assembler());

  const [sourceCode, setSourceCode] = useState(EXAMPLES["06_course_blink.asm"]);
  const [lastAssembledCode, setLastAssembledCode] = useState<string | null>(null);
  const [selectedExample, setSelectedExample] = useState("06_course_blink.asm");
  const [speedHz, setSpeedHz] = useState(500000); // 500 kHz default (Real-Time 4MHz)
  const [isRunning, setIsRunning] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [codeMap, setCodeMap] = useState<Record<number, number>>({});

  // Mobile viewport state & tab switching
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 860);
  const [mobileTab, setMobileTab] = useState<'editor' | 'hardware'>('editor');

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 860);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // CPU display states
  const [w, setW] = useState(0);
  const [pc, setPc] = useState(0);
  const [bank, setBank] = useState(0);
  const [cycles, setCycles] = useState(0);
  const [statusFlags, setStatusFlags] = useState({ IRP: false, RP1: false, RP0: false, TO: false, PD: false, Z: false, DC: false, C: false });
  const [stack, setStack] = useState<number[]>([]);
  const [portB, setPortB] = useState({ latch: 0, tris: 0xFF, pins: 0xFF });
  const [portD, setPortD] = useState({ latch: 0, tris: 0xFF, pins: 0xFF });
  const [ramWatch, setRamWatch] = useState<Record<string, number>>({});
  const [activeLine, setActiveLine] = useState<number | null>(null);

  // Button input states
  const [btnRb0Pressed, setBtnRb0Pressed] = useState(false);
  const [btnRa0Pressed, setBtnRa0Pressed] = useState(false);
  const [btnRd0Pressed, setBtnRd0Pressed] = useState(false);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const runTimerRef = useRef<any>(null);

  // Check if current editor code differs from what is assembled in CPU
  const isDirty = sourceCode !== lastAssembledCode;

  // Update React states from CPU hardware
  const refreshUi = useCallback(() => {
    setW(cpu.w);
    setPc(cpu.pc);
    setBank(cpu.getCurrentBank());
    setCycles(cpu.cycles);
    setStack([...cpu.stack]);

    const status = cpu.readRamDirect(PIC16F877A.STATUS_ADDR);
    setStatusFlags({
      IRP: (status & PIC16F877A.STATUS_IRP) !== 0,
      RP1: (status & PIC16F877A.STATUS_RP1) !== 0,
      RP0: (status & PIC16F877A.STATUS_RP0) !== 0,
      TO:  (status & PIC16F877A.STATUS_TO) !== 0,
      PD:  (status & PIC16F877A.STATUS_PD) !== 0,
      Z:   (status & PIC16F877A.STATUS_Z) !== 0,
      DC:  (status & PIC16F877A.STATUS_DC) !== 0,
      C:   (status & PIC16F877A.STATUS_C) !== 0
    });

    setPortB(cpu.getPortPins('B'));
    setPortD(cpu.getPortPins('D'));

    setRamWatch({
      PORTA: cpu.readRamDirect(0x05), TRISA: cpu.readRamDirect(0x85),
      PORTB: cpu.readRamDirect(0x06), TRISB: cpu.readRamDirect(0x86),
      PORTC: cpu.readRamDirect(0x07), TRISC: cpu.readRamDirect(0x87),
      PORTD: cpu.readRamDirect(0x08), TRISD: cpu.readRamDirect(0x88),
      FSR:   cpu.readRamDirect(0x04), INDF:  cpu.readRamDirect(0x00),
      RAM20: cpu.readRamDirect(0x20), RAM21: cpu.readRamDirect(0x21),
      RAM22: cpu.readRamDirect(0x22), RAM23: cpu.readRamDirect(0x23),
      RAM24: cpu.readRamDirect(0x24), RAM25: cpu.readRamDirect(0x25)
    });

    setActiveLine(asm.pcToLine[cpu.pc] ?? null);
  }, [cpu, asm]);

  // Assemble code (returns true on success, false on error)
  const handleAssemble = useCallback((codeToAssemble?: string): boolean => {
    const code = codeToAssemble ?? sourceCode;
    try {
      const compiled = asm.assemble(code);
      setCodeMap(compiled);
      cpu.loadProgram(compiled);
      setLastAssembledCode(code);
      setConsoleLogs(prev => [
        ...prev,
        `[OK] Assembly successful! Generated ${Object.keys(compiled).length} words of 14-bit machine code. Loaded at 0x0000.`
      ]);
      refreshUi();
      return true;
    } catch (e: any) {
      setIsRunning(false);
      setCodeMap({});
      cpu.loadProgram({});
      if (e instanceof AssemblerError) {
        setConsoleLogs(prev => [
          ...prev,
          `[ERROR] Line ${e.lineNum}: ${e.message}`,
          `        --> ${e.lineText}`
        ]);
      } else {
        setConsoleLogs(prev => [...prev, `[ERROR] ${e.message}`]);
      }
      refreshUi();
      return false;
    }
  }, [sourceCode, asm, cpu, refreshUi]);

  // Initial compile on mount
  useEffect(() => {
    handleAssemble(sourceCode);
  }, []);

  // Step 1 instruction (auto-assembles if code was modified)
  const handleStep = () => {
    if (isDirty || !Object.keys(codeMap).length) {
      if (!handleAssemble()) return;
    }
    cpu.step();
    refreshUi();
  };

  // Reset CPU (re-assembles if modified, resets PC to 0)
  const handleReset = () => {
    setIsRunning(false);
    if (isDirty || !Object.keys(codeMap).length) {
      if (!handleAssemble()) return;
    }
    cpu.reset();
    refreshUi();
    setConsoleLogs(prev => [...prev, `[RESET] CPU Reset to initial state (PC = 0x0000).`]);
  };

  // Toggle Run / Pause (auto-assembles if modified before starting run)
  const toggleRun = () => {
    if (isRunning) {
      setIsRunning(false);
    } else {
      if (isDirty || !Object.keys(codeMap).length) {
        if (!handleAssemble()) return;
      }
      setIsRunning(true);
    }
  };

  // Execution runner loop
  useEffect(() => {
    if (!isRunning) {
      if (runTimerRef.current) clearTimeout(runTimerRef.current);
      return;
    }

    const tick = () => {
      if (speedHz <= 60) {
        const delayMs = Math.max(1, Math.floor(1000 / speedHz));
        cpu.step();
        refreshUi();
        runTimerRef.current = setTimeout(tick, delayMs);
      } else {
        // High-speed batching
        const stepsPerFrame = Math.max(1, Math.floor(speedHz * 0.016));
        for (let i = 0; i < stepsPerFrame; i++) {
          cpu.step();
        }
        refreshUi();
        runTimerRef.current = setTimeout(tick, 16);
      }
    };

    runTimerRef.current = setTimeout(tick, 16);
    return () => {
      if (runTimerRef.current) clearTimeout(runTimerRef.current);
    };
  }, [isRunning, speedHz, cpu, refreshUi]);

  // Export Intel HEX
  const handleExportHex = () => {
    if (isDirty || !Object.keys(codeMap).length) {
      if (!handleAssemble()) return;
    }
    const hex = asm.toIntelHex();
    const blob = new Blob([hex], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'program.hex';
    a.click();
    URL.revokeObjectURL(url);
    setConsoleLogs(prev => [...prev, `[HEX] Exported Intel HEX file successfully.`]);
  };

  // Handle Example Selection
  const handleSelectExample = (name: string) => {
    setSelectedExample(name);
    setIsRunning(false);
    if (name in EXAMPLES) {
      const code = EXAMPLES[name];
      setSourceCode(code);
      handleAssemble(code);
    }
  };

  // Push Button toggles
  const togglePin = (port: 'A' | 'B' | 'D', bit: number, currentPressed: boolean, setPressed: (v: boolean) => void) => {
    const nextPressed = !currentPressed;
    setPressed(nextPressed);
    if (nextPressed) {
      cpu.pinInputs[port] &= ~(1 << bit); // Active Low: 0 when pressed
    } else {
      cpu.pinInputs[port] |= (1 << bit);  // High: 1 when released
    }
    refreshUi();
  };

  // Time string formatting
  const timeUs = cycles * (4.0 / (cpu.oscFreqHz / 1000000.0));
  let timeStr = `${timeUs.toFixed(1)} µs`;
  if (timeUs >= 1000000) timeStr = `${(timeUs / 1000000.0).toFixed(2)} s`;
  else if (timeUs >= 1000) timeStr = `${(timeUs / 1000.0).toFixed(2)} ms`;

  // Editor Line Numbers
  const lineCount = sourceCode.split('\n').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', background: 'var(--bg-dark)' }}>
      {/* Top Navbar */}
      <header style={{
        background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
        padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: '46px', flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <div style={{
            background: 'linear-gradient(135deg, #0ea5e9, #a855f7)', color: 'white',
            fontWeight: 800, fontSize: '11px', padding: '3px 8px', borderRadius: '5px', letterSpacing: '0.8px', flexShrink: 0
          }}>
            YUUJI LAB
          </div>
          <img
            src="/processor-icon.svg"
            alt="PIC16F877A Icon"
            style={{ width: '18px', height: '18px', flexShrink: 0 }}
          />
          <div style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '0.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span>PIC16F877A Studio</span>
          </div>
          <div className="hide-on-mobile" style={{ fontSize: '11px', color: 'var(--fg-muted)', borderLeft: '1px solid var(--border)', paddingLeft: '10px', whiteSpace: 'nowrap' }}>
            Architecture Simulator & MPASM IDE
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <a
            href="https://yuujilab.com"
            target="_blank"
            rel="noreferrer"
            title="Yuuji Lab Website"
            style={{ color: 'var(--fg-muted)', textDecoration: 'none', fontSize: '12px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Globe size={14} />
            <span className="hide-on-mobile">yuujilab.com</span>
          </a>
          <a
            href="https://www.yuujilab.com/play"
            target="_blank"
            rel="noreferrer"
            title="Google Play Store"
            style={{ color: 'var(--fg-muted)', textDecoration: 'none', fontSize: '12px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Smartphone size={14} />
            <span className="hide-on-mobile">Google Play</span>
          </a>
          <a
            href="https://github.com/YuujiLab/PIC16F877A-Studio"
            target="_blank"
            rel="noreferrer"
            title="GitHub Repository"
            style={{ color: 'var(--fg-muted)', textDecoration: 'none', fontSize: '12px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
              <path d="M9 18c-4.51 2-5-2-7-2" />
            </svg>
            <span className="hide-on-mobile">GitHub</span>
          </a>
        </div>
      </header>

      {/* Action Toolbar (2-Row Static Layout) */}
      <div style={{
        background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
        padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0
      }}>
        {/* Row 1: Execution Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
          {/* Run / Pause */}
          <button
            onClick={toggleRun}
            style={{
              flex: 1, minWidth: 0,
              background: isRunning ? '#d97706' : '#059669', color: 'white', border: 'none',
              borderRadius: '5px', fontSize: '11.5px', fontWeight: 600, padding: '7px 4px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
            }}
            title={isRunning ? "Pause execution" : "Run simulation (auto-assembles if modified)"}
          >
            {isRunning ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
            <span>{isRunning ? 'Pause' : 'Run'}</span>
          </button>

          {/* Step */}
          <button
            onClick={handleStep}
            style={{
              flex: 1, minWidth: 0,
              background: '#0284c7', color: 'white', border: 'none', borderRadius: '5px',
              fontSize: '11.5px', fontWeight: 600, padding: '7px 4px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
            }}
            title="Step one instruction (auto-assembles if modified)"
          >
            <StepForward size={13} />
            <span>Step</span>
          </button>

          {/* Reset */}
          <button
            onClick={handleReset}
            style={{
              flex: 1, minWidth: 0,
              background: '#4b5563', color: 'white', border: 'none', borderRadius: '5px',
              fontSize: '11.5px', fontWeight: 600, padding: '7px 4px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
            }}
            title="Reset CPU to PC=0x0000"
          >
            <RotateCcw size={13} />
            <span>Reset</span>
          </button>

          {/* Assemble Button */}
          <button
            onClick={() => handleAssemble()}
            style={{
              flex: 1.1, minWidth: 0,
              background: isDirty ? '#ea580c' : '#374151', color: 'white', border: 'none', borderRadius: '5px',
              fontSize: '11.5px', fontWeight: 600, padding: '7px 4px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
              boxShadow: isDirty ? '0 0 8px rgba(234, 88, 12, 0.4)' : 'none'
            }}
            title="Assemble MPASM code and load into CPU memory"
          >
            <Cpu size={13} />
            <span>Assemble{isDirty ? ' *' : ''}</span>
          </button>

          {/* Export HEX */}
          <button
            onClick={handleExportHex}
            style={{
              flex: 1, minWidth: 0,
              background: '#1f2937', color: 'var(--fg-main)', border: '1px solid var(--border)', borderRadius: '5px',
              fontSize: '11.5px', fontWeight: 600, padding: '7px 4px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
            }}
            title="Download compiled Intel HEX file"
          >
            <Download size={13} />
            <span>HEX</span>
          </button>
        </div>

        {/* Row 2: Example and Speed Selectors */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
          {/* Example Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--fg-muted)', flex: 1.2, minWidth: 0 }}>
            <BookOpen size={13} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
            <span style={{ flexShrink: 0 }}>Demo:</span>
            <select
              value={selectedExample}
              onChange={(e) => handleSelectExample(e.target.value)}
              style={{
                width: '100%', minWidth: 0,
                background: 'var(--bg-input)', color: 'var(--fg-main)', border: '1px solid var(--border)',
                borderRadius: '4px', padding: '4px 6px', fontSize: '11px', outline: 'none', cursor: 'pointer',
                textOverflow: 'ellipsis'
              }}
            >
              <option value="01_blink.asm">Blink.asm (LED Blink)</option>
              <option value="02_counter.asm">Counter.asm (8-bit Binary Counter)</option>
              <option value="03_chaser.asm">Chaser.asm (Knight Rider Chaser)</option>
              <option value="04_button_led.asm">Button_LED.asm (Push Button Input)</option>
              <option value="06_course_blink.asm">Slow_Blink.asm (Slow 500ms Blink)</option>
            </select>
          </div>

          {/* Speed Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--fg-muted)', flex: 1, minWidth: 0 }}>
            <Gauge size={13} style={{ color: 'var(--accent-yellow)', flexShrink: 0 }} />
            <span style={{ flexShrink: 0 }}>Speed:</span>
            <select
              value={speedHz}
              onChange={(e) => setSpeedHz(parseInt(e.target.value, 10))}
              style={{
                width: '100%', minWidth: 0,
                background: 'var(--bg-input)', color: 'var(--fg-main)', border: '1px solid var(--border)',
                borderRadius: '4px', padding: '4px 6px', fontSize: '11px', outline: 'none', cursor: 'pointer'
              }}
            >
              <option value="10">10 Hz (Slow)</option>
              <option value="60">60 Hz (Trace)</option>
              <option value="500">500 Hz (Fast)</option>
              <option value="10000">10 kHz (High)</option>
              <option value="500000">500 kHz (4MHz Real-Time)</option>
              <option value="1000000">1 MHz (Turbo)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Mobile Tab Bar (Visible on mobile/tablets < 860px) */}
      {isMobile && (
        <div style={{
          display: 'flex', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
          padding: '4px 8px', gap: '6px', flexShrink: 0
        }}>
          <button
            onClick={() => setMobileTab('editor')}
            style={{
              flex: 1, padding: '8px 10px', borderRadius: '5px', border: 'none',
              background: mobileTab === 'editor' ? 'var(--bg-card)' : 'transparent',
              color: mobileTab === 'editor' ? '#ffffff' : 'var(--fg-muted)',
              fontWeight: 600, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              borderBottom: mobileTab === 'editor' ? '2px solid var(--accent-blue)' : '2px solid transparent',
              cursor: 'pointer'
            }}
          >
            <FileCode size={14} style={{ color: isDirty ? '#f59e0b' : '#10b981' }} />
            <span>Code Studio {isDirty ? '*' : ''}</span>
          </button>

          <button
            onClick={() => setMobileTab('hardware')}
            style={{
              flex: 1, padding: '8px 10px', borderRadius: '5px', border: 'none',
              background: mobileTab === 'hardware' ? 'var(--bg-card)' : 'transparent',
              color: mobileTab === 'hardware' ? '#ffffff' : 'var(--fg-muted)',
              fontWeight: 600, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              borderBottom: mobileTab === 'hardware' ? '2px solid var(--accent-green)' : '2px solid transparent',
              cursor: 'pointer'
            }}
          >
            <Cpu size={14} style={{ color: 'var(--accent-green)' }} />
            <span>Virtual Chip & LEDs</span>
            {/* Live blinking indicator if PORTB or PORTD has active outputs */}
            {(portB.latch !== 0 || portD.latch !== 0) && (
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%',
                background: '#39ff14', boxShadow: '0 0 6px #39ff14', display: 'inline-block'
              }} />
            )}
          </button>
        </div>
      )}

      {/* Main Split Workspace */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* Left Pane: Code Studio (Shown if !isMobile OR mobileTab === 'editor') */}
        {(!isMobile || mobileTab === 'editor') && (
          <div style={{
            flex: 1, minWidth: 0, borderRight: isMobile ? 'none' : '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)', height: '100%'
          }}>
            {/* Editor Header with Modified Indicator */}
            <div style={{
              background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
              padding: '6px 12px', fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, overflow: 'hidden' }}>
                <FileCode size={13} style={{ color: isDirty ? '#f59e0b' : '#10b981', flexShrink: 0 }} />
                <span style={{ fontWeight: 700, color: '#f3f4f6', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  main.asm{isDirty ? ' *' : ''}
                </span>
                <span style={{
                  fontSize: '9.5px',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: isDirty ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                  color: isDirty ? '#f59e0b' : '#10b981',
                  border: `1px solid ${isDirty ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
                  whiteSpace: 'nowrap'
                }}>
                  {isDirty ? (
                    <>
                      <AlertCircle size={9} />
                      <span>Modified</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={9} />
                      <span>Ready</span>
                    </>
                  )}
                </span>
              </div>
              <span className="hide-on-mobile" style={{ color: 'var(--fg-muted)', fontSize: '10px' }}>Tab key = 4 spaces</span>
            </div>

            {/* Editor Area */}
            <div style={{ flex: 1, display: 'flex', background: '#141417', position: 'relative', overflow: 'hidden' }}>
              {/* Line Numbers Gutter */}
              <div
                ref={lineNumbersRef}
                style={{
                  width: '46px', background: '#101012', borderRight: '1px solid var(--border)',
                  color: '#555562', fontFamily: 'Consolas, monospace', fontSize: '12px',
                  lineHeight: '20px', padding: '8px 2px', textAlign: 'right', userSelect: 'none', overflow: 'hidden', flexShrink: 0
                }}
              >
                {Array.from({ length: lineCount }, (_, i) => i + 1).map(num => (
                  <div
                    key={num}
                    style={{
                      height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '2px',
                      ...(num === activeLine ? { color: '#ffffff', fontWeight: 'bold', background: 'rgba(14, 165, 233, 0.25)', borderRadius: '3px', paddingRight: '2px' } : {})
                    }}
                  >
                    {num === activeLine && <ChevronRight size={10} color="#38bdf8" />}
                    <span>{num}</span>
                  </div>
                ))}
              </div>

              {/* Code Textarea */}
              <textarea
                ref={editorRef}
                value={sourceCode}
                onChange={(e) => setSourceCode(e.target.value)}
                onScroll={() => {
                  if (lineNumbersRef.current && editorRef.current) {
                    lineNumbersRef.current.scrollTop = editorRef.current.scrollTop;
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    const start = e.currentTarget.selectionStart;
                    const end = e.currentTarget.selectionEnd;
                    const newCode = sourceCode.substring(0, start) + "    " + sourceCode.substring(end);
                    setSourceCode(newCode);
                    setTimeout(() => {
                      if (editorRef.current) {
                        editorRef.current.selectionStart = editorRef.current.selectionEnd = start + 4;
                      }
                    }, 0);
                  }
                }}
                spellCheck={false}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                style={{
                  flex: 1, background: 'transparent', color: 'var(--fg-main)', border: 'none',
                  outline: 'none', resize: 'none', fontFamily: 'Consolas, Monaco, monospace',
                  fontSize: '13px', lineHeight: '20px', padding: '8px 10px', whiteSpace: 'pre', overflow: 'auto',
                  tabSize: 4
                }}
              />
            </div>

            {/* Console Output */}
            <div style={{ height: isMobile ? '100px' : '125px', background: '#0d0d0f', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              <div style={{
                background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
                padding: '3px 10px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--fg-muted)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Terminal size={11} style={{ color: 'var(--accent-blue)' }} />
                  <span>Assembler & Output</span>
                </div>
                <button
                  onClick={() => setConsoleLogs([])}
                  style={{
                    background: 'none', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', padding: '2px 4px'
                  }}
                  title="Clear console"
                >
                  <Trash2 size={10} />
                  <span>Clear</span>
                </button>
              </div>
              <div style={{ flex: 1, padding: '5px 10px', fontFamily: 'Consolas, monospace', fontSize: '11px', color: '#b0b0bb', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                {consoleLogs.length ? consoleLogs.join('\n') : <span style={{ color: '#4b5563' }}>No output yet. Ready.</span>}
              </div>
            </div>
          </div>
        )}

        {/* Right Pane: Microcontroller & Hardware (Shown if !isMobile OR mobileTab === 'hardware') */}
        {(!isMobile || mobileTab === 'hardware') && (
          <div style={{
            flex: isMobile ? 1 : 1.1, minWidth: 0, width: '100%', overflowY: 'auto', padding: isMobile ? '8px' : '12px',
            display: 'flex', flexDirection: 'column', gap: '10px', WebkitOverflowScrolling: 'touch'
          }}>
            
            {/* PIC16F877A Chip Visual */}
            <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--accent-blue)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Cpu size={13} />
                  <span>PIC16F877A Microcontroller</span>
                </div>
                <span style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>4 MHz Harvard RISC</span>
              </div>
              <div style={{
                background: '#0f0f11', border: '2px solid #33333d', borderRadius: '6px',
                padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative'
              }}>
                <div style={{ width: '6px', height: '16px', background: 'var(--bg-panel)', border: '2px solid #33333d', borderLeft: 'none', borderRadius: '0 8px 8px 0', position: 'absolute', left: '-2px' }}></div>
                <div style={{ width: '6px', height: '6px', background: '#555562', borderRadius: '50%', marginLeft: '8px' }}></div>
                <div style={{ textAlign: 'center', flex: 1 }}>
                  <div style={{ fontWeight: 800, letterSpacing: '1px', fontSize: '12px', color: '#ffffff' }}>MICROCHIP PIC16F877A</div>
                  <div style={{ fontSize: '9.5px', color: 'var(--fg-muted)' }}>40-Pin DIP • 8K Flash • 368B RAM • 35 Instructions</div>
                </div>
              </div>
            </div>

            {/* Live GPIO & Glowing LEDs */}
            <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--accent-green)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Radio size={13} />
                  <span>Live GPIO & Virtual LEDs</span>
                </div>
                <span style={{ fontSize: '9.5px', color: 'var(--fg-muted)' }}>Active Logic Output</span>
              </div>

              {/* PORTB LED Bar (Neon Green) */}
              <div style={{ background: '#111114', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10.5px', marginBottom: '6px' }}>
                  <strong style={{ color: '#38bdf8' }}>PORTB (RB7 ◀ RB0)</strong>
                  <span style={{ fontFamily: 'monospace', color: 'var(--accent-yellow)', fontSize: '10px' }}>
                    0x{portB.latch.toString(16).padStart(2, '0').toUpperCase()}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2px' }}>
                  {[7, 6, 5, 4, 3, 2, 1, 0].map(bit => {
                    const isOutput = !((portB.tris >> bit) & 1);
                    const isHigh = isOutput ? Boolean((portB.latch >> bit) & 1) : Boolean((portB.pins >> bit) & 1);
                    return (
                      <div key={bit} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flex: 1 }}>
                        <div
                          style={{
                            width: '100%', maxWidth: '32px', aspectRatio: '1/1', borderRadius: '50%',
                            border: isOutput && isHigh ? '2px solid #39ff14' : '2px solid #2a2a33',
                            background: isOutput && isHigh ? 'radial-gradient(circle, #70ff50 20%, #39ff14 70%)' : '#0f1c0f',
                            boxShadow: isOutput && isHigh ? '0 0 12px var(--led-glow-green), inset 0 0 3px #ffffff' : 'none',
                            color: isOutput && isHigh ? '#000000' : '#385538',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '10px', fontWeight: 'bold', fontFamily: 'monospace',
                            transition: 'all 0.1s ease-in-out'
                          }}
                        >
                          {isHigh ? '1' : '0'}
                        </div>
                        <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--fg-muted)' }}>B{bit}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* PORTD LED Bar (Neon Red) */}
              <div style={{ background: '#111114', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10.5px', marginBottom: '6px' }}>
                  <strong style={{ color: '#f87171' }}>PORTD (RD7 ◀ RD0)</strong>
                  <span style={{ fontFamily: 'monospace', color: 'var(--accent-yellow)', fontSize: '10px' }}>
                    0x{portD.latch.toString(16).padStart(2, '0').toUpperCase()}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2px' }}>
                  {[7, 6, 5, 4, 3, 2, 1, 0].map(bit => {
                    const isOutput = !((portD.tris >> bit) & 1);
                    const isHigh = isOutput ? Boolean((portD.latch >> bit) & 1) : Boolean((portD.pins >> bit) & 1);
                    return (
                      <div key={bit} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flex: 1 }}>
                        <div
                          style={{
                            width: '100%', maxWidth: '32px', aspectRatio: '1/1', borderRadius: '50%',
                            border: isOutput && isHigh ? '2px solid #ff3344' : '2px solid #2a2a33',
                            background: isOutput && isHigh ? 'radial-gradient(circle, #ff6b7d 20%, #ff3344 70%)' : '#1c0f12',
                            boxShadow: isOutput && isHigh ? '0 0 12px var(--led-glow-red), inset 0 0 3px #ffffff' : 'none',
                            color: isOutput && isHigh ? '#ffffff' : '#55383c',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '10px', fontWeight: 'bold', fontFamily: 'monospace',
                            transition: 'all 0.1s ease-in-out'
                          }}
                        >
                          {isHigh ? '1' : '0'}
                        </div>
                        <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--fg-muted)' }}>D{bit}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Interactive Push Buttons */}
            <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#f97316', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '8px' }}>
                <Sliders size={13} />
                <span>Interactive Digital Inputs (Active Low)</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                <button
                  onClick={() => togglePin('B', 0, btnRb0Pressed, setBtnRb0Pressed)}
                  style={{
                    background: btnRb0Pressed ? '#0284c7' : '#1e1e24', color: btnRb0Pressed ? 'white' : 'var(--fg-main)',
                    border: '1px solid var(--border)', borderRadius: '4px', padding: '10px 4px', fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', minHeight: '44px'
                  }}
                >
                  <span style={{ color: '#38bdf8' }}>RB0 / INT</span>
                  <span>{btnRb0Pressed ? 'LOW (0)' : 'HIGH (1)'}</span>
                </button>

                <button
                  onClick={() => togglePin('A', 0, btnRa0Pressed, setBtnRa0Pressed)}
                  style={{
                    background: btnRa0Pressed ? '#0284c7' : '#1e1e24', color: btnRa0Pressed ? 'white' : 'var(--fg-main)',
                    border: '1px solid var(--border)', borderRadius: '4px', padding: '10px 4px', fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', minHeight: '44px'
                  }}
                >
                  <span style={{ color: 'var(--accent-green)' }}>RA0 / AN0</span>
                  <span>{btnRa0Pressed ? 'LOW (0)' : 'HIGH (1)'}</span>
                </button>

                <button
                  onClick={() => togglePin('D', 0, btnRd0Pressed, setBtnRd0Pressed)}
                  style={{
                    background: btnRd0Pressed ? '#0284c7' : '#1e1e24', color: btnRd0Pressed ? 'white' : 'var(--fg-main)',
                    border: '1px solid var(--border)', borderRadius: '4px', padding: '10px 4px', fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', minHeight: '44px'
                  }}
                >
                  <span style={{ color: '#f87171' }}>RD0</span>
                  <span>{btnRd0Pressed ? 'LOW (0)' : 'HIGH (1)'}</span>
                </button>
              </div>
            </div>

            {/* CPU Registers & Status Flags */}
            <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--accent-yellow)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Activity size={13} />
                  <span>CPU Registers</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontFamily: 'monospace', fontSize: '10.5px', color: 'var(--accent-green)' }}>
                  <Clock size={11} />
                  <span>{timeStr}</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                <div style={{ background: '#131316', border: '1px solid var(--border)', borderRadius: '4px', padding: '5px 8px' }}>
                  <div style={{ fontSize: '9px', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>Working (W)</div>
                  <div style={{ fontFamily: 'Consolas, monospace', fontSize: '13px', fontWeight: 'bold', color: '#ffffff' }}>
                    0x{w.toString(16).padStart(2, '0').toUpperCase()} ({w})
                  </div>
                </div>

                <div style={{ background: '#131316', border: '1px solid var(--border)', borderRadius: '4px', padding: '5px 8px' }}>
                  <div style={{ fontSize: '9px', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>PC</div>
                  <div style={{ fontFamily: 'Consolas, monospace', fontSize: '13px', fontWeight: 'bold', color: 'var(--accent-green)' }}>
                    0x{pc.toString(16).padStart(4, '0').toUpperCase()}
                  </div>
                </div>

                <div style={{ background: '#131316', border: '1px solid var(--border)', borderRadius: '4px', padding: '5px 8px' }}>
                  <div style={{ fontSize: '9px', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>Bank</div>
                  <div style={{ fontFamily: 'Consolas, monospace', fontSize: '13px', fontWeight: 'bold', color: 'var(--accent-purple)' }}>
                    Bank {bank}
                  </div>
                </div>
              </div>

              {/* STATUS Flags */}
              <div style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>STATUS Register Flags:</div>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {Object.entries(statusFlags).map(([flag, active]) => (
                  <div
                    key={flag}
                    style={{
                      padding: '2px 6px', borderRadius: '3px', fontFamily: 'monospace', fontSize: '10px', fontWeight: 'bold',
                      border: '1px solid var(--border)',
                      background: active ? '#0284c7' : '#151518',
                      color: active ? '#ffffff' : '#555562',
                      boxShadow: active ? '0 0 6px rgba(14, 165, 233, 0.4)' : 'none'
                    }}
                  >
                    {flag}:{active ? '1' : '0'}
                  </div>
                ))}
              </div>

              {/* Cycles & Stack */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--fg-muted)', fontFamily: 'monospace', flexWrap: 'wrap', gap: '4px' }}>
                <div>Cycles: <span style={{ color: 'white', fontWeight: 'bold' }}>{cycles.toLocaleString()}</span></div>
                <div>Stack ({stack.length}/8): <span style={{ color: 'white', fontWeight: 'bold' }}>[{stack.map(a => `0x${a.toString(16).padStart(4, '0').toUpperCase()}`).join(', ')}]</span></div>
              </div>
            </div>

            {/* RAM & SFR Watch Table */}
            <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '8px' }}>
                <Database size={13} />
                <span>RAM & Special Function Registers</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: '5px' }}>
                {Object.entries(ramWatch).map(([name, val]) => (
                  <div
                    key={name}
                    style={{
                      background: '#131316', border: '1px solid var(--border)', borderRadius: '4px',
                      padding: '3px 6px', display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: '10.5px'
                    }}
                  >
                    <span style={{ color: 'var(--fg-muted)' }}>{name}:</span>
                    <span style={{ color: '#ffffff', fontWeight: 'bold' }}>0x{val.toString(16).padStart(2, '0').toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}

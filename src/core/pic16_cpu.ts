/**
 * Yuuji Lab - PIC16F877A Microcontroller CPU Core (TypeScript)
 * Complete 14-bit Mid-Range RISC CPU (35 instructions),
 * Harvard architecture, 4-bank RAM with Common RAM (0x70-0x7F) aliasing,
 * 8-level hardware stack, and status flags (Z, C, DC with PIC inverted borrow rule).
 */

export interface PortPinState {
    latch: number;
    tris: number;
    pins: number;
}

export class PIC16F877A {
    static readonly FLASH_SIZE = 8192;
    static readonly RAM_SIZE = 512;
    static readonly STACK_DEPTH = 8;

    // Bank 0 SFR addresses
    static readonly INDF_ADDR   = 0x00;
    static readonly TMR0_ADDR   = 0x01;
    static readonly PCL_ADDR    = 0x02;
    static readonly STATUS_ADDR = 0x03;
    static readonly FSR_ADDR    = 0x04;
    static readonly PORTA_ADDR  = 0x05;
    static readonly PORTB_ADDR  = 0x06;
    static readonly PORTC_ADDR  = 0x07;
    static readonly PORTD_ADDR  = 0x08;
    static readonly PORTE_ADDR  = 0x09;
    static readonly PCLATH_ADDR = 0x0A;
    static readonly INTCON_ADDR = 0x0B;

    // Bank 1 SFR addresses
    static readonly OPTION_ADDR = 0x81;
    static readonly TRISA_ADDR  = 0x85;
    static readonly TRISB_ADDR  = 0x86;
    static readonly TRISC_ADDR  = 0x87;
    static readonly TRISD_ADDR  = 0x88;
    static readonly TRISE_ADDR  = 0x89;

    // STATUS bit masks
    static readonly STATUS_C   = 0x01;
    static readonly STATUS_DC  = 0x02;
    static readonly STATUS_Z   = 0x04;
    static readonly STATUS_PD  = 0x08;
    static readonly STATUS_TO  = 0x10;
    static readonly STATUS_RP0 = 0x20;
    static readonly STATUS_RP1 = 0x40;
    static readonly STATUS_IRP = 0x80;

    readonly oscFreqHz: number;
    readonly flash: Uint16Array;
    readonly ram: Uint8Array;
    stack: number[];
    pc: number;
    w: number;
    pclath: number;
    cycles: number;
    isSleeping: boolean;
    pinInputs: Record<string, number>;

    constructor(oscFreqHz = 4000000) {
        this.oscFreqHz = oscFreqHz;
        this.flash = new Uint16Array(PIC16F877A.FLASH_SIZE);
        this.ram = new Uint8Array(PIC16F877A.RAM_SIZE);
        this.stack = [];
        this.pc = 0;
        this.w = 0;
        this.pclath = 0;
        this.cycles = 0;
        this.isSleeping = false;
        this.pinInputs = { A: 0x3F, B: 0xFF, C: 0xFF, D: 0xFF, E: 0x07 };
        this.reset();
    }

    reset(): void {
        this.pc = 0x0000;
        this.w = 0x00;
        this.pclath = 0x00;
        this.stack = [];
        this.cycles = 0;
        this.isSleeping = false;
        this.ram.fill(0);

        this.writeRamDirect(PIC16F877A.STATUS_ADDR, 0x18);
        this.writeRamDirect(PIC16F877A.TRISA_ADDR, 0x3F);
        this.writeRamDirect(PIC16F877A.TRISB_ADDR, 0xFF);
        this.writeRamDirect(PIC16F877A.TRISC_ADDR, 0xFF);
        this.writeRamDirect(PIC16F877A.TRISD_ADDR, 0xFF);
        this.writeRamDirect(PIC16F877A.TRISE_ADDR, 0x07);
        this.writeRamDirect(PIC16F877A.OPTION_ADDR, 0xFF);
    }

    canonicalPhysAddr(addr: number): number {
        addr &= 0x1FF;
        const low7 = addr & 0x7F;
        if (low7 === 0x00 || low7 === 0x02 || low7 === 0x03 || low7 === 0x04 || low7 === 0x0A || low7 === 0x0B) {
            return low7;
        }
        if (low7 >= 0x70 && low7 <= 0x7F) {
            return low7;
        }
        return addr;
    }

    getCurrentBank(): number {
        const status = this.readRamDirect(PIC16F877A.STATUS_ADDR);
        return (status >> 5) & 0x03;
    }

    mapAddress(addr7: number): number {
        addr7 &= 0x7F;
        if (addr7 === 0x00 || addr7 === 0x02 || addr7 === 0x03 || addr7 === 0x04 || addr7 === 0x0A || addr7 === 0x0B) {
            return addr7;
        }
        if (addr7 >= 0x70 && addr7 <= 0x7F) {
            return addr7;
        }
        const bank = this.getCurrentBank();
        return (bank << 7) | addr7;
    }

    readRamDirect(physicalAddr: number): number {
        return this.ram[this.canonicalPhysAddr(physicalAddr)];
    }

    writeRamDirect(physicalAddr: number, value: number): void {
        this.ram[this.canonicalPhysAddr(physicalAddr)] = value & 0xFF;
    }

    readRegister(addr7: number): number {
        addr7 &= 0x7F;

        if (addr7 === PIC16F877A.INDF_ADDR) {
            const fsr = this.readRegister(PIC16F877A.FSR_ADDR);
            const irp = (this.readRamDirect(PIC16F877A.STATUS_ADDR) >> 7) & 1;
            const physAddr = (irp << 8) | fsr;
            if ((physAddr & 0x7F) === PIC16F877A.INDF_ADDR) return 0;
            return this.readRamDirect(physAddr);
        }

        const physAddr = this.mapAddress(addr7);

        if (addr7 === PIC16F877A.PCL_ADDR) {
            return this.pc & 0xFF;
        }

        if (physAddr === PIC16F877A.PORTA_ADDR) {
            const trisa = this.readRamDirect(PIC16F877A.TRISA_ADDR);
            const latch = this.readRamDirect(PIC16F877A.PORTA_ADDR);
            const pin = this.pinInputs.A ?? 0x3F;
            return ((latch & ~trisa) | (pin & trisa)) & 0x3F;
        }
        if (physAddr === PIC16F877A.PORTB_ADDR) {
            const trisb = this.readRamDirect(PIC16F877A.TRISB_ADDR);
            const latch = this.readRamDirect(PIC16F877A.PORTB_ADDR);
            const pin = this.pinInputs.B ?? 0xFF;
            return ((latch & ~trisb) | (pin & trisb)) & 0xFF;
        }
        if (physAddr === PIC16F877A.PORTC_ADDR) {
            const trisc = this.readRamDirect(PIC16F877A.TRISC_ADDR);
            const latch = this.readRamDirect(PIC16F877A.PORTC_ADDR);
            const pin = this.pinInputs.C ?? 0xFF;
            return ((latch & ~trisc) | (pin & trisc)) & 0xFF;
        }
        if (physAddr === PIC16F877A.PORTD_ADDR) {
            const trisd = this.readRamDirect(PIC16F877A.TRISD_ADDR);
            const latch = this.readRamDirect(PIC16F877A.PORTD_ADDR);
            const pin = this.pinInputs.D ?? 0xFF;
            return ((latch & ~trisd) | (pin & trisd)) & 0xFF;
        }
        if (physAddr === PIC16F877A.PORTE_ADDR) {
            const trise = this.readRamDirect(PIC16F877A.TRISE_ADDR);
            const latch = this.readRamDirect(PIC16F877A.PORTE_ADDR);
            const pin = this.pinInputs.E ?? 0x07;
            return ((latch & ~trise) | (pin & trise)) & 0x07;
        }

        return this.readRamDirect(physAddr);
    }

    writeRegister(addr7: number, value: number): void {
        addr7 &= 0x7F;
        value &= 0xFF;

        if (addr7 === PIC16F877A.INDF_ADDR) {
            const fsr = this.readRegister(PIC16F877A.FSR_ADDR);
            const irp = (this.readRamDirect(PIC16F877A.STATUS_ADDR) >> 7) & 1;
            const physAddr = (irp << 8) | fsr;
            if ((physAddr & 0x7F) !== PIC16F877A.INDF_ADDR) {
                this.writeRamDirect(physAddr, value);
            }
            return;
        }

        if (addr7 === PIC16F877A.PCL_ADDR) {
            const pclath = this.readRamDirect(PIC16F877A.PCLATH_ADDR);
            this.pc = ((pclath & 0x1F) << 8) | value;
            this.writeRamDirect(PIC16F877A.PCL_ADDR, value);
            return;
        }

        if (addr7 === PIC16F877A.PCLATH_ADDR) {
            this.writeRamDirect(PIC16F877A.PCLATH_ADDR, value);
            this.pclath = value & 0x1F;
            return;
        }

        const physAddr = this.mapAddress(addr7);
        this.writeRamDirect(physAddr, value);
    }

    getPortPins(portChar: 'A' | 'B' | 'C' | 'D' | 'E'): PortPinState {
        const portAddrs = { A: 0x05, B: 0x06, C: 0x07, D: 0x08, E: 0x09 };
        const trisAddrs = { A: 0x85, B: 0x86, C: 0x87, D: 0x88, E: 0x89 };
        const masks     = { A: 0x3F, B: 0xFF, C: 0xFF, D: 0xFF, E: 0x07 };

        const pAddr = portAddrs[portChar];
        const tAddr = trisAddrs[portChar];
        const mask  = masks[portChar];

        const latch = this.readRamDirect(pAddr) & mask;
        const tris  = this.readRamDirect(tAddr) & mask;
        const extIn = (this.pinInputs[portChar] ?? 0xFF) & mask;

        const pins = ((latch & ~tris) | (extIn & tris)) & mask;
        return { latch, tris, pins };
    }

    getStatusFlag(mask: number): boolean {
        return (this.readRamDirect(PIC16F877A.STATUS_ADDR) & mask) !== 0;
    }

    setStatusFlag(mask: number, condition: boolean): void {
        let status = this.readRamDirect(PIC16F877A.STATUS_ADDR);
        if (condition) status |= mask;
        else status &= ~mask;
        this.writeRamDirect(PIC16F877A.STATUS_ADDR, status);
    }

    setZFlag(val: number): void {
        this.setStatusFlag(PIC16F877A.STATUS_Z, (val & 0xFF) === 0);
    }

    loadProgram(codeMap: Record<number, number>): void {
        this.flash.fill(0);
        for (const [addrStr, opcode] of Object.entries(codeMap)) {
            const addr = parseInt(addrStr, 10);
            if (addr >= 0 && addr < PIC16F877A.FLASH_SIZE) {
                this.flash[addr] = opcode & 0x3FFF;
            }
        }
        this.reset();
    }

    step(): number {
        if (this.isSleeping) return 1;

        const currPc = this.pc & (PIC16F877A.FLASH_SIZE - 1);
        const opcode = this.flash[currPc];
        this.pc = (this.pc + 1) & (PIC16F877A.FLASH_SIZE - 1);

        let cyclesTaken = 1;
        const opGroup = (opcode >> 12) & 0x03;

        if (opGroup === 0b00) cyclesTaken = this._execGroup00(opcode);
        else if (opGroup === 0b01) cyclesTaken = this._execGroup01(opcode);
        else if (opGroup === 0b10) cyclesTaken = this._execGroup10(opcode);
        else if (opGroup === 0b11) cyclesTaken = this._execGroup11(opcode);

        this.cycles += cyclesTaken;
        return cyclesTaken;
    }

    private _execGroup00(opcode: number): number {
        const d = (opcode >> 7) & 0x01;
        const f = opcode & 0x7F;

        if ((opcode & 0x3F80) === 0x0000) {
            const subop = opcode & 0xFF;
            if (subop === 0x00) return 1; // NOP
            if (subop === 0x08) { // RETURN
                if (this.stack.length > 0) this.pc = this.stack.pop()!;
                return 2;
            }
            if (subop === 0x09) { // RETFIE
                if (this.stack.length > 0) this.pc = this.stack.pop()!;
                const intcon = this.readRamDirect(PIC16F877A.INTCON_ADDR);
                this.writeRegister(PIC16F877A.INTCON_ADDR, intcon | 0x80);
                return 2;
            }
            if (subop === 0x63) { // SLEEP
                this.isSleeping = true;
                this.setStatusFlag(PIC16F877A.STATUS_TO, true);
                this.setStatusFlag(PIC16F877A.STATUS_PD, false);
                return 1;
            }
            if (subop === 0x64) { // CLRWDT
                this.setStatusFlag(PIC16F877A.STATUS_TO, true);
                this.setStatusFlag(PIC16F877A.STATUS_PD, true);
                return 1;
            }
            return 1;
        }

        if ((opcode & 0x3F80) === 0x0080) { // MOVWF
            this.writeRegister(f, this.w);
            return 1;
        }
        if ((opcode & 0x3F80) === 0x0100) { // CLRW
            this.w = 0;
            this.setStatusFlag(PIC16F877A.STATUS_Z, true);
            return 1;
        }
        if ((opcode & 0x3F80) === 0x0180) { // CLRF
            this.writeRegister(f, 0);
            this.setStatusFlag(PIC16F877A.STATUS_Z, true);
            return 1;
        }

        const op = (opcode >> 8) & 0x0F;
        const valF = this.readRegister(f);

        if (op === 0b0010) { // SUBWF
            const res = valF - this.w;
            this.setStatusFlag(PIC16F877A.STATUS_C, valF >= this.w);
            this.setStatusFlag(PIC16F877A.STATUS_DC, (valF & 0x0F) >= (this.w & 0x0F));
            const res8 = res & 0xFF;
            this.setZFlag(res8);
            if (d === 0) this.w = res8; else this.writeRegister(f, res8);
            return 1;
        }
        if (op === 0b0011) { // DECF
            const res8 = (valF - 1) & 0xFF;
            this.setZFlag(res8);
            if (d === 0) this.w = res8; else this.writeRegister(f, res8);
            return 1;
        }
        if (op === 0b0100) { // IORWF
            const res8 = (this.w | valF) & 0xFF;
            this.setZFlag(res8);
            if (d === 0) this.w = res8; else this.writeRegister(f, res8);
            return 1;
        }
        if (op === 0b0101) { // ANDWF
            const res8 = (this.w & valF) & 0xFF;
            this.setZFlag(res8);
            if (d === 0) this.w = res8; else this.writeRegister(f, res8);
            return 1;
        }
        if (op === 0b0110) { // XORWF
            const res8 = (this.w ^ valF) & 0xFF;
            this.setZFlag(res8);
            if (d === 0) this.w = res8; else this.writeRegister(f, res8);
            return 1;
        }
        if (op === 0b0111) { // ADDWF
            const res = this.w + valF;
            this.setStatusFlag(PIC16F877A.STATUS_C, res > 0xFF);
            this.setStatusFlag(PIC16F877A.STATUS_DC, ((this.w & 0x0F) + (valF & 0x0F)) > 0x0F);
            const res8 = res & 0xFF;
            this.setZFlag(res8);
            if (d === 0) this.w = res8; else this.writeRegister(f, res8);
            return 1;
        }
        if (op === 0b1000) { // MOVF
            const res8 = valF & 0xFF;
            this.setZFlag(res8);
            if (d === 0) this.w = res8; else this.writeRegister(f, res8);
            return 1;
        }
        if (op === 0b1001) { // COMF
            const res8 = (~valF) & 0xFF;
            this.setZFlag(res8);
            if (d === 0) this.w = res8; else this.writeRegister(f, res8);
            return 1;
        }
        if (op === 0b1010) { // INCF
            const res8 = (valF + 1) & 0xFF;
            this.setZFlag(res8);
            if (d === 0) this.w = res8; else this.writeRegister(f, res8);
            return 1;
        }
        if (op === 0b1011) { // DECFSZ
            const res8 = (valF - 1) & 0xFF;
            if (d === 0) this.w = res8; else this.writeRegister(f, res8);
            if (res8 === 0) {
                this.pc = (this.pc + 1) & (PIC16F877A.FLASH_SIZE - 1);
                return 2;
            }
            return 1;
        }
        if (op === 0b1100) { // RRF
            const oldC = this.getStatusFlag(PIC16F877A.STATUS_C) ? 1 : 0;
            const newC = valF & 0x01;
            const res8 = ((valF >> 1) | (oldC << 7)) & 0xFF;
            this.setStatusFlag(PIC16F877A.STATUS_C, Boolean(newC));
            if (d === 0) this.w = res8; else this.writeRegister(f, res8);
            return 1;
        }
        if (op === 0b1101) { // RLF
            const oldC = this.getStatusFlag(PIC16F877A.STATUS_C) ? 1 : 0;
            const newC = (valF >> 7) & 0x01;
            const res8 = ((valF << 1) | oldC) & 0xFF;
            this.setStatusFlag(PIC16F877A.STATUS_C, Boolean(newC));
            if (d === 0) this.w = res8; else this.writeRegister(f, res8);
            return 1;
        }
        if (op === 0b1110) { // SWAPF
            const res8 = (((valF << 4) & 0xF0) | ((valF >> 4) & 0x0F)) & 0xFF;
            if (d === 0) this.w = res8; else this.writeRegister(f, res8);
            return 1;
        }
        if (op === 0b1111) { // INCFSZ
            const res8 = (valF + 1) & 0xFF;
            if (d === 0) this.w = res8; else this.writeRegister(f, res8);
            if (res8 === 0) {
                this.pc = (this.pc + 1) & (PIC16F877A.FLASH_SIZE - 1);
                return 2;
            }
            return 1;
        }
        return 1;
    }

    private _execGroup01(opcode: number): number {
        const b = (opcode >> 7) & 0x07;
        const f = opcode & 0x7F;
        const subop = (opcode >> 10) & 0x03;
        const valF = this.readRegister(f);

        if (subop === 0b00) { this.writeRegister(f, valF & ~(1 << b)); return 1; }
        if (subop === 0b01) { this.writeRegister(f, valF | (1 << b)); return 1; }
        if (subop === 0b10) {
            if (((valF >> b) & 1) === 0) {
                this.pc = (this.pc + 1) & (PIC16F877A.FLASH_SIZE - 1);
                return 2;
            }
            return 1;
        }
        if (subop === 0b11) {
            if (((valF >> b) & 1) === 1) {
                this.pc = (this.pc + 1) & (PIC16F877A.FLASH_SIZE - 1);
                return 2;
            }
            return 1;
        }
        return 1;
    }

    private _execGroup10(opcode: number): number {
        const isGoto = Boolean((opcode >> 11) & 1);
        const k = opcode & 0x7FF;
        const pclath = this.readRamDirect(PIC16F877A.PCLATH_ADDR);
        const targetPc = ((pclath & 0x18) << 8) | k;

        if (isGoto) {
            this.pc = targetPc;
            return 2;
        } else {
            if (this.stack.length >= PIC16F877A.STACK_DEPTH) {
                this.stack.shift();
            }
            this.stack.push(this.pc);
            this.pc = targetPc;
            return 2;
        }
    }

    private _execGroup11(opcode: number): number {
        const k = opcode & 0xFF;

        if ((opcode & 0x3E00) === 0x3E00) { // ADDLW
            const res = this.w + k;
            this.setStatusFlag(PIC16F877A.STATUS_C, res > 0xFF);
            this.setStatusFlag(PIC16F877A.STATUS_DC, ((this.w & 0x0F) + (k & 0x0F)) > 0x0F);
            this.w = res & 0xFF;
            this.setZFlag(this.w);
            return 1;
        }
        if ((opcode & 0x3E00) === 0x3C00) { // SUBLW
            const res = k - this.w;
            this.setStatusFlag(PIC16F877A.STATUS_C, k >= this.w);
            this.setStatusFlag(PIC16F877A.STATUS_DC, (k & 0x0F) >= (this.w & 0x0F));
            this.w = res & 0xFF;
            this.setZFlag(this.w);
            return 1;
        }
        if ((opcode & 0x3F00) === 0x3900) { // ANDLW
            this.w = (this.w & k) & 0xFF;
            this.setZFlag(this.w);
            return 1;
        }
        if ((opcode & 0x3F00) === 0x3800) { // IORLW
            this.w = (this.w | k) & 0xFF;
            this.setZFlag(this.w);
            return 1;
        }
        if ((opcode & 0x3F00) === 0x3A00) { // XORLW
            this.w = (this.w ^ k) & 0xFF;
            this.setZFlag(this.w);
            return 1;
        }
        if ((opcode & 0x3C00) === 0x3000) { // MOVLW
            this.w = k & 0xFF;
            return 1;
        }
        if ((opcode & 0x3C00) === 0x3400) { // RETLW
            this.w = k & 0xFF;
            if (this.stack.length > 0) this.pc = this.stack.pop()!;
            return 2;
        }
        return 1;
    }
}

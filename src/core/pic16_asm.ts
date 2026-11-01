/**
 * Yuuji Lab - PIC16F877A Assembler (TypeScript)
 * MPASM compatible: CBLOCK/ENDC, ORG, EQU, #INCLUDE, __CONFIG,
 * case-insensitive symbols, line-to-PC mapping, and Intel HEX export.
 */

export const STANDARD_SYMBOLS: Record<string, number> = {
    W: 0, w: 0,
    F: 1, f: 1,

    INDF: 0x00, TMR0: 0x01, PCL: 0x02, STATUS: 0x03, FSR: 0x04,
    PORTA: 0x05, PORTB: 0x06, PORTC: 0x07, PORTD: 0x08, PORTE: 0x09,
    PCLATH: 0x0A, INTCON: 0x0B, PIR1: 0x0C, PIR2: 0x0D,
    TMR1L: 0x0E, TMR1H: 0x0F, T1CON: 0x10, TMR2: 0x11, T2CON: 0x12,
    ADRESH: 0x1E, ADCON0: 0x1F,

    OPTION_REG: 0x81 & 0x7F,
    TRISA: 0x85 & 0x7F, TRISB: 0x86 & 0x7F, TRISC: 0x87 & 0x7F,
    TRISD: 0x88 & 0x7F, TRISE: 0x89 & 0x7F,
    PIE1: 0x8C & 0x7F, PIE2: 0x8D & 0x7F, PCON: 0x8E & 0x7F,
    ADRESL: 0x9E & 0x7F, ADCON1: 0x9F & 0x7F,

    C: 0, c: 0, DC: 1, dc: 1, Z: 2, z: 2,
    NOT_PD: 3, not_pd: 3, NOT_TO: 4, not_to: 4,
    RP0: 5, rp0: 5, RP1: 6, rp1: 6, IRP: 7, irp: 7,

    RBIF: 0, INTF: 1, T0IF: 2, RBIE: 3,
    INTE: 4, T0IE: 5, PEIE: 6, GIE: 7
};

for (const port of ['A', 'B', 'C', 'D', 'E']) {
    for (let pin = 0; pin < 8; pin++) {
        STANDARD_SYMBOLS[`R${port}${pin}`] = pin;
        STANDARD_SYMBOLS[`r${port.toLowerCase()}${pin}`] = pin;
    }
}

export class AssemblerError extends Error {
    readonly lineNum: number | null;
    readonly lineText: string;

    constructor(message: string, lineNum: number | null = null, lineText = '') {
        super(lineNum ? `Line ${lineNum}: ${message} -> '${lineText}'` : message);
        this.lineNum = lineNum;
        this.lineText = lineText;
    }
}

export class Assembler {
    static readonly KNOWN_MNEMONICS = new Set([
        'ADDLW', 'ADDWF', 'ANDLW', 'ANDWF', 'BCF', 'BSF', 'BTFSC', 'BTFSS',
        'CALL', 'CLRF', 'CLRW', 'CLRWDT', 'COMF', 'DECF', 'DECFSZ', 'GOTO',
        'INCF', 'INCFSZ', 'IORLW', 'IORWF', 'MOVF', 'MOVLW', 'MOVWF', 'NOP',
        'RETFIE', 'RETLW', 'RETURN', 'RLF', 'RRF', 'SLEEP', 'SUBLW', 'SUBWF',
        'SWAPF', 'XORLW', 'XORWF'
    ]);

    static readonly IGNORE_DIRECTIVES = new Set([
        'LIST', 'PROCESSOR', '__CONFIG', 'CONFIG', '#INCLUDE', 'INCLUDE',
        'ERRORLEVEL', 'RADIX', 'TITLE', 'SUBTITLE', 'PAGE', 'MESG', 'MESSG',
        'ENDC', 'CBLOCK'
    ]);

    symbols: Record<string, number> = { ...STANDARD_SYMBOLS };
    code: Record<number, number> = {};
    pcToLine: Record<number, number> = {};
    lineToPc: Record<number, number> = {};

    parseNumber(token: string, symbols: Record<string, number> = this.symbols): number {
        token = token.trim();
        if (!token) throw new Error("Empty number token");

        if (token in symbols) return symbols[token];
        const tokenUpper = token.toUpperCase();
        if (tokenUpper in symbols) return symbols[tokenUpper];

        let m = token.match(/^[Hh]'([0-9a-fA-F]+)'$/);
        if (m) return parseInt(m[1], 16);

        m = token.match(/^[Bb]'([01]+)'$/);
        if (m) return parseInt(m[1], 2);

        m = token.match(/^[Dd]'([0-9]+)'$/);
        if (m) return parseInt(m[1], 10);

        if (token.toLowerCase().startsWith('0x')) return parseInt(token, 16);
        if (token.toLowerCase().startsWith('0b')) return parseInt(token, 2);

        if (/^[0-9][0-9a-fA-F]*[hH]$/.test(token)) return parseInt(token.slice(0, -1), 16);
        if (token.startsWith('.')) return parseInt(token.slice(1), 10);
        if (/^-?[0-9]+$/.test(token)) return parseInt(token, 10);

        if (token.length >= 3 && token.startsWith("'") && token.endsWith("'")) {
            return token.charCodeAt(1);
        }

        try {
            const sanitized = token.replace(/[A-Za-z_][A-Za-z0-9_]*/g, match => {
                const upper = match.toUpperCase();
                return upper in symbols ? String(symbols[upper]) : match;
            });
            if (/^[\d\s+\-*/()&|^~]+$/.test(sanitized)) {
                return Function(`"use strict"; return (${sanitized});`)();
            }
        } catch (e) {}

        throw new Error(`Unknown symbol or invalid literal: '${token}'`);
    }

    stripComments(line: string): string {
        if (line.includes(';')) line = line.slice(0, line.indexOf(';'));
        if (line.includes('//')) line = line.slice(0, line.indexOf('//'));
        return line.trim();
    }

    assemble(sourceText: string): Record<number, number> {
        this.symbols = { ...STANDARD_SYMBOLS };
        this.code = {};
        this.pcToLine = {};
        this.lineToPc = {};

        const rawLines = sourceText.split('\n');
        let currentPc = 0x0000;
        const parsedLines: Array<{ lineNum: number; mnemonic: string; operands: string; rawLine: string; currentPc: number }> = [];

        let inCblock = false;
        let cblockAddr = 0x20;

        for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
            const lineNum = lineIdx + 1;
            const rawLine = rawLines[lineIdx];
            const clean = this.stripComments(rawLine);
            if (!clean) continue;

            const tokens = clean.split(/\s+/);
            const firstToken = tokens[0];

            if (inCblock) {
                if (firstToken.toUpperCase() === 'ENDC') {
                    inCblock = false;
                    continue;
                }
                const items = clean.replace(/,/g, ' ').split(/\s+/);
                for (const item of items) {
                    if (!item) continue;
                    if (item.toUpperCase() === 'ENDC') {
                        inCblock = false;
                        break;
                    }
                    let vname = item;
                    let vsize = 1;
                    if (item.includes(':')) {
                        const parts = item.split(':');
                        vname = parts[0];
                        try { vsize = this.parseNumber(parts[1], this.symbols); } catch (e) { vsize = 1; }
                    }
                    vname = vname.trim();
                    if (vname) {
                        this.symbols[vname] = cblockAddr;
                        this.symbols[vname.toUpperCase()] = cblockAddr;
                        cblockAddr += vsize;
                    }
                }
                continue;
            }

            const upperTokens = tokens.map(t => t.toUpperCase());
            if (upperTokens.includes('CBLOCK')) {
                inCblock = true;
                const idx = upperTokens.indexOf('CBLOCK');
                if (idx + 1 < tokens.length) {
                    try { cblockAddr = this.parseNumber(tokens[idx + 1], this.symbols); } catch (e) { cblockAddr = 0x20; }
                } else {
                    cblockAddr = 0x20;
                }
                continue;
            }

            const upperFirst = firstToken.toUpperCase();
            if (upperFirst.startsWith('#INCLUDE') || upperFirst.startsWith('INCLUDE') || Assembler.IGNORE_DIRECTIVES.has(upperFirst)) {
                continue;
            }

            let label: string | null = null;
            let mnemonic: string | null = null;
            let operands = '';
            let remainingTokens = tokens;

            if (firstToken.endsWith(':')) {
                label = firstToken.slice(0, -1);
                remainingTokens = tokens.slice(1);
            } else if (tokens.length > 1 && tokens[1].toUpperCase() === 'EQU') {
                label = firstToken;
                remainingTokens = tokens.slice(1);
            } else if (rawLine.length > 0 && rawLine[0] !== ' ' && rawLine[0] !== '\t') {
                if (!Assembler.KNOWN_MNEMONICS.has(upperFirst) && !['ORG', 'EQU', 'END', '#DEFINE', 'DEFINE'].includes(upperFirst)) {
                    label = firstToken;
                    remainingTokens = tokens.slice(1);
                }
            }

            if (remainingTokens.length > 0) {
                mnemonic = remainingTokens[0].toUpperCase();
                const idx = clean.indexOf(remainingTokens[0]);
                operands = clean.slice(idx + remainingTokens[0].length).trim();
            }

            if (mnemonic === 'EQU') {
                if (!label) throw new AssemblerError("EQU directive requires a label", lineNum, rawLine);
                const val = this.parseNumber(operands, this.symbols);
                this.symbols[label] = val;
                this.symbols[label.toUpperCase()] = val;
                continue;
            }

            if (mnemonic === '#DEFINE' || mnemonic === 'DEFINE') {
                const parts = operands.split(/\s+/);
                if (parts.length >= 2) {
                    try {
                        const val = this.parseNumber(parts[1], this.symbols);
                        this.symbols[parts[0]] = val;
                        this.symbols[parts[0].toUpperCase()] = val;
                    } catch (e) {}
                }
                continue;
            }

            if (mnemonic === 'ORG') {
                currentPc = this.parseNumber(operands, this.symbols);
                continue;
            }

            if (label) {
                this.symbols[label] = currentPc;
                this.symbols[label.toUpperCase()] = currentPc;
            }

            if (mnemonic) {
                if (['END', 'LIST', 'PROCESSOR', '__CONFIG', 'INCLUDE', '#INCLUDE'].includes(mnemonic)) {
                    if (mnemonic === 'END') break;
                    continue;
                }
                parsedLines.push({ lineNum, mnemonic, operands, rawLine, currentPc });
                currentPc++;
            }
        }

        for (const item of parsedLines) {
            const { lineNum, mnemonic, operands, rawLine, currentPc } = item;
            if (mnemonic === 'END' || Assembler.IGNORE_DIRECTIVES.has(mnemonic)) continue;
            const ops = operands ? operands.split(',').map(s => s.trim()).filter(Boolean) : [];

            try {
                const opcode = this.encodeInstruction(mnemonic, ops, currentPc);
                this.code[currentPc] = opcode;
                this.pcToLine[currentPc] = lineNum;
                this.lineToPc[lineNum] = currentPc;
            } catch (e: any) {
                throw new AssemblerError(e.message, lineNum, rawLine);
            }
        }

        return this.code;
    }

    encodeInstruction(mnemonic: string, ops: string[], _currentPc: number): number {
        const getVal = (tok: string) => this.parseNumber(tok, this.symbols);

        const byteMap: Record<string, number> = {
            ADDWF: 0b000111, ANDWF: 0b000101, COMF: 0b001001, DECF: 0b000011,
            DECFSZ: 0b001011, INCF: 0b001010, INCFSZ: 0b001111, IORWF: 0b000100,
            MOVF: 0b001000, RLF: 0b001101, RRF: 0b001100, SUBWF: 0b000010,
            SWAPF: 0b001110, XORWF: 0b000110
        };

        if (mnemonic in byteMap) {
            if (!ops.length) throw new Error(`${mnemonic} requires register 'f'`);
            const f = getVal(ops[0]) & 0x7F;
            const d = ops.length >= 2 ? (getVal(ops[1]) !== 0 ? 1 : 0) : 1;
            return (byteMap[mnemonic] << 8) | (d << 7) | f;
        }

        if (mnemonic === 'CLRF') {
            if (!ops.length) throw new Error("CLRF requires register 'f'");
            return 0x0180 | (getVal(ops[0]) & 0x7F);
        }
        if (mnemonic === 'CLRW') return 0x0100;
        if (mnemonic === 'MOVWF') {
            if (!ops.length) throw new Error("MOVWF requires register 'f'");
            return 0x0080 | (getVal(ops[0]) & 0x7F);
        }
        if (mnemonic === 'NOP') return 0x0000;

        const bitMap: Record<string, number> = {
            BCF: 0b010000, BSF: 0b010100, BTFSC: 0b011000, BTFSS: 0b011100
        };
        if (mnemonic in bitMap) {
            if (ops.length < 2) throw new Error(`${mnemonic} requires 2 operands: f, b`);
            const f = getVal(ops[0]) & 0x7F;
            const b = getVal(ops[1]) & 0x07;
            return (bitMap[mnemonic] << 8) | (b << 7) | f;
        }

        if (mnemonic === 'CALL') {
            if (!ops.length) throw new Error("CALL requires label or address");
            return 0x2000 | (getVal(ops[0]) & 0x7FF);
        }
        if (mnemonic === 'GOTO') {
            if (!ops.length) throw new Error("GOTO requires label or address");
            return 0x2800 | (getVal(ops[0]) & 0x7FF);
        }
        if (mnemonic === 'MOVLW') {
            if (!ops.length) throw new Error("MOVLW requires literal 'k'");
            return 0x3000 | (getVal(ops[0]) & 0xFF);
        }
        if (mnemonic === 'RETLW') {
            if (!ops.length) throw new Error("RETLW requires literal 'k'");
            return 0x3400 | (getVal(ops[0]) & 0xFF);
        }
        if (mnemonic === 'IORLW') return 0x3800 | (getVal(ops[0]) & 0xFF);
        if (mnemonic === 'ANDLW') return 0x3900 | (getVal(ops[0]) & 0xFF);
        if (mnemonic === 'XORLW') return 0x3A00 | (getVal(ops[0]) & 0xFF);
        if (mnemonic === 'SUBLW') return 0x3C00 | (getVal(ops[0]) & 0xFF);
        if (mnemonic === 'ADDLW') return 0x3E00 | (getVal(ops[0]) & 0xFF);
        if (mnemonic === 'RETURN') return 0x0008;
        if (mnemonic === 'RETFIE') return 0x0009;
        if (mnemonic === 'SLEEP')  return 0x0063;
        if (mnemonic === 'CLRWDT') return 0x0064;

        throw new Error(`Unrecognized mnemonic: '${mnemonic}'`);
    }

    toIntelHex(): string {
        const sortedAddrs = Object.keys(this.code).map(Number).sort((a, b) => a - b);
        if (!sortedAddrs.length) return ":00000001FF\n";

        const lines: string[] = [];
        const chunks: number[][] = [];
        let currChunk: number[] = [];

        for (const addr of sortedAddrs) {
            if (!currChunk.length) {
                currChunk.push(addr);
            } else {
                const last = currChunk[currChunk.length - 1];
                if (addr === last + 1 && currChunk.length < 8) {
                    currChunk.push(addr);
                } else {
                    chunks.push(currChunk);
                    currChunk = [addr];
                }
            }
        }
        if (currChunk.length) chunks.push(currChunk);

        for (const chunk of chunks) {
            const byteCount = chunk.length * 2;
            const startWord = chunk[0];
            const byteAddr = (startWord * 2) & 0xFFFF;
            const dataBytes: number[] = [];
            for (const wAddr of chunk) {
                const op = this.code[wAddr];
                dataBytes.push(op & 0xFF);
                dataBytes.push((op >> 8) & 0xFF);
            }
            const recType = 0x00;
            let chk = byteCount + (byteAddr >> 8) + (byteAddr & 0xFF) + recType;
            for (const b of dataBytes) chk += b;
            chk = ((-chk) & 0xFF);

            const hexLine = `:${byteCount.toString(16).padStart(2, '0').toUpperCase()}` +
                            `${byteAddr.toString(16).padStart(4, '0').toUpperCase()}` +
                            `00` +
                            dataBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('') +
                            `${chk.toString(16).padStart(2, '0').toUpperCase()}`;
            lines.push(hexLine);
        }

        lines.push(":00000001FF");
        return lines.join('\n') + '\n';
    }
}

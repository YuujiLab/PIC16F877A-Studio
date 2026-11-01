/**
 * Yuuji Lab - Pre-loaded PIC16F877A Assembly Examples
 */

export const EXAMPLES: Record<string, string> = {
    "01_blink.asm": `; =========================================================
; Example 1: Simple LED Blink on RB0
; PIC16F877A Assembly
; =========================================================
        ORG     0x0000
        GOTO    START

D1      EQU     0x20
D2      EQU     0x21

START:
        BSF     STATUS, RP0     ; Switch to Bank 1
        CLRF    TRISB           ; Set all PORTB pins to output (0x00)
        BCF     STATUS, RP0     ; Switch back to Bank 0

MAIN_LOOP:
        BSF     PORTB, 0        ; Turn ON LED at RB0
        CALL    DELAY

        BCF     PORTB, 0        ; Turn OFF LED at RB0
        CALL    DELAY

        GOTO    MAIN_LOOP

; Subroutine: Software Delay Loop
DELAY:
        MOVLW   d'6'
        MOVWF   D1
D_OUTER:
        MOVLW   d'10'
        MOVWF   D2
D_INNER:
        DECFSZ  D2, F
        GOTO    D_INNER
        DECFSZ  D1, F
        GOTO    D_OUTER
        RETURN

        END
`,

    "02_counter.asm": `; =========================================================
; Example 2: 8-bit Binary Up-Counter on PORTB
; Displays numbers 0x00 to 0xFF on 8 LEDs
; =========================================================
        ORG     0x0000
        GOTO    START

D1      EQU     0x20
D2      EQU     0x21

START:
        BSF     STATUS, RP0
        CLRF    TRISB           ; All PORTB pins as output (0x00)
        BCF     STATUS, RP0     ; Return to Bank 0

        CLRF    PORTB           ; Start counter at 0

COUNT_LOOP:
        INCF    PORTB, F        ; Increment PORTB (RB0 lights immediately!)
        CALL    DELAY
        GOTO    COUNT_LOOP

; Delay loop calibrated for smooth visual simulation
DELAY:
        MOVLW   d'4'
        MOVWF   D1
L1:
        MOVLW   d'8'
        MOVWF   D2
L2:
        DECFSZ  D2, F
        GOTO    L2
        DECFSZ  D1, F
        GOTO    L1
        RETURN

        END
`,

    "03_chaser.asm": `; =========================================================
; Example 3: Running Chaser / Knight Rider Light on PORTB
; Uses RLF (Rotate Left through Carry) and RRF (Rotate Right)
; =========================================================
        ORG     0x0000
        GOTO    START

D1      EQU     0x20
D2      EQU     0x21

START:
        BSF     STATUS, RP0     ; Bank 1
        CLRF    TRISB           ; PORTB all outputs
        BCF     STATUS, RP0     ; Bank 0

        MOVLW   0x01
        MOVWF   PORTB           ; Start with LED RB0 ON

ROTATE_LEFT:
        CALL    DELAY
        BCF     STATUS, C       ; Clear Carry flag
        RLF     PORTB, F        ; Shift bit left
        BTFSS   STATUS, C       ; Did the bit shift into Carry?
        GOTO    ROTATE_LEFT

        ; When bit reached end, shift back right
        MOVLW   0x80
        MOVWF   PORTB

ROTATE_RIGHT:
        CALL    DELAY
        BCF     STATUS, C
        RRF     PORTB, F        ; Shift bit right
        BTFSS   STATUS, C
        GOTO    ROTATE_RIGHT

        MOVLW   0x01
        MOVWF   PORTB
        GOTO    ROTATE_LEFT

DELAY:
        MOVLW   d'3'
        MOVWF   D1
O_LOOP:
        MOVLW   d'6'
        MOVWF   D2
I_LOOP:
        DECFSZ  D2, F
        GOTO    I_LOOP
        DECFSZ  D1, F
        GOTO    O_LOOP
        RETURN

        END
`,

    "04_button_led.asm": `; =========================================================
; Example 4: Push Button Input (RB0) controls LED (RD0)
; Active Low Button: Pressed = 0, Released = 1
; =========================================================
        ORG     0x0000
        GOTO    START

START:
        BSF     STATUS, RP0     ; Bank 1

        ; Configure RB0 as Input (1), rest output
        MOVLW   b'00000001'
        MOVWF   TRISB

        ; Configure PORTD all as Output (0)
        CLRF    TRISD

        BCF     STATUS, RP0     ; Bank 0
        CLRF    PORTD           ; LED initially OFF

CHECK_BUTTON:
        ; Test if Button on RB0 is pressed (0)
        BTFSC   PORTB, 0
        GOTO    BUTTON_RELEASED

BUTTON_PRESSED:
        BSF     PORTD, 0        ; Turn ON LED on RD0
        GOTO    CHECK_BUTTON

BUTTON_RELEASED:
        BCF     PORTD, 0        ; Turn OFF LED on RD0
        GOTO    CHECK_BUTTON

        END
`,

    "06_course_blink.asm": `; ====================================================================
; Course Example: 500ms Blink with CBLOCK & Nested Loop
; Target: PIC16F877A (MPASM)
; ====================================================================

    LIST P=16F877A              ; Define target processor
    #INCLUDE <P16F877A.INC>     ; Include standard register definitions

; ---- Configuration Bits ----
    __CONFIG _CP_OFF & _DEBUG_OFF & _WRT_OFF & _CPD_OFF & _LVP_OFF & _BODEN_ON & _PWRTE_ON & _WDT_OFF & _XT_OSC

; ---- Variables / RAM Allocation ----
    CBLOCK 0x20                 ; Start general purpose RAM block
        Delay1                  ; Variable for inner delay loop
        Delay2                  ; Variable for middle delay loop
        Delay3                  ; Variable for outer delay loop
    ENDC

; ---- Reset Vector ----
    ORG     0x0000              ; Processor reset vector
    GOTO    START               ; Jump to main initialization code

; ---- Main Program Execution ----
    ORG     0x0005              ; Start past interrupt vector
START
    ; ---- Configure I/O Ports ----
    BSF     STATUS, RP0         ; Switch to Bank 1 (to access TRIS registers)
    BCF     STATUS, RP1
    BCF     TRISB, 0            ; Set PORTB Pin 0 (RB0) as an Output
    BCF     STATUS, RP0         ; Switch back to Bank 0

    ; ---- Initialize State ----
    BCF     PORTB, 0            ; Ensure LED starts OFF

; ---- Infinite Loop ----
MAIN_LOOP
    BSF     PORTB, 0            ; Turn LED ON (High logic level)
    CALL    DELAY_500MS         ; Keep ON for 500ms
    
    BCF     PORTB, 0            ; Turn LED OFF (Low logic level)
    CALL    DELAY_500MS         ; Keep OFF for 500ms
    
    GOTO    MAIN_LOOP           ; Repeat forever

; ---- Delay Subroutine (Approx. 500ms at 4MHz) ----
DELAY_500MS
    MOVLW   D'5'                ; Set outer counter
    MOVWF   Delay3
D_LOOP3
    MOVLW   D'200'              ; Set middle counter
    MOVWF   Delay2
D_LOOP2
    MOVLW   D'250'              ; Set inner counter
    MOVWF   Delay1
D_LOOP1
    NOP                         ; Burn 1 cycle
    DECFSZ  Delay1, F           ; Decrement inner counter, skip if zero
    GOTO    D_LOOP1             ; Repeat inner loop
    
    DECFSZ  Delay2, F           ; Decrement middle counter, skip if zero
    GOTO    D_LOOP2             ; Repeat middle loop
    
    DECFSZ  Delay3, F           ; Decrement outer counter, skip if zero
    GOTO    D_LOOP3             ; Repeat outer loop
    RETURN                      ; Go back to main loop

    END
`
};

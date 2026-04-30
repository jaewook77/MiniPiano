/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Piano, Settings, Volume2, Info } from 'lucide-react';

// --- Constants & Types ---

type NoteInfo = {
  name: string;
  index: number; // Index 0 to 87
  freq: number;
  isBlack: boolean;
};

const NOTES_COUNT = 88; // Full piano range

const generateNotes = (): NoteInfo[] => {
  const notes: NoteInfo[] = [];
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  
  for (let i = 0; i < NOTES_COUNT; i++) {
    // Standard 88-key piano starts at A0
    // Index 0 = A0, 1 = A#0, 2 = B0, 3 = C1...
    // Formula for frequency: f = 440 * 2^((n-49)/12) where n is key index 1-88
    const n = i + 1;
    const freq = 440 * Math.pow(2, (n - 49) / 12);
    
    // Name calculation: A is the 10th name in the C-based array (index 9)
    const nameIndex = (i + 9) % 12;
    const name = noteNames[nameIndex];
    const octave = Math.floor((i + 9) / 12);

    notes.push({
      name: `${name}${octave}`,
      index: i,
      freq,
      isBlack: name.includes('#'),
    });
  }
  return notes;
};

const NOTES = generateNotes();
const TOTAL_WHITE_KEYS = NOTES.filter(n => !n.isBlack).length;

// --- Audio Engine ---

type InstrumentType = 'piano' | 'saxophone';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private activeOscillators: Map<number, { 
    osc: OscillatorNode; 
    gain: GainNode; 
    filter?: BiquadFilterNode;
    lfo?: OscillatorNode;
  }> = new Map();
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private currentInstrument: InstrumentType = 'piano';

  constructor() {}

  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-24, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(40, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.25, this.ctx.currentTime);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.4, this.ctx.currentTime);
      
      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setInstrument(inst: InstrumentType) {
    this.currentInstrument = inst;
  }

  playNote(noteIndex: number, freq: number) {
    this.init();
    if (!this.ctx || !this.masterGain) return;

    this.stopNote(noteIndex);
    const now = this.ctx.currentTime;
    
    // Create Nodes
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    let filter: BiquadFilterNode | undefined;
    let lfo: OscillatorNode | undefined;

    if (this.currentInstrument === 'piano') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.6, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.3, now + 0.3);

      osc.connect(gain);
    } else if (this.currentInstrument === 'saxophone') {
      // Saxophone approximation: Sawtooth + LPF + Vibrato
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);

      // Low pass filter to mellow out the sawtooth
      filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      // Lower cutoff for lower notes to keep it "reedy"
      filter.frequency.setValueAtTime(Math.min(freq * 3, 2000), now);
      filter.Q.setValueAtTime(5, now);

      // Vibrato (LFO)
      lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.setValueAtTime(5.5, now); // 5.5 Hz vibrato
      lfoGain.gain.setValueAtTime(freq * 0.01, now); // Depth relative to frequency
      
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start(now);

      // Envelope
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.4, now + 0.05); // Slower attack for wind
      gain.gain.linearRampToValueAtTime(0.3, now + 0.2);

      osc.connect(filter);
      filter.connect(gain);
    }

    gain.connect(this.masterGain);
    osc.start(now);
    this.activeOscillators.set(noteIndex, { osc, gain, filter, lfo });
  }

  stopNote(noteIndex: number) {
    const active = this.activeOscillators.get(noteIndex);
    if (!active || !this.ctx) return;

    const { osc, gain, lfo } = active;
    const now = this.ctx.currentTime;

    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    
    const releaseTime = this.currentInstrument === 'piano' ? 0.15 : 0.1;
    gain.gain.exponentialRampToValueAtTime(0.001, now + releaseTime);

    osc.stop(now + releaseTime + 0.05);
    if (lfo) lfo.stop(now + releaseTime + 0.05);
    this.activeOscillators.delete(noteIndex);
  }

  setVolume(v: number) {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  }
}

const audioEngine = new AudioEngine();

// --- Components ---

export default function App() {
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [instrument, setInstrument] = useState<InstrumentType>('piano');
  const [isRecording, setIsRecording] = useState(false);
  
  useEffect(() => {
    audioEngine.setInstrument(instrument);
  }, [instrument]);
  
  // Viewport states
  const [zoom, setZoom] = useState(12); // Number of white keys visible
  const [scrollOffset, setScrollOffset] = useState(0.4); // 0 to 1 position
  
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const whiteNotes = NOTES.filter(n => !n.isBlack);

  const handleNoteStart = useCallback((index: number, freq: number) => {
    setActiveNotes((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
    audioEngine.playNote(index, freq);
  }, []);

  const handleNoteStop = useCallback((index: number) => {
    setActiveNotes((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
    audioEngine.stopNote(index);
  }, []);

  const handleMinimapPointer = (e: React.PointerEvent | PointerEvent) => {
    if (!minimapRef.current) return;
    const rect = minimapRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const handleWidth = zoom / TOTAL_WHITE_KEYS;
    const offset = x - handleWidth / 2;
    // Bound the offset so it never goes into negative or past the maximum scrollable area
    setScrollOffset(Math.min(Math.max(0, offset), 1 - handleWidth));
  };

  useEffect(() => {
    // When zoom changes, we might need to adjust scrollOffset to stay in bounds
    const handleWidth = zoom / TOTAL_WHITE_KEYS;
    setScrollOffset(prev => Math.min(prev, Math.max(0, 1 - handleWidth)));
  }, [zoom]);

  useEffect(() => {
    if (isDragging) {
      const onMove = (e: PointerEvent) => handleMinimapPointer(e);
      const onUp = () => setIsDragging(false);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
    }
  }, [isDragging, zoom]);

  // Use clamped offset for rendering
  const handleWidth = zoom / TOTAL_WHITE_KEYS;
  const clampedOffset = Math.min(Math.max(0, scrollOffset), Math.max(0, 1 - handleWidth));

  return (
    <div className="fixed inset-0 bg-[#0a0a0b] text-[#e0e0e0] flex flex-col font-sans overflow-hidden select-none touch-none">
      {/* Top Navigation / Controls */}
      <div className="absolute top-4 left-4 right-4 flex justify-between items-start z-50 pointer-events-none">
        {/* Left Control Group */}
        <div className="flex items-center gap-1 p-1 bg-black/40 backdrop-blur-md rounded-2xl border border-white/5 pointer-events-auto shadow-lg">
          <button 
            onClick={() => setIsRecording(!isRecording)}
            className={`p-2.5 rounded-xl transition-all ${isRecording ? 'text-amber-500' : 'text-white/40 hover:text-white'}`}
          >
            <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-amber-500 shadow-[0_0_8px_#f59e0b]' : 'bg-current'}`} />
          </button>
          <button className="p-2.5 rounded-xl text-white/40 hover:text-white transition-all">
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M8 5v14l11-7z" /></svg>
          </button>
          <button className="p-2.5 rounded-xl text-white/40 hover:text-white transition-all">
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {/* Middle: Instrument Switcher */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 p-1 bg-black/40 backdrop-blur-md rounded-2xl border border-white/5 pointer-events-auto shadow-lg">
          <button 
            onClick={() => setInstrument('piano')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${instrument === 'piano' ? 'bg-white/10 text-white border border-white/10' : 'text-white/40 hover:text-white'}`}
          >
            <Piano className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-widest hidden sm:inline">Piano</span>
          </button>
          <button 
            onClick={() => setInstrument('saxophone')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${instrument === 'saxophone' ? 'bg-amber-500/20 text-amber-500 border border-amber-500/20' : 'text-white/40 hover:text-white'}`}
          >
            <Volume2 className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-widest hidden sm:inline">Saxophone</span>
          </button>
        </div>

        {/* Right Control Group */}
        <div className="flex items-center gap-1 p-1 bg-black/40 backdrop-blur-md rounded-2xl border border-white/5 pointer-events-auto shadow-lg">
          <button className="p-2.5 rounded-xl text-white/40 hover:text-white transition-all">
            <Piano className="w-4 h-4" />
          </button>
          <button className="p-2.5 rounded-xl text-white/40 hover:text-white transition-all">
            <Info className="w-4 h-4" />
          </button>
          <button className="p-2.5 rounded-xl text-white/40 hover:text-white transition-all">
            <div className="w-4 h-4 border-2 border-current rounded-full flex items-center justify-center">
              <div className="w-1 h-2 bg-current" />
            </div>
          </button>
        </div>
      </div>

      {/* Main Piano Canvas */}
      <main className="flex-1 flex items-center justify-center p-2 pt-20 pb-24 md:p-8 md:pt-24 md:pb-32 bg-[radial-gradient(circle_at_center,_#1a1a1c_0%,_#0a0a0b_100%)] overflow-hidden">
        <div 
          ref={containerRef}
          className="relative w-full h-full flex shadow-[0_50px_100px_-20px_rgba(0,0,0,0.8)] overflow-hidden rounded-xl md:rounded-2xl"
        >
          {/* Internal Casing Shadow */}
          <div className="absolute inset-0 pointer-events-none z-30 shadow-[inset_0_20px_40px_rgba(0,0,0,0.8)] border border-white/5 rounded-xl md:rounded-2xl" />

          {/* Scalable Inner Wrapper */}
          <div 
            className="absolute inset-y-0 flex h-full transition-transform duration-300 ease-out"
            style={{ 
              width: `${(TOTAL_WHITE_KEYS / zoom) * 100}%`,
              transform: `translateX(-${clampedOffset * 100}%)`
            }}
          >
            {/* White Keys */}
            <div className="flex w-full h-full gap-[1px] md:gap-[2px] bg-black">
              {whiteNotes.map((note) => (
                <button
                  key={note.index}
                  onPointerDown={(e) => {
                    (e.target as HTMLButtonElement).releasePointerCapture(e.pointerId);
                    handleNoteStart(note.index, note.freq);
                  }}
                  onPointerUp={() => handleNoteStop(note.index)}
                  onPointerLeave={() => handleNoteStop(note.index)}
                  onPointerEnter={(e) => {
                    if (e.buttons === 1) handleNoteStart(note.index, note.freq);
                  }}
                  className={`
                    flex-1 h-full relative transition-all duration-75 rounded-b-xl border-t border-white/5
                    ${activeNotes.has(note.index) 
                      ? 'bg-[#444444] translate-y-2 shadow-[inset_0_10px_20px_rgba(0,0,0,0.8)] border-b-2 border-amber-500/20' 
                      : 'bg-gradient-to-b from-[#2a2a2c] via-[#222224] to-[#1a1a1c] shadow-[0_15px_0_#111111,0_20px_40px_rgba(0,0,0,0.5)]'
                    }
                  `}
                />
              ))}
            </div>

            {/* Black Keys Overlay */}
            <div className="absolute inset-0 pointer-events-none flex h-[58%] px-[1px]">
              {whiteNotes.map((whiteNote, i) => {
                const blackNote = NOTES.find(n => n.index === whiteNote.index + 1 && n.isBlack);
                if (!blackNote) return <div key={i} className="flex-1" />;

                return (
                  <div key={i} className="flex-1 relative">
                    <button
                      onPointerDown={(e) => {
                        (e.target as HTMLButtonElement).releasePointerCapture(e.pointerId);
                        handleNoteStart(blackNote.index, blackNote.freq);
                      }}
                      onPointerUp={() => handleNoteStop(blackNote.index)}
                      onPointerLeave={() => handleNoteStop(blackNote.index)}
                      onPointerEnter={(e) => {
                        if (e.buttons === 1) handleNoteStart(blackNote.index, blackNote.freq);
                      }}
                      className={`
                        absolute right-[-18px] md:right-[-1.8vw] w-[60%] md:w-[70%] h-full rounded-b-lg border-x border-b border-white/5 pointer-events-auto z-40
                        transition-all duration-75 shadow-[0_10px_30px_rgba(0,0,0,0.8)]
                        ${activeNotes.has(blackNote.index)
                          ? 'bg-[#151517] translate-y-2 shadow-[inset_0_5px_10px_rgba(255,255,255,0.05)]'
                          : 'bg-gradient-to-b from-[#1a1a1c] via-[#111113] to-[#08080a] hover:from-[#222224]'
                        }
                      `}
                    >
                      <div className="absolute top-0 left-1 right-1 h-1 bg-white/5 rounded-full" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Mini-Map & System Controls */}
      <div className="absolute bottom-4 left-4 right-4 h-16 flex items-center gap-4 z-50 pointer-events-none">
        {/* Lock Component */}
        <div className="p-1 bg-black/40 backdrop-blur-md rounded-2xl border border-white/5 pointer-events-auto shadow-lg">
          <button className="p-3 rounded-xl text-amber-500 bg-amber-500/10 border border-amber-500/20">
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </button>
        </div>

        {/* Scrollable Minimap with black keys styling */}
        <div 
          ref={minimapRef}
          onPointerDown={(e) => {
            setIsDragging(true);
            handleMinimapPointer(e);
          }}
          className="flex-1 h-12 bg-black/80 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden flex relative p-[1px] cursor-crosshair pointer-events-auto shadow-2xl scale-[0.98] origin-bottom sm:scale-100"
        >
          {/* White Keys in Minimap */}
          <div className="flex w-full h-full gap-[0.5px]">
            {whiteNotes.map((_, i) => (
              <div key={i} className="flex-1 h-full bg-white/5 border-t border-white/5" />
            ))}
          </div>
          
          {/* Black Keys in Minimap */}
          <div className="absolute inset-0 flex h-[55%] pointer-events-none px-[1px]">
            {whiteNotes.map((whiteNote, i) => {
              const blackNote = NOTES.find(n => n.index === whiteNote.index + 1 && n.isBlack);
              if (!blackNote) return <div key={i} className="flex-1" />;
              
              return (
                <div key={i} className="flex-1 relative">
                  <div className="absolute right-[-1.5px] w-[3px] h-full bg-black/80 rounded-b-[1px] border border-white/10 z-10" />
                </div>
              );
            })}
          </div>

          {/* Scroll Handle */}
          <div 
            className="absolute top-0 bottom-0 bg-white/5 rounded-lg border-2 border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.1)] group transition-[left,width] duration-300 ease-out cursor-grab active:cursor-grabbing backdrop-blur-none z-20"
            style={{ 
              left: `${clampedOffset * 100}%`,
              width: `${handleWidth * 100}%`
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center gap-0.5 md:gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
              <div className="w-[1px] md:w-[1px] h-4 bg-amber-500/40 rounded-full" />
              <div className="w-[1px] md:w-[1px] h-4 bg-amber-500/40 rounded-full" />
            </div>
            {/* Gloss Highlight on handle */}
            <div className="absolute inset-x-1 top-0.5 h-px bg-white/20 rounded-full" />
          </div>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1 p-1 bg-black/40 backdrop-blur-md rounded-2xl border border-white/5 pointer-events-auto shadow-lg">
          <button 
            className="p-3 rounded-xl text-white/40 hover:text-white transition-all bg-white/5 border border-white/5"
            onClick={() => setZoom(prev => Math.max(prev - 3, 5))}
            title="Zoom In (Fewer Keys)"
          >
            <div className="w-3 h-0.5 bg-current rounded-full" />
          </button>
          <button 
             className="p-3 rounded-xl text-white/40 hover:text-white transition-all bg-white/5 border border-white/5"
             onClick={() => setZoom(prev => Math.min(prev + 3, 40))}
             title="Zoom Out (More Keys)"
          >
            <div className="relative w-3 h-3 flex items-center justify-center">
              <div className="absolute w-3 h-0.5 bg-current rounded-full" />
              <div className="absolute w-0.5 h-3 bg-current rounded-full" />
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}


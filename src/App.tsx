/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Piano, Settings, Volume2, Info } from 'lucide-react';

// --- Constants & Types ---

type NoteInfo = {
  name: string;
  index: number; // Semitone offset from C4
  freq: number;
  isBlack: boolean;
};

const NOTES_COUNT = 20; // C4 to G5 (inclusive)
const C4_FREQ = 261.63;

const generateNotes = (): NoteInfo[] => {
  const notes: NoteInfo[] = [];
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  
  for (let i = 0; i < NOTES_COUNT; i++) {
    const name = noteNames[i % 12];
    const octave = 4 + Math.floor(i / 12);
    const freq = 440 * Math.pow(2, (i - 9) / 12); // A4 is index 9 (C4 offset)
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

// --- Audio Engine ---

class AudioEngine {
  private ctx: AudioContext | null = null;
  private activeOscillators: Map<number, { osc: OscillatorNode; gain: GainNode }> = new Map();
  private masterGain: GainNode | null = null;

  constructor() {
    // Context is created on first user interaction
  }

  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.3, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playNote(noteIndex: number, freq: number) {
    this.init();
    if (!this.ctx || !this.masterGain) return;

    // Stop if already playing (prevent duplicates)
    this.stopNote(noteIndex);

    const now = this.ctx.currentTime;
    
    // Create Oscillator
    const osc = this.ctx.createOscillator();
    // Use a mix of waves for a "clean piano" feel (Triangle/Sine)
    // Actually, one triangle wave with a quick filtering or additive 
    // synthesis is better, but start simple: Triangle.
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);

    // ADSR Envelope
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.8, now + 0.015); // Quick attack
    gain.gain.exponentialRampToValueAtTime(0.4, now + 0.1); // Decay to sustain level

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    this.activeOscillators.set(noteIndex, { osc, gain });
  }

  stopNote(noteIndex: number) {
    const active = this.activeOscillators.get(noteIndex);
    if (!active || !this.ctx) return;

    const { osc, gain } = active;
    const now = this.ctx.currentTime;

    // Release phase
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3); // 300ms release

    osc.stop(now + 0.35);
    this.activeOscillators.delete(noteIndex);
  }

  setVolume(v: number) {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
    }
  }
}

const audioEngine = new AudioEngine();

// --- Components ---

export default function App() {
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [volume, setVolume] = useState(0.3);
  const [showLabels, setShowLabels] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      // In a real multi-touch scenario, we'd track pointers.
      // But for a simple web interface, we just want to ensure notes don't get stuck.
      // However, stopping all notes on mouseUp might break chord playing if they drag off.
      // So pointerEvents on each key is actually better.
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const whiteNotes = NOTES.filter(n => !n.isBlack);
  const blackNotes = NOTES.filter(n => n.isBlack);

  return (
    <div className="fixed inset-0 bg-[#0a0a0b] text-[#e0e0e0] flex flex-col font-sans overflow-hidden select-none touch-none">
      {/* Header Section */}
      <header className="p-4 md:p-6 flex justify-between items-center border-b border-white/5 bg-[#0a0a0b] z-30">
        <div className="flex items-center space-x-3">
          <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)] animate-pulse"></div>
          <div className="flex flex-col">
            <h1 className="text-sm md:text-xl font-bold tracking-widest uppercase">Virtuoso Synth v1.0</h1>
            <span className="text-[8px] md:text-[10px] uppercase opacity-40 font-mono tracking-tighter">Real-time Audio Engine // Buffered</span>
          </div>
        </div>
        
        <div className="flex items-center space-x-4 md:space-x-8">
          <div className="hidden md:flex flex-col items-center">
            <span className="text-[10px] uppercase opacity-40 mb-1">Gain</span>
            <div className="flex items-center gap-3 bg-[#1a1a1c] rounded p-1.5 border border-white/5">
              <Volume2 className="w-3 h-3 text-[#3b82f6]" />
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.05" 
                value={volume}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setVolume(v);
                  audioEngine.setVolume(v);
                }}
                className="w-20 md:w-24 accent-[#3b82f6] opacity-60 hover:opacity-100 transition-opacity"
              />
            </div>
          </div>
          
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase opacity-40 mb-1">Engine State</span>
            <button 
              onClick={() => setShowLabels(!showLabels)}
              className={`flex items-center gap-2 px-3 py-1 rounded border transition-all ${showLabels ? 'bg-white/10 border-white/20 text-white' : 'border-white/5 text-white/40 hover:text-white'}`}
            >
              <Settings className="w-3 h-3" />
              <span className="text-[10px] uppercase font-mono">{showLabels ? 'Debug On' : 'Hidden'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Visualizer Area */}
      <div className="flex-grow flex flex-col justify-center items-center relative overflow-hidden px-4">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_#3b82f6_0%,_transparent_70%)] pointer-events-none"></div>
        
        <div className="w-full max-w-4xl h-32 md:h-48 border border-white/5 rounded-2xl bg-black/40 backdrop-blur-xl flex items-center justify-center relative overflow-hidden shadow-[0_0_40px_rgba(59,130,246,0.1)]">
          {/* Oscilloscope simulation */}
          <svg className="w-full h-full opacity-40" viewBox="0 0 400 100" preserveAspectRatio="none">
            <motion.path 
              animate={{ 
                d: activeNotes.size > 0 
                  ? "M0 50 Q 50 10 100 50 T 200 50 T 300 50 T 400 50" 
                  : "M0 50 L 400 50" 
              }}
              stroke="#3b82f6" fill="none" strokeWidth="2" 
            />
            <motion.path 
              animate={{ 
                d: activeNotes.size > 1 
                  ? "M0 50 Q 50 90 100 50 T 200 50 T 300 50 T 400 50" 
                  : "M0 50 L 400 50" 
              }}
              stroke="#06b6d4" fill="none" strokeWidth="1" opacity="0.5" 
            />
          </svg>
          
          <div className="absolute bottom-4 left-6 text-[8px] md:text-[10px] uppercase opacity-40 font-mono">
            Mode: Poly-Synth | {activeNotes.size > 0 ? Array.from(activeNotes).map((idx: number) => Math.round(NOTES[idx].freq) + 'Hz').join(' / ') : 'Standby'}
          </div>
          <div className="absolute top-4 right-6 text-[8px] md:text-[10px] uppercase opacity-40 font-mono flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${activeNotes.size > 0 ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]' : 'bg-white/10'}`} />
            Signal: {activeNotes.size} Voices active
          </div>
        </div>
      </div>

      {/* Keyboard Section */}
      <div className="h-[250px] md:h-[350px] w-full px-4 md:px-12 pb-6 md:pb-12 relative flex justify-center z-20">
        <div 
          ref={containerRef}
          className="relative w-full max-w-5xl h-full flex shadow-[0_-20px_50px_-20px_rgba(59,130,246,0.3)]"
        >
          {/* White Keys */}
          <div className="flex w-full h-full">
            {whiteNotes.map((note) => (
              <button
                key={note.index}
                id={`key-${note.index}`}
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
                  flex-1 h-full border border-black/20 relative flex flex-col justify-end items-center pb-4
                  transition-all duration-75 uppercase font-bold text-[10px] md:text-sm select-none rounded-b-lg
                  ${activeNotes.has(note.index) 
                    ? 'bg-blue-200 translate-y-1 shadow-[inset_0_4px_10px_rgba(59,130,246,0.4)] text-[#3b82f6]' 
                    : 'bg-[#f0f0f0] text-black/30 hover:bg-white'
                  }
                `}
              >
                {showLabels && (
                  <span className="pointer-events-none">{note.name.replace(/\d+/, '')}</span>
                )}
              </button>
            ))}
          </div>

          {/* Black Keys Overlay */}
          <div className="absolute inset-0 pointer-events-none flex h-[60%] px-[1px]">
            {/* Logic for spacing based on 1.5 octave range */}
            {Array.from({ length: 12 }).map((_, i) => {
              const whiteKeyPattern = [true, true, false, true, true, true, false];
              const shouldHaveBlackKey = whiteKeyPattern[i % 7];
              if (!shouldHaveBlackKey || i === 11) return <div key={i} className="flex-1" />;

              const whiteNote = whiteNotes[i];
              const blackNote = NOTES[whiteNote.index + 1];
              if (!blackNote || !blackNote.isBlack) return <div key={i} className="flex-1" />;

              return (
                <div key={i} className="flex-1 relative">
                  <button
                    id={`key-${blackNote.index}`}
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
                      absolute right-[-14px] w-7 md:w-10 h-full rounded-b border-x border-b border-white/5 pointer-events-auto shadow-2xl transition-all duration-75
                      ${activeNotes.has(blackNote.index)
                        ? 'bg-cyan-900 translate-y-1 shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                        : 'bg-[#1a1a1b] hover:bg-[#252527]'
                      }
                    `}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer Controls */}
      <footer className="p-4 flex justify-between bg-[#0a0a0b] border-t border-white/5 shadow-[0_-10px_30px_rgba(0,0,0,0.5)] z-30">
        <div className="flex space-x-4 md:space-x-8">
          <div className="flex flex-col">
            <span className="text-[8px] md:text-[9px] uppercase opacity-30 font-mono">Buffer Delay</span>
            <span className="text-[10px] md:text-xs text-cyan-400 font-mono">15.4ms</span>
          </div>
          <div className="hidden sm:flex flex-col">
            <span className="text-[9px] uppercase opacity-30 font-mono">Output Protocol</span>
            <span className="text-xs font-mono">SINE_WAVE_ADSR</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[8px] md:text-[9px] uppercase opacity-30 font-mono">Active Nodes</span>
            <span className={`text-[10px] md:text-xs font-mono transition-colors ${activeNotes.size > 0 ? 'text-blue-400' : 'text-white/40'}`}>
              {activeNotes.size}
            </span>
          </div>
        </div>
        <div className="text-[8px] md:text-[10px] uppercase opacity-30 self-center tracking-tighter font-mono text-right">
          WebAudio Engine Interface • Low-Latency V1.4
        </div>
      </footer>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { DraftClockState } from '../lib/keeper/types.js';
import { elapsedMs } from '../lib/league/draftClock.js';
import { draftCues, type ClockLook, type DraftCue } from '../lib/league/draftSounds.js';

const SOUND_KEY = 'fbb-draft-sound';

/** Notes for each cue: pitch in hertz and length in seconds, played in a row. */
const TUNES: Record<DraftCue, ReadonlyArray<readonly [number, number]>> = {
  up: [[660, 0.16], [880, 0.28]],
  'two-minutes': [[880, 0.12], [0, 0.08], [880, 0.12], [0, 0.08], [880, 0.12]],
  clock: [[990, 0.14], [740, 0.14], [990, 0.14], [740, 0.14], [990, 0.24]],
};
const BUZZ: Record<DraftCue, number[]> = { up: [150, 80, 150], 'two-minutes': [100, 60, 100, 60, 100], clock: [300, 100, 300] };

let audio: AudioContext | null = null;

/** Browsers stay silent until the person touches the page; the first touch wakes the sound. */
function wake(): void {
  try {
    if (!audio) audio = new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    /* no sound on this browser */
  }
}

function play(cue: DraftCue): void {
  try {
    navigator.vibrate?.(BUZZ[cue]);
  } catch {
    /* ignore */
  }
  if (!audio || audio.state !== 'running') return;
  let at = audio.currentTime + 0.02;
  for (const [pitch, length] of TUNES[cue]) {
    if (pitch > 0) {
      const tone = audio.createOscillator();
      const volume = audio.createGain();
      tone.type = 'triangle';
      tone.frequency.value = pitch;
      volume.gain.setValueAtTime(0.0001, at);
      volume.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, at + length);
      tone.connect(volume).connect(audio.destination);
      tone.start(at);
      tone.stop(at + length + 0.02);
    }
    at += length;
  }
}

/**
 * Draft sounds: a chime when your pick comes up and beeps at two minutes on
 * it, and an alarm on every phone whenever anyone calls CLOCK. Phones that
 * can also buzz. The person can turn it off; the choice stays on this phone.
 */
export function useDraftSounds(input: {
  enabled: boolean;
  clock: DraftClockState | null | undefined;
  onClockOverall: number | null;
  mine: boolean;
}): { soundOn: boolean; setSoundOn: (on: boolean) => void } {
  const { enabled, clock, onClockOverall, mine } = input;
  const [soundOn, setSoundOnState] = useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const setSoundOn = (on: boolean) => {
    setSoundOnState(on);
    if (on) wake();
    try {
      localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!enabled || !soundOn) return;
    document.addEventListener('pointerdown', wake);
    document.addEventListener('keydown', wake);
    return () => {
      document.removeEventListener('pointerdown', wake);
      document.removeEventListener('keydown', wake);
    };
  }, [enabled, soundOn]);

  const last = useRef<ClockLook | null>(null);
  useEffect(() => {
    if (!enabled || !soundOn) {
      last.current = null;
      return;
    }
    const check = () => {
      const now: ClockLook = {
        mine,
        overall: onClockOverall,
        elapsedMs: elapsedMs(clock, Date.now()),
        calledAt: clock?.call?.at ?? null,
      };
      for (const cue of draftCues(last.current, now)) play(cue);
      last.current = now;
    };
    check();
    const tick = window.setInterval(check, 500);
    return () => window.clearInterval(tick);
  }, [enabled, soundOn, clock, onClockOverall, mine]);

  return { soundOn, setSoundOn };
}

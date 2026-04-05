/**
 * VoiceAccessibilityModal.jsx
 * 
 * Voice-driven navigation assistant for blind/visually impaired users.
 * 
 * AUDIO PIPELINE (browser side):
 * getUserMedia → AudioContext → resampler (44100/48000 → 16000 Hz) 
 * → Float32→Int16 converter → Int16Array chunks 
 * → Socket.IO binary emit → Vosk backend → transcript back via Socket.IO
 * 
 * RESAMPLER IMPLEMENTATION:
 * Uses AudioWorklet if available (Chrome/Edge/Safari), falls back to
 * ScriptProcessorNode (all browsers including Firefox).
 * 
 * STATE MACHINE:
 * IDLE → GREETING → COLLECTING_START → COLLECTING_DESTINATION 
 * → COLLECTING_MODE → CONFIRMING → ROUTING → NAVIGATING → IDLE
 * 
 * WAKE WORD:
 * Web Speech API SpeechRecognition in continuous mode detects "tryver".
 * Falls back to a "Tap to Speak" button if SpeechRecognition unavailable.
 * 
 * TTS:
 * window.speechSynthesis. No external library.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';

// ============================================================================
// AudioWorklet Processor Code (injected as Blob URL)
// ============================================================================

const AUDIO_WORKLET_CODE = `
class VoskResampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.inputSampleRate = options.processorOptions.inputSampleRate || 44100;
    this.outputSampleRate = 16000;
    this.ratio = this.inputSampleRate / this.outputSampleRate;
    this.buffer = [];
    this.chunkSize = 4000;  // 250ms of audio at 16kHz (4000 samples * 2 bytes = 8000 bytes)
  }
  
  resample(inputBuffer) {
    const outputLength = Math.round(inputBuffer.length / this.ratio);
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const pos = i * this.ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      output[i] = idx + 1 < inputBuffer.length
        ? inputBuffer[idx] * (1 - frac) + inputBuffer[idx + 1] * frac
        : inputBuffer[idx] || 0;
    }
    return output;
  }
  
  float32ToInt16(float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const clamped = Math.max(-1.0, Math.min(1.0, float32Array[i]));
      int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    }
    return int16;
  }
  
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    
    const channelData = input[0];
    const resampled = this.resample(channelData);
    
    for (let i = 0; i < resampled.length; i++) {
      this.buffer.push(resampled[i]);
    }
    
    while (this.buffer.length >= this.chunkSize) {
      const chunk = this.buffer.splice(0, this.chunkSize);
      const float32Chunk = new Float32Array(chunk);
      const int16Chunk = this.float32ToInt16(float32Chunk);
      this.port.postMessage({ pcmData: int16Chunk.buffer }, [int16Chunk.buffer]);
    }
    
    return true;
  }
}

registerProcessor('vosk-resampler', VoskResampler);
`;

// ScriptProcessorNode fallback (runs on main thread, deprecated but universally supported)
const createScriptProcessorFallback = (audioContext, stream, onChunk) => {
  const source = audioContext.createMediaStreamSource(stream);
  const inputSampleRate = audioContext.sampleRate;
  const outputSampleRate = 16000;
  const ratio = inputSampleRate / outputSampleRate;
  const bufferSize = 4096;
  
  const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
  let buffer = [];
  const chunkSize = 4000;
  
  processor.onaudioprocess = (event) => {
    const inputData = event.inputBuffer.getChannelData(0);
    const outputLength = Math.round(inputData.length / ratio);
    const resampled = new Float32Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      resampled[i] = idx + 1 < inputData.length
        ? inputData[idx] * (1 - frac) + inputData[idx + 1] * frac
        : inputData[idx] || 0;
    }
    
    for (let i = 0; i < resampled.length; i++) {
      buffer.push(resampled[i]);
    }
    
    while (buffer.length >= chunkSize) {
      const chunk = buffer.splice(0, chunkSize);
      const float32Chunk = new Float32Array(chunk);
      const int16Chunk = new Int16Array(float32Chunk.length);
      for (let i = 0; i < float32Chunk.length; i++) {
        const c = Math.max(-1, Math.min(1, float32Chunk[i]));
        int16Chunk[i] = c < 0 ? c * 32768 : c * 32767;
      }
      onChunk(int16Chunk.buffer);
    }
  };
  
  source.connect(processor);
  processor.connect(audioContext.destination);
  
  return { source, processor };
};

// ============================================================================
// Constants
// ============================================================================

const STATES = {
  IDLE: 'IDLE',
  GREETING: 'GREETING',
  COLLECTING_START: 'COLLECTING_START',
  COLLECTING_DESTINATION: 'COLLECTING_DESTINATION',
  COLLECTING_MODE: 'COLLECTING_MODE',
  CONFIRMING: 'CONFIRMING',
  ROUTING: 'ROUTING',
  NAVIGATING: 'NAVIGATING',
};

const MAX_RETRIES = 2;
const RECORDING_DURATIONS = {
  GREETING: 8000,
  COLLECTING_START: 10000,
  COLLECTING_DESTINATION: 10000,
  COLLECTING_MODE: 5000,
  CONFIRMING: 5000,
  NAVIGATING: 4000,
};

const WORD_TO_NUMBER = {
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14,
  'fifteen': 15, 'sixteen': 16, 'seventeen': 17, 'eighteen': 18,
  'nineteen': 19, 'twenty': 20, 'first': 1, 'second': 2, 'third': 3,
  'fourth': 4, 'fifth': 5, 'sixth': 6, 'seventh': 7, 'eighth': 8,
  'ninth': 9, 'tenth': 10,
};

// ============================================================================
// Custom Hook: useVoiceSocket
// ============================================================================

const useVoiceSocket = (serverUrl = 'http://127.0.0.1:5000') => {
  const socketRef = useRef(null);
  const [sessionId, setSessionId] = useState(null);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [voskReady, setVoskReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  
  const audioContextRef = useRef(null);
  const streamRef = useRef(null);
  const workletNodeRef = useRef(null);
  const scriptProcessorRef = useRef(null);
  const workletBlobUrlRef = useRef(null);
  const isRecordingRef = useRef(false);
  const sessionIdRef = useRef(null);
  
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  
  useEffect(() => {
    fetch(`${serverUrl}/api/voice/status`)
      .then(r => r.json())
      .then(data => {
        setVoskReady(data.vosk_installed && data.model_loaded);
        if (!data.vosk_installed || !data.model_loaded) {
          setErrorMessage(data.vosk_installed 
            ? 'Vosk model not found. See backend/vosk-model/ setup.'
            : 'Vosk not installed. Run: pip install vosk');
        }
      })
      .catch(() => setErrorMessage('Cannot connect to Tryver server'));
  }, [serverUrl]);
  
  useEffect(() => {
    const socket = io(serverUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;
    
    socket.on('connect', () => {
      setIsConnected(true);
      setErrorMessage(null);
      socket.emit('voice_start_session', {});
    });
    
    socket.on('disconnect', () => {
      setIsConnected(false);
      setSessionId(null);
    });
    
    socket.on('voice_session_created', (data) => {
      setSessionId(data.session_id);
      sessionIdRef.current = data.session_id;
    });
    
    socket.on('voice_partial_result', (data) => {
      setPartialTranscript(data.transcript || '');
    });
    
    socket.on('voice_final_result', (data) => {
      setPartialTranscript('');
      if (data.transcript && data.transcript.trim()) {
        setFinalTranscript(data.transcript.trim().toLowerCase());
      } else {
        setFinalTranscript('__EMPTY__');
      }
    });
    
    socket.on('voice_error', (data) => {
      setErrorMessage(data.error);
    });
    
    return () => {
      if (sessionIdRef.current) {
        socket.emit('voice_destroy_session', { session_id: sessionIdRef.current });
      }
      socket.disconnect();
    };
  }, [serverUrl]);
  
  const sendAudioChunk = useCallback((pcmArrayBuffer, isFinal = false) => {
    if (!socketRef.current || !sessionIdRef.current) return;
    socketRef.current.emit('voice_audio_chunk', {
      session_id: sessionIdRef.current,
      audio_data: pcmArrayBuffer,
      is_final: isFinal,
    });
  }, []);
  
  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      streamRef.current = stream;
      
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;
      const nativeSampleRate = audioContext.sampleRate;
      
      let usingWorklet = false;
      if (audioContext.audioWorklet && audioContext.audioWorklet.addModule) {
        try {
          const blob = new Blob([AUDIO_WORKLET_CODE], { type: 'application/javascript' });
          const blobUrl = URL.createObjectURL(blob);
          workletBlobUrlRef.current = blobUrl;
          
          await audioContext.audioWorklet.addModule(blobUrl);
          
          const source = audioContext.createMediaStreamSource(stream);
          const workletNode = new AudioWorkletNode(audioContext, 'vosk-resampler', {
            processorOptions: { inputSampleRate: nativeSampleRate }
          });
          
          workletNode.port.onmessage = (event) => {
            if (isRecordingRef.current) {
              sendAudioChunk(event.data.pcmData, false);
            }
          };
          
          source.connect(workletNode);
          workletNodeRef.current = workletNode;
          usingWorklet = true;
          console.log('[Voice] Using AudioWorklet for audio processing');
        } catch (workletError) {
          console.warn('[Voice] AudioWorklet failed, falling back to ScriptProcessor:', workletError);
        }
      }
      
      if (!usingWorklet) {
        const { source, processor } = createScriptProcessorFallback(
          audioContext, stream, (pcmBuffer) => {
            if (isRecordingRef.current) {
              sendAudioChunk(pcmBuffer, false);
            }
          }
        );
        scriptProcessorRef.current = { source, processor };
        console.log('[Voice] Using ScriptProcessorNode fallback');
      }
      
      isRecordingRef.current = true;
      
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setErrorMessage('Microphone permission denied. Please allow microphone access in your browser settings and refresh the page.');
      } else {
        setErrorMessage(`Could not access microphone: ${err.message}`);
      }
    }
  }, [sendAudioChunk]);
  
  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    
    if (socketRef.current && sessionIdRef.current) {
      socketRef.current.emit('voice_stop_recording', { session_id: sessionIdRef.current });
    }
    
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.processor.disconnect();
      scriptProcessorRef.current.source.disconnect();
      scriptProcessorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (workletBlobUrlRef.current) {
      URL.revokeObjectURL(workletBlobUrlRef.current);
      workletBlobUrlRef.current = null;
    }
  }, []);
  
  return {
    sessionId, partialTranscript, finalTranscript, setFinalTranscript,
    startRecording, stopRecording, isConnected, voskReady, errorMessage,
  };
};

// ============================================================================
// Main Component
// ============================================================================

export default function VoiceAccessibilityModal({
  onRouteCalculated,
  onDismiss,
  userLocation,
  isVisible,
  onVisibilityChange,
}) {
  const [state, setState] = useState(STATES.IDLE);
  const [startPointRaw, setStartPointRaw] = useState('');
  const [destinationRaw, setDestinationRaw] = useState('');
  const [travelMode, setTravelMode] = useState('');
  const [routeData, setRouteData] = useState(null);
  const [routeId, setRouteId] = useState('');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Say "Hi Tryver" to begin');
  const [displayTranscript, setDisplayTranscript] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [speechRecognitionAvailable, setSpeechRecognitionAvailable] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  
  const stateRef = useRef(STATES.IDLE);
  const retryCountRef = useRef(0);
  const routeDataRef = useRef(null);
  const currentStepRef = useRef(0);
  const recordingTimerRef = useRef(null);
  const recognitionRef = useRef(null);
  const audioLevelTimerRef = useRef(null);
  const audioContextForLevelRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const handleNavigationCommandRef = useRef(null);
  
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { retryCountRef.current = retryCount; }, [retryCount]);
  useEffect(() => { routeDataRef.current = routeData; }, [routeData]);
  useEffect(() => { currentStepRef.current = currentStepIndex; }, [currentStepIndex]);
  
  const {
    sessionId, partialTranscript, finalTranscript, setFinalTranscript,
    startRecording, stopRecording, isConnected, voskReady,
  } = useVoiceSocket('http://127.0.0.1:5000');
  
  // Cancel speech when modal closes
  useEffect(() => {
    if (!isVisible) {
      window.speechSynthesis.cancel();
    }
  }, [isVisible]);
  
  // ── TTS ─────────────────────────────────────────────────────────────────────
  
  const speak = useCallback((text, onDone = null) => {
    if (!window.speechSynthesis) {
      setStatusMessage(text);
      if (onDone) setTimeout(onDone, 100);
      return;
    }
    
    window.speechSynthesis.cancel();
    setIsSpeaking(true);
    setStatusMessage(text);
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.88;
    utterance.pitch = 1.05;
    utterance.volume = 1.0;
    utterance.lang = 'en-US';
    
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v =>
      v.name.includes('Samantha') ||
      v.name.includes('Google US English Female') ||
      v.name.includes('Microsoft Zira') ||
      (v.lang === 'en-US' && v.localService)
    ) || voices.find(v => v.lang === 'en-US');
    if (preferred) utterance.voice = preferred;
    
    utterance.onend = () => {
      setIsSpeaking(false);
      if (onDone) onDone();
    };
    utterance.onerror = (e) => {
      setIsSpeaking(false);
      console.warn('[TTS] Error:', e.error);
      if (onDone) onDone();
    };
    
    if (text.length > 200) {
      const pauseResume = setInterval(() => {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.pause();
          setTimeout(() => window.speechSynthesis.resume(), 50);
        } else {
          clearInterval(pauseResume);
        }
      }, 10000);
      utterance.onend = () => {
        clearInterval(pauseResume);
        setIsSpeaking(false);
        if (onDone) onDone();
      };
    }
    
    window.speechSynthesis.speak(utterance);
  }, []);
  
  // ── Audio level visualizer ───────────────────────────────────────────────────
  
  const startAudioLevelMonitor = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioContextForLevelRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      analyserRef.current = analyser;
      
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setAudioLevel(Math.min(100, avg * 2.5));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      // non‑critical
    }
  }, []);
  
  const stopAudioLevelMonitor = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (audioContextForLevelRef.current) {
      audioContextForLevelRef.current.close().catch(() => {});
      audioContextForLevelRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);
  
  // ── Chime ───────────────────────────────────────────────────────────────────
  
  const playChime = useCallback((freq1 = 440, freq2 = 660) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [[freq1, 0, 0.2], [freq2, 0.25, 0.15]].forEach(([freq, startOffset, dur]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);
        gain.gain.setValueAtTime(0.25, ctx.currentTime + startOffset);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + dur);
        osc.start(ctx.currentTime + startOffset);
        osc.stop(ctx.currentTime + startOffset + dur + 0.05);
      });
    } catch (e) { /* non‑critical */ }
  }, []);
  
  // ── Recording with Vosk ─────────────────────────────────────────────────────
  
  const pendingTranscriptResolveRef = useRef(null);
  const pendingFallbackTimerRef = useRef(null);
  
  const startListeningWithVosk = useCallback((durationMs) => {
    return new Promise(async (resolve) => {
      if (!voskReady || !sessionId) {
        resolve(null);
        return;
      }
      
      const transcriptHandler = (transcript) => {
        clearTimeout(recordingTimerRef.current);
        stopRecording();
        setIsRecordingActive(false);
        stopAudioLevelMonitor();
        resolve(transcript === '__EMPTY__' ? null : transcript);
      };
      
      pendingTranscriptResolveRef.current = transcriptHandler;
      
      await startRecording();
      setIsRecordingActive(true);
      startAudioLevelMonitor();
      
      recordingTimerRef.current = setTimeout(() => {
        stopRecording();
        setIsRecordingActive(false);
        stopAudioLevelMonitor();
        const fallbackTimer = setTimeout(() => {
          pendingTranscriptResolveRef.current = null;
          resolve(null);
        }, 2000);
        pendingFallbackTimerRef.current = fallbackTimer;
      }, durationMs);
    });
  }, [voskReady, sessionId, startRecording, stopRecording, startAudioLevelMonitor, stopAudioLevelMonitor]);
  
  useEffect(() => {
    if (finalTranscript === null) return;
    
    if (pendingFallbackTimerRef.current) {
      clearTimeout(pendingFallbackTimerRef.current);
      pendingFallbackTimerRef.current = null;
    }
    
    if (pendingTranscriptResolveRef.current) {
      const resolve = pendingTranscriptResolveRef.current;
      pendingTranscriptResolveRef.current = null;
      setFinalTranscript(null);
      
      const text = finalTranscript === '__EMPTY__' ? null : finalTranscript;
      if (text) setDisplayTranscript(text);
      resolve(text);
    }
    
    setFinalTranscript(null);
  }, [finalTranscript, setFinalTranscript]);
  
  useEffect(() => {
    if (partialTranscript) setDisplayTranscript(partialTranscript + '...');
  }, [partialTranscript]);
  
  // ── Navigation command handler ──────────────────────────────────────────────
  
  const handleNavigationCommand = useCallback((text) => {
    const t = text.toLowerCase().trim();
    const route = routeDataRef.current;
    if (!route) return;
    
    const steps = route.steps || [];
    const totalSteps = steps.length;
    
    if (/\b(directions?|steps?|navigate|all steps|read steps)\b/.test(t)) {
      const allSteps = steps.map((s, i) => {
        const instr = s.instruction || s.maneuver?.instruction || `Step ${i + 1}`;
        const dist = s.distance || '';
        return `Step ${i + 1}: ${instr}${dist ? '. Distance: ' + dist : ''}`;
      }).join('. Pause. ');
      speak(`Here are all ${totalSteps} steps. ${allSteps}. End of directions.`);
      return;
    }
    
    if (/\b(next|next step|continue)\b/.test(t)) {
      const nextIdx = currentStepRef.current + 1;
      if (nextIdx >= totalSteps) {
        speak("You have reached the end of the directions. You should be arriving at your destination.");
        return;
      }
      setCurrentStepIndex(nextIdx);
      currentStepRef.current = nextIdx;
      const step = steps[nextIdx];
      const instr = step.instruction || step.maneuver?.instruction || `Step ${nextIdx + 1}`;
      speak(`Step ${nextIdx + 1} of ${totalSteps}: ${instr}`);
      return;
    }
    
    const stepMatch = t.match(/step\s+(\w+)/);
    if (stepMatch) {
      const wordOrNum = stepMatch[1];
      const num = parseInt(wordOrNum) || WORD_TO_NUMBER[wordOrNum];
      if (num && num >= 1 && num <= totalSteps) {
        const idx = num - 1;
        setCurrentStepIndex(idx);
        currentStepRef.current = idx;
        const step = steps[idx];
        const instr = step.instruction || `Step ${num}`;
        speak(`Step ${num} of ${totalSteps}: ${instr}`);
        return;
      }
    }
    
    if (/\b(repeat|again|say again|what did you say)\b/.test(t)) {
      const step = steps[currentStepRef.current];
      const instr = step?.instruction || `Step ${currentStepRef.current + 1}`;
      speak(`Repeating: Step ${currentStepRef.current + 1}: ${instr}`);
      return;
    }
    
    if (/\b(how far|distance|how many (kilometers?|miles?|meters?))\b/.test(t)) {
      speak(`Your total route distance is ${route.distance}.`);
      return;
    }
    
    if (/\b(how long|time|duration|when|eta|arrival)\b/.test(t)) {
      speak(`Your estimated travel time is ${route.duration}.`);
      return;
    }
    
    if (/\b(route id|route number|my route|what is my route)\b/.test(t)) {
      const idSpoken = route.route_id.replace(/-/g, ' dash ');
      speak(`Your route ID is ${idSpoken}.`);
      return;
    }
    
    if (/\b(safe|safety|danger|risk)\b/.test(t)) {
      const safety = route.safety || {};
      const level = safety.risk_level || 'unknown';
      const score = safety.overall_safety ? Math.round(safety.overall_safety * 100) : null;
      const msg = score 
        ? `Your route has a ${level} risk level with a safety score of ${score} percent.`
        : `Your route has a ${level} risk level.`;
      speak(msg);
      return;
    }
    
    if (/\b(new route|different route|change destination|start (a )?new)\b/.test(t)) {
      speak("Starting a new route.", () => {
        resetAllData();
        setState(STATES.GREETING);
      });
      return;
    }
    
    if (/\b(stop|cancel|exit|goodbye|bye|quit|end navigation)\b/.test(t)) {
      speak("Navigation ended. Goodbye! Say Hi Tryver anytime to start again.", () => {
        resetAllData();
        setState(STATES.IDLE);
      });
      return;
    }
    
    if (/\b(help|what can (i|you)|commands?|options?)\b/.test(t)) {
      speak("Available commands: directions, next step, step followed by a number, repeat, how far, how long, route ID, safety, new route, or stop.");
      return;
    }
    
    speak("I didn't understand that. You can say: directions, next step, repeat, how far, how long, route ID, or stop.");
  }, [speak]);
  
  handleNavigationCommandRef.current = handleNavigationCommand;
  
  // ── Wake word detection (Web Speech API) ───────────────────────────────────
  
  useEffect(() => {
    if (!isVisible) return;
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechRecognitionAvailable(false);
      return;
    }
    setSpeechRecognitionAvailable(true);
    
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 3;
    recognitionRef.current = recognition;
    
    recognition.onresult = (event) => {
      if (!['IDLE', 'NAVIGATING'].includes(stateRef.current)) return;
      
      const results = Array.from(event.results);
      const allText = results
        .flatMap(r => Array.from(r))
        .map(alt => alt.transcript.toLowerCase())
        .join(' ');
      
      if (stateRef.current === 'IDLE' && allText.includes('tryver')) {
        playChime(440, 660);
        recognition.stop();
        setState(STATES.GREETING);
        return;
      }
      
      const finalResult = results[results.length - 1];
      if (stateRef.current === 'NAVIGATING' && finalResult.isFinal) {
        if (handleNavigationCommandRef.current) {
          handleNavigationCommandRef.current(allText);
        }
      }
    };
    
    recognition.onerror = (e) => {
      if (e.error === 'not-allowed') {
        setErrorMessage("Microphone permission denied. Please allow microphone access.");
      }
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setTimeout(() => {
          if (['IDLE', 'NAVIGATING'].includes(stateRef.current) && isVisible) {
            try { recognition.start(); } catch(err) {}
          }
        }, 1500);
      }
    };
    
    recognition.onend = () => {
      setTimeout(() => {
        if (['IDLE', 'NAVIGATING'].includes(stateRef.current) && isVisible) {
          try { recognition.start(); } catch(err) {}
        }
      }, 500);
    };
    
    // DO NOT start automatically - wait for user gesture on the button
    
    return () => {
      try { recognition.stop(); } catch(e) {}
    };
  }, [isVisible, playChime]);
  
  // ── State machine handlers ─────────────────────────────────────────────────
  
  const resetAllData = useCallback(() => {
    setStartPointRaw('');
    setDestinationRaw('');
    setTravelMode('');
    setRouteData(null);
    routeDataRef.current = null;
    setRouteId('');
    setCurrentStepIndex(0);
    currentStepRef.current = 0;
    setDisplayTranscript('');
    retryCountRef.current = 0;
    setRetryCount(0);
  }, []);
  
  const handleGreetingState = useCallback(async () => {
    const prompt = "Hi! I'm Tryver, your navigation assistant. I'll help you plan your route step by step. First, what is your starting point? You can say an address, a landmark, or say 'current location' to use your GPS.";
    
    speak(prompt, async () => {
      const transcript = await startListeningWithVosk(RECORDING_DURATIONS.COLLECTING_START);
      
      if (transcript && transcript.length >= 3) {
        setStartPointRaw(transcript);
        retryCountRef.current = 0;
        setRetryCount(0);
        setState(STATES.COLLECTING_DESTINATION);
      } else {
        retryCountRef.current++;
        setRetryCount(retryCountRef.current);
        
        if (retryCountRef.current >= MAX_RETRIES) {
          speak("I'm having trouble hearing you. Let me start over.", () => {
            retryCountRef.current = 0;
            setRetryCount(0);
            resetAllData();
            setState(STATES.IDLE);
          });
        } else {
          speak("I didn't quite catch that. Please say your starting point again, clearly.", async () => {
            const retryTranscript = await startListeningWithVosk(RECORDING_DURATIONS.COLLECTING_START);
            if (retryTranscript && retryTranscript.length >= 3) {
              setStartPointRaw(retryTranscript);
              retryCountRef.current = 0;
              setRetryCount(0);
              setState(STATES.COLLECTING_DESTINATION);
            } else {
              speak("Let me start over.", () => {
                retryCountRef.current = 0;
                setRetryCount(0);
                resetAllData();
                setState(STATES.IDLE);
              });
            }
          });
        }
      }
    });
  }, [speak, startListeningWithVosk, resetAllData]);
  
  const handleDestinationState = useCallback(async () => {
    speak("Got it. Now, what is your destination? Please say the address or name of the place.", async () => {
      const transcript = await startListeningWithVosk(RECORDING_DURATIONS.COLLECTING_DESTINATION);
      
      const isValid = transcript && transcript.length >= 2 && 
                      transcript !== startPointRaw;
      
      if (isValid) {
        setDestinationRaw(transcript);
        retryCountRef.current = 0;
        setRetryCount(0);
        setState(STATES.COLLECTING_MODE);
      } else {
        const errorPrompt = transcript === startPointRaw
          ? "Your destination cannot be the same as your starting point. Please say a different destination."
          : "I didn't catch your destination. Please say the name or address of where you want to go.";
        
        retryCountRef.current++;
        if (retryCountRef.current >= MAX_RETRIES) {
          speak("Let me start over.", () => { resetAllData(); setState(STATES.IDLE); });
          return;
        }
        
        speak(errorPrompt, async () => {
          const retry = await startListeningWithVosk(RECORDING_DURATIONS.COLLECTING_DESTINATION);
          if (retry && retry.length >= 2 && retry !== startPointRaw) {
            setDestinationRaw(retry);
            retryCountRef.current = 0;
            setState(STATES.COLLECTING_MODE);
          } else {
            speak("Let me start over.", () => { resetAllData(); setState(STATES.IDLE); });
          }
        });
      }
    });
  }, [speak, startListeningWithVosk, startPointRaw, resetAllData]);
  
  const handleModeState = useCallback(async () => {
    speak("How would you like to travel? Say walking for a walking route, transit for bus routes, or wheelchair for an accessible wheelchair route.", async () => {
      const transcript = await startListeningWithVosk(RECORDING_DURATIONS.COLLECTING_MODE);
      
      let detectedMode = null;
      if (transcript) {
        if (/walk(ing)?/.test(transcript)) detectedMode = 'walk';
        else if (/transit|bus/.test(transcript)) detectedMode = 'transit';
        else if (/wheelchair|accessible|roll/.test(transcript)) detectedMode = 'wheelchair';
      }
      
      if (detectedMode) {
        setTravelMode(detectedMode);
        retryCountRef.current = 0;
        setState(STATES.CONFIRMING);
      } else {
        retryCountRef.current++;
        if (retryCountRef.current >= MAX_RETRIES) {
          speak("Let me start over.", () => { resetAllData(); setState(STATES.IDLE); });
          return;
        }
        speak("Please say walking, transit, or wheelchair.", async () => {
          const retry = await startListeningWithVosk(RECORDING_DURATIONS.COLLECTING_MODE);
          let mode = null;
          if (retry) {
            if (/walk/.test(retry)) mode = 'walk';
            else if (/transit|bus/.test(retry)) mode = 'transit';
            else if (/wheelchair|accessible/.test(retry)) mode = 'wheelchair';
          }
          if (mode) {
            setTravelMode(mode);
            retryCountRef.current = 0;
            setState(STATES.CONFIRMING);
          } else {
            speak("I'll use walking mode. Let me confirm your route.", () => {
              setTravelMode('walk');
              setState(STATES.CONFIRMING);
            });
          }
        });
      }
    });
  }, [speak, startListeningWithVosk, resetAllData]);
  
  const handleConfirmingState = useCallback(async () => {
    const modeLabel = travelMode === 'walk' ? 'walking'
                    : travelMode === 'transit' ? 'transit by bus'
                    : 'wheelchair accessible';
    
    const confirmation = `Let me confirm your route. Starting from ${startPointRaw}. Going to ${destinationRaw}. Travel mode: ${modeLabel}. Is that correct? Say yes to confirm or no to start over.`;
    
    speak(confirmation, async () => {
      const transcript = await startListeningWithVosk(RECORDING_DURATIONS.CONFIRMING);
      
      const isYes = transcript && /\b(yes|correct|confirm|yeah|yep|sure|right|okay|ok)\b/.test(transcript);
      const isNo = transcript && /\b(no|wrong|incorrect|restart|start over|different|change)\b/.test(transcript);
      
      if (isYes) {
        setState(STATES.ROUTING);
      } else if (isNo) {
        speak("No problem, let's start over from the beginning.", () => {
          resetAllData();
          setState(STATES.IDLE);
        });
      } else {
        retryCountRef.current++;
        if (retryCountRef.current >= MAX_RETRIES) {
          speak("I'll take that as a yes and calculate your route.", () => {
            setState(STATES.ROUTING);
          });
        } else {
          speak("Please say yes to confirm or no to start over.", async () => {
            const retry = await startListeningWithVosk(RECORDING_DURATIONS.CONFIRMING);
            const retryYes = retry && /\b(yes|correct|yeah|yep|ok)\b/.test(retry);
            if (retryYes) {
              setState(STATES.ROUTING);
            } else {
              speak("Let me start over.", () => { resetAllData(); setState(STATES.IDLE); });
            }
          });
        }
      }
    });
  }, [speak, startListeningWithVosk, startPointRaw, destinationRaw, travelMode, resetAllData]);
  
  const handleRoutingState = useCallback(async () => {
    speak("Perfect! Calculating your route now, please wait.");
    setIsLoading(true);
    setDisplayTranscript('');
    
    try {
      const body = {
        start: startPointRaw,
        destination: destinationRaw,
        mode: travelMode,
        user_lat: userLocation ? userLocation[0] : 40.4406,
        user_lng: userLocation ? userLocation[1] : -79.9959,
      };
      
      const response = await fetch('http://127.0.0.1:5000/api/voice-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      
      const data = await response.json();
      setIsLoading(false);
      
      if (data.success) {
        setRouteData(data);
        routeDataRef.current = data;
        setRouteId(data.route_id);
        setCurrentStepIndex(0);
        currentStepRef.current = 0;
        
        if (onRouteCalculated) {
          onRouteCalculated({
            success: true,
            route: {
              coordinates: (data.route_coords || []).map(p => ({
                lat: Array.isArray(p) ? p[0] : p.lat,
                lng: Array.isArray(p) ? p[1] : p.lng,
              })),
              steps: data.steps || [],
              distance: data.distance,
              duration: data.duration,
              safety: data.safety,
              start_address: data.start_address,
              end_address: data.end_address,
              travel_mode: data.travel_mode,
            },
            provider: data.provider,
          });
        }
        
        const routeIdSpoken = data.route_id.replace(/-/g, ' dash ');
        const numSteps = (data.steps || []).length;
        
        const announcement = [
          `Route found!`,
          `Your ${travelMode} route`,
          `from ${data.start_address}`,
          `to ${data.end_address}`,
          `is approximately ${data.distance} and will take ${data.duration}.`,
          `There are ${numSteps} navigation steps.`,
          `Your route ID is ${routeIdSpoken}.`,
          `Say directions to hear all steps.`,
          `Say next step to hear one step at a time.`,
          `Say repeat to hear this summary again.`,
          `Say stop to end navigation.`,
        ].join(' ');
        
        speak(announcement, () => {
          setState(STATES.NAVIGATING);
        });
        
      } else {
        const errCode = data.code || '';
        let errMsg = "I'm sorry, I couldn't find a route between those locations.";
        if (errCode === 'GEOCODE_FAILED_START') errMsg = `I couldn't find the starting location: ${startPointRaw}. Let's try again.`;
        if (errCode === 'GEOCODE_FAILED_DEST') errMsg = `I couldn't find the destination: ${destinationRaw}. Let's try again.`;
        
        speak(errMsg + " Let me start over.", () => {
          resetAllData();
          setState(STATES.IDLE);
        });
      }
    } catch (err) {
      setIsLoading(false);
      speak("I'm having trouble connecting to the server. Please check that Tryver is running and try again.", () => {
        resetAllData();
        setState(STATES.IDLE);
      });
    }
  }, [speak, startPointRaw, destinationRaw, travelMode, userLocation, onRouteCalculated, resetAllData]);
  
  useEffect(() => {
    if (!voskReady && state !== STATES.IDLE) {
      speak("Voice recognition is not available. Please install the Vosk model. See the browser console for instructions.");
      setState(STATES.IDLE);
      return;
    }
    
    switch (state) {
      case STATES.GREETING:
        handleGreetingState();
        break;
      case STATES.COLLECTING_DESTINATION:
        handleDestinationState();
        break;
      case STATES.COLLECTING_MODE:
        handleModeState();
        break;
      case STATES.CONFIRMING:
        handleConfirmingState();
        break;
      case STATES.ROUTING:
        handleRoutingState();
        break;
      default:
        break;
    }
  }, [state]);
  
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
      try { recognitionRef.current?.stop(); } catch(e) {}
      stopRecording();
      stopAudioLevelMonitor();
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
      if (pendingFallbackTimerRef.current) clearTimeout(pendingFallbackTimerRef.current);
    };
  }, [stopRecording, stopAudioLevelMonitor]);
  
  // ── Progress indicator ──────────────────────────────────────────────────────
  
  const progressSteps = useMemo(() => [
    { label: 'Start', done: !!startPointRaw, active: state === STATES.GREETING || state === STATES.COLLECTING_START },
    { label: 'Destination', done: !!destinationRaw, active: state === STATES.COLLECTING_DESTINATION },
    { label: 'Mode', done: !!travelMode, active: state === STATES.COLLECTING_MODE },
    { label: 'Confirm', done: state === STATES.ROUTING || state === STATES.NAVIGATING, active: state === STATES.CONFIRMING },
  ], [startPointRaw, destinationRaw, travelMode, state]);
  
  const waveformBars = useMemo(() => {
    const barCount = 7;
    return Array.from({ length: barCount }, (_, i) => {
      const phase = (Date.now() / 200 + i * 0.7) % (Math.PI * 2);
      const baseHeight = isRecordingActive 
        ? Math.max(8, (audioLevel / 100) * 48 + Math.sin(phase) * 12)
        : 4 + Math.sin(phase) * 2;
      return Math.round(baseHeight);
    });
  }, [audioLevel, isRecordingActive]);
  
  const getStateIcon = () => {
    if (isLoading) return '⏳';
    if (isRecordingActive) return '🔴';
    if (isSpeaking) return '🔊';
    if (state === STATES.NAVIGATING) return '🗺️';
    if (state === STATES.IDLE) return '🎤';
    return '🎙️';
  };
  
  const getStateBadge = () => {
    if (isLoading) return { text: 'ROUTING', color: 'var(--amber)' };
    if (isRecordingActive) return { text: 'LISTENING', color: 'var(--red)' };
    if (isSpeaking) return { text: 'SPEAKING', color: 'var(--green)' };
    if (state === STATES.NAVIGATING) return { text: 'NAVIGATING', color: 'var(--blue)' };
    return { text: 'READY', color: 'var(--wood)' };
  };
  
  const badge = getStateBadge();
  
  if (!isVisible) {
    return null;
  }
  
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tryver Voice Navigation Assistant"
      style={{
        position: 'fixed',
        bottom: state === STATES.IDLE ? '50%' : '24px',
        right: state === STATES.IDLE ? '50%' : '70px',
        transform: state === STATES.IDLE ? 'translate(50%, 50%)' : 'none',
        width: state === STATES.IDLE ? '340px' : '360px',
        background: 'var(--surface)',
        border: `1px solid ${isRecordingActive ? 'var(--red)' : isSpeaking ? 'var(--green)' : 'var(--border2)'}`,
        borderRadius: '20px',
        backdropFilter: 'blur(32px)',
        boxShadow: 'var(--sh-lg)',
        zIndex: 300,
        fontFamily: 'var(--ff-b)',
        overflow: 'hidden',
        transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
        animation: 'slideUp 0.3s ease',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{
        padding: '14px 16px 10px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        background: 'rgba(232,168,112,0.05)',
      }}>
        <span style={{ fontSize: '18px' }}>{getStateIcon()}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--ff-d)', fontSize: '14px', fontWeight: 700, color: 'var(--txt)' }}>
            Tryver Voice Navigation
          </div>
          {routeId && (
            <div style={{ fontSize: '10px', color: 'var(--txt3)', marginTop: '1px' }}>
              Route: {routeId}
            </div>
          )}
        </div>
        <div style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
          color: badge.color, background: `${badge.color}22`,
          border: `1px solid ${badge.color}44`,
          borderRadius: '6px', padding: '3px 8px',
        }}>
          {badge.text}
        </div>
        <button
          onClick={() => {
            window.speechSynthesis.cancel();
            onDismiss();
          }}
          aria-label="Dismiss voice navigation modal"
          style={{
            background: 'var(--inset)', border: '1px solid var(--border)',
            borderRadius: '7px', width: '26px', height: '26px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--txt2)', fontSize: '12px',
          }}
        >✕</button>
      </div>
      
      {/* Status message */}
      <div
        role="log"
        aria-live="polite"
        style={{ padding: '12px 16px 8px', minHeight: '52px' }}
      >
        <div style={{
          fontSize: '13px', lineHeight: '1.5', color: 'var(--txt)',
          fontWeight: isSpeaking ? 500 : 400,
        }}>
          {statusMessage}
        </div>
      </div>
      
      {/* Waveform visualizer */}
      <div style={{
        padding: '4px 16px 8px',
        display: 'flex', alignItems: 'flex-end', gap: '4px', height: '44px',
      }}>
        {waveformBars.map((height, i) => (
          <div key={i} style={{
            flex: 1,
            height: `${height}px`,
            maxHeight: '36px',
            background: isRecordingActive 
              ? `hsl(${120 - audioLevel}, 70%, 60%)` 
              : 'var(--border)',
            borderRadius: '2px',
            transition: 'height 0.1s ease, background 0.3s ease',
          }} />
        ))}
        <div style={{
          marginLeft: '8px',
          fontSize: '11px',
          color: isRecordingActive ? 'var(--red)' : 'var(--txt3)',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          alignSelf: 'center',
        }}>
          {isRecordingActive ? '● REC' : isSpeaking ? '◉ Speaking' : '○ Idle'}
        </div>
      </div>
      
      {/* Live transcript display */}
      {displayTranscript && (
        <div style={{
          margin: '0 16px 8px',
          padding: '8px 12px',
          background: 'var(--inset)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          fontSize: '12px',
          color: 'var(--txt2)',
          fontStyle: 'italic',
        }}>
          Heard: "{displayTranscript}"
        </div>
      )}
      
      {/* Vosk not ready warning */}
      {!voskReady && (
        <div style={{
          margin: '0 16px 8px',
          padding: '10px 12px',
          background: 'rgba(255,123,107,0.1)',
          border: '1px solid rgba(255,123,107,0.3)',
          borderRadius: '10px',
          fontSize: '11px',
          color: 'var(--red)',
          lineHeight: '1.6',
        }}>
          ⚠️ Vosk not ready. {errorMessage || 'Check server console for setup instructions.'}
          <br />
          <a 
            href="https://alphacephei.com/vosk/models"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--blue)', textDecoration: 'underline' }}
          >
            Download Vosk model →
          </a>
        </div>
      )}
      
      {/* Route loading spinner */}
      {isLoading && (
        <div style={{
          padding: '8px 16px 12px',
          display: 'flex', gap: '12px', alignItems: 'center',
        }}>
          <div style={{
            width: '20px', height: '20px',
            border: '2px solid var(--border)',
            borderTopColor: 'var(--wood)',
            borderRadius: '50%',
            animation: 'spin 0.65s linear infinite',
            flexShrink: 0,
          }} />
          <div style={{ fontSize: '12px', color: 'var(--txt2)' }}>
            <div>From: <strong style={{ color: 'var(--txt)' }}>{startPointRaw}</strong></div>
            <div>To: <strong style={{ color: 'var(--txt)' }}>{destinationRaw}</strong></div>
            <div>Mode: <strong style={{ color: 'var(--wood)' }}>{travelMode}</strong></div>
          </div>
        </div>
      )}
      
      {/* Navigation step indicator */}
      {state === STATES.NAVIGATING && routeData && (
        <div style={{
          margin: '0 16px 8px',
          padding: '8px 12px',
          background: 'var(--blue-dim)',
          border: '1px solid rgba(79,195,247,0.3)',
          borderRadius: '10px',
        }}>
          <div style={{ fontSize: '10px', color: 'var(--blue)', fontWeight: 700, marginBottom: '4px' }}>
            STEP {currentStepIndex + 1} OF {(routeData.steps || []).length}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--txt)', lineHeight: '1.4' }}>
            {routeData.steps?.[currentStepIndex]?.instruction || 'Follow route'}
          </div>
          <div style={{
            marginTop: '6px', fontSize: '10px', color: 'var(--txt3)',
            display: 'flex', gap: '12px', flexWrap: 'wrap',
          }}>
            <span>Say "next step"</span>
            <span>Say "directions"</span>
            <span>Say "stop"</span>
          </div>
        </div>
      )}
      
      {/* Progress dots */}
      {[STATES.GREETING, STATES.COLLECTING_START, STATES.COLLECTING_DESTINATION,
        STATES.COLLECTING_MODE, STATES.CONFIRMING].includes(state) && (
        <div style={{
          padding: '6px 16px 12px',
          display: 'flex', gap: '8px', alignItems: 'center',
        }}>
          {progressSteps.map((step, i) => (
            <React.Fragment key={i}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                <div style={{
                  width: '10px', height: '10px', borderRadius: '50%',
                  background: step.done ? 'var(--wood)' 
                              : step.active ? 'var(--green)' 
                              : 'var(--border)',
                  boxShadow: step.active ? '0 0 6px var(--green)' : 'none',
                  transition: 'all 0.3s ease',
                }} />
                <div style={{ fontSize: '9px', color: 'var(--txt3)', whiteSpace: 'nowrap' }}>
                  {step.label}
                </div>
              </div>
              {i < progressSteps.length - 1 && (
                <div style={{
                  flex: 1, height: '1px', marginBottom: '12px',
                  background: step.done ? 'var(--wood)' : 'var(--border)',
                  transition: 'background 0.3s ease',
                }} />
              )}
            </React.Fragment>
          ))}
        </div>
      )}
      
      {/* Idle state — wake word instruction */}
      {state === STATES.IDLE && (
        <div style={{ padding: '4px 16px 16px', textAlign: 'center' }}>
          {speechRecognitionAvailable ? (
            <div style={{ fontSize: '12px', color: 'var(--txt2)', lineHeight: '1.7' }}>
              Say <strong style={{ color: 'var(--wood)' }}>"Hi Tryver"</strong> to begin
              <br />
              <span style={{ fontSize: '11px', color: 'var(--txt3)' }}>
                or tap the button below
              </span>
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: 'var(--txt2)' }}>
              Automatic voice detection not available in this browser.
            </div>
          )}
          <button
            onClick={() => {
              if (voskReady) {
                playChime(440, 660);
                setState(STATES.GREETING);
                // Start wake word detection explicitly after user gesture
                if (recognitionRef.current) {
                  try { recognitionRef.current.start(); } catch(e) {}
                }
              } else {
                speak("Voice recognition is not set up. Please install the Vosk model. Check the server console for instructions.");
              }
            }}
            style={{
              marginTop: '10px',
              width: '100%',
              padding: '11px',
              background: 'var(--wood-g)',
              border: 'none',
              borderRadius: '12px',
              color: 'white',
              fontFamily: 'var(--ff-d)',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: '0.2px',
            }}
            aria-label="Tap to start voice navigation"
          >
            🎤 Tap to Start Navigation
          </button>
          <div style={{ fontSize: '10px', color: 'var(--txt3)', marginTop: '8px' }}>
            Tap anywhere on the map to dismiss
          </div>
        </div>
      )}
    </div>
  );
}
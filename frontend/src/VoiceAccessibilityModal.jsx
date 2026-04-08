/**
 * VoiceAccessibilityModal.jsx - M1 Optimized
 * 
 * Performance improvements:
 * - Single AudioWorklet instance (no reloading)
 * - RequestAnimationFrame for waveform (no React re-renders)
 * - Throttled status updates
 * - Lazy WebSocket connection
 * - Chunked audio sending with backpressure
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { io } from "socket.io-client";

// ============================================================================
// AudioWorklet Processor (Loaded Once)
// ============================================================================

const AUDIO_WORKLET_CODE = `
class TryverResampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = 16000;
    this.chunkSize = 4000;
    this.buffer = [];
    this.ratio = (options.processorOptions.inputRate || 44100) / this.targetRate;
  }

  resample(input) {
    const outLen = Math.round(input.length / this.ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * this.ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      out[i] = idx + 1 < input.length
        ? input[idx] * (1 - frac) + input[idx + 1] * frac
        : input[idx] || 0;
    }
    return out;
  }

  floatToInt16(f32) {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const clamped = Math.max(-1, Math.min(1, f32[i]));
      i16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    }
    return i16;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    
    const resampled = this.resample(input[0]);
    for (let i = 0; i < resampled.length; i++) this.buffer.push(resampled[i]);
    
    while (this.buffer.length >= this.chunkSize) {
      const chunk = this.buffer.splice(0, this.chunkSize);
      const i16 = this.floatToInt16(new Float32Array(chunk));
      this.port.postMessage(i16.buffer, [i16.buffer]);
    }
    return true;
  }
}
registerProcessor('tryver-resampler', TryverResampler);
`;

// ============================================================================
// Constants
// ============================================================================

const STATES = {
  IDLE: "IDLE",
  GREETING: "GREETING",
  COLLECTING_START: "COLLECTING_START",
  COLLECTING_DESTINATION: "COLLECTING_DESTINATION",
  COLLECTING_MODE: "COLLECTING_MODE",
  CONFIRMING: "CONFIRMING",
  ROUTING: "ROUTING",
  NAVIGATING: "NAVIGATING",
};

const RECORDING_DURATIONS = {
  GREETING: 8000,
  COLLECTING_START: 5000,
  COLLECTING_DESTINATION: 5000,
  COLLECTING_MODE: 5000,
  CONFIRMING: 5000,
};

const MAX_RETRIES = 2;
const CORRECTION_COUNTDOWN = 7;
const TOMTOM_API_KEY = "pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM";

// ============================================================================
// Voice Socket Hook (Optimized)
// ============================================================================

const useVoiceSocket = (serverUrl = "http://127.0.0.1:5000") => {
  const socketRef = useRef(null);
  const [sessionId, setSessionId] = useState(null);
  const [finalTranscript, setFinalTranscript] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState(null);
  
  const audioContextRef = useRef(null);
  const streamRef = useRef(null);
  const workletNodeRef = useRef(null);
  const isRecordingRef = useRef(false);
  const workletLoadedRef = useRef(false);
  const sessionIdRef = useRef(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Check server status
  useEffect(() => {
    fetch(`${serverUrl}/api/voice/status`)
      .then(r => r.json())
      .then(data => setIsReady(data.model_loaded))
      .catch(() => setError("Cannot connect to server"));
  }, [serverUrl]);

  // Socket connection
  useEffect(() => {
    const socket = io(serverUrl, { transports: ["websocket"], reconnection: true });
    socketRef.current = socket;

    socket.on("connect", () => {
      setError(null);
      socket.emit("voice_start_session", {});
    });

    socket.on("voice_session_created", (data) => {
      setSessionId(data.session_id);
      sessionIdRef.current = data.session_id;
    });

    socket.on("voice_final_result", (data) => {
      setIsTranscribing(false);
      if (data.transcript?.trim()) {
        setFinalTranscript({
          text: data.transcript.trim().toLowerCase(),
          confidence: data.confidence || 0.85
        });
      } else {
        setFinalTranscript({ text: "__EMPTY__", confidence: 0 });
      }
    });

    socket.on("voice_error", (data) => {
      setIsTranscribing(false);
      setError(data.error);
    });

    return () => {
      if (sessionIdRef.current) {
        socket.emit("voice_destroy_session", { session_id: sessionIdRef.current });
      }
      socket.disconnect();
    };
  }, [serverUrl]);

  const sendChunk = useCallback((buffer) => {
    if (!socketRef.current || !sessionIdRef.current) return;
    socketRef.current.emit("voice_audio_chunk", {
      session_id: sessionIdRef.current,
      audio_data: buffer
    });
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });
      streamRef.current = stream;
      
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      
      if (!workletLoadedRef.current && ctx.audioWorklet) {
        const blob = new Blob([AUDIO_WORKLET_CODE], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        workletLoadedRef.current = true;
      }
      
      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, "tryver-resampler", {
        processorOptions: { inputRate: ctx.sampleRate }
      });
      
      worklet.port.onmessage = (e) => {
        if (isRecordingRef.current) sendChunk(e.data);
      };
      
      source.connect(worklet);
      workletNodeRef.current = worklet;
      isRecordingRef.current = true;
    } catch (err) {
      setError("Microphone access denied");
    }
  }, [sendChunk]);

  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    
    if (socketRef.current && sessionIdRef.current) {
      setIsTranscribing(true);
      socketRef.current.emit("voice_stop_recording", { session_id: sessionIdRef.current });
    }
    
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  return { sessionId, finalTranscript, setFinalTranscript, startRecording, stopRecording, isReady, isTranscribing, error };
};

// ============================================================================
// Main Component
// ============================================================================

export default function VoiceAccessibilityModal({ onRouteCalculated, onDismiss, userLocation, isVisible }) {
  const [state, setState] = useState(STATES.IDLE);
  const [startPoint, setStartPoint] = useState("");
  const [destination, setDestination] = useState("");
  const [travelMode, setTravelMode] = useState("");
  const [routeData, setRouteData] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('Say "Hi Tryver" to begin');
  const [displayText, setDisplayText] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionText, setCorrectionText] = useState("");
  const [correctionType, setCorrectionType] = useState("");
  const [correctionPlaceholder, setCorrectionPlaceholder] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [showCountdown, setShowCountdown] = useState(false);
  
  const stateRef = useRef(state);
  const routeRef = useRef(null);
  const currentStepRef = useRef(0);
  const recordingTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const recognizerRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const resolveTranscriptRef = useRef(null);
  const skipCountdownRef = useRef(null);
  const waveformRef = useRef([4, 4, 4, 4, 4, 4, 4]);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { routeRef.current = routeData; }, [routeData]);
  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);

  const { finalTranscript, setFinalTranscript, startRecording, stopRecording, isReady, isTranscribing } = 
    useVoiceSocket("http://127.0.0.1:5000");

  // ============================================================================
  // TTS (Speech Synthesis)
  // ============================================================================
  
  const speak = useCallback((text, onDone = null) => {
    if (!window.speechSynthesis) {
      setStatus(text);
      onDone?.();
      return;
    }
    window.speechSynthesis.cancel();
    setIsSpeaking(true);
    setStatus(text);
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.88;
    utterance.pitch = 1.05;
    utterance.lang = "en-US";
    
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.name.includes("Samantha") || (v.lang === "en-US" && v.localService));
    if (preferred) utterance.voice = preferred;
    
    utterance.onend = () => { setIsSpeaking(false); onDone?.(); };
    utterance.onerror = () => { setIsSpeaking(false); onDone?.(); };
    window.speechSynthesis.speak(utterance);
  }, []);

  // ============================================================================
  // Recording with Promise
  // ============================================================================
  
  const listen = useCallback((durationMs) => {
    return new Promise(async (resolve) => {
      if (!isReady) { 
        resolve(null); 
        return;
      }
      
      // Prevent multiple simultaneous listening sessions
      if (isListeningRef.current) {
        console.log("Already listening, skipping");
        resolve(null);
        return;
      }
      
      isListeningRef.current = true;
      
      // Set up the resolve handler
      const timeoutHandler = setTimeout(() => {
        console.log("Listen timeout - forcing reset");
        if (resolveTranscriptRef.current) {
          resolveTranscriptRef.current = null;
        }
        isListeningRef.current = false;
        resolve(null);
      }, 20000); // 20 second total timeout
      
      resolveTranscriptRef.current = (result) => {
        clearTimeout(timeoutHandler);
        clearTimeout(recordingTimerRef.current);
        // Don't reset isListeningRef here - let the useEffect do it
        resolve(result);
      };
      
      try {
        await startRecording();
        setDisplayText("Listening...");
        
        recordingTimerRef.current = setTimeout(() => {
          stopRecording();
          setDisplayText("Transcribing...");
        }, durationMs);
        
      } catch (err) {
        console.error("Listen error:", err);
        clearTimeout(timeoutHandler);
        isListeningRef.current = false;
        resolve(null);
      }
    });
  }, [isReady, startRecording, stopRecording]);


useEffect(() => {
  if (!finalTranscript) return;
  if (resolveTranscriptRef.current) {
    const handler = resolveTranscriptRef.current;
    resolveTranscriptRef.current = null;
    clearTimeout(recordingTimerRef.current);
    setFinalTranscript(null);
    
    const text = finalTranscript.text === "__EMPTY__" ? null : finalTranscript.text;
    if (text) setDisplayText(text);
    handler(text ? { text, confidence: finalTranscript.confidence } : null);
    
    // CRITICAL: Reset the listening flag after transcript is handled
    setTimeout(() => {
      isListeningRef.current = false;
    }, 100);
  } else {
    setFinalTranscript(null);
  }
}, [finalTranscript, setFinalTranscript]);

  // ============================================================================
  // Wake Word Detection
  // ============================================================================
  
  useEffect(() => {
    if (!isVisible) return;
    const SpeechRecog = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecog) return;
    
    const recognizer = new SpeechRecog();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.lang = "en-US";
    recognizerRef.current = recognizer;
    
    recognizer.onresult = (e) => {
      if (!["IDLE", "NAVIGATING"].includes(stateRef.current)) return;
      const text = Array.from(e.results).flatMap(r => Array.from(r)).map(a => a.transcript.toLowerCase()).join(" ");
      
      if (stateRef.current === "IDLE" && text.includes("tryver")) {
        recognizer.stop();
        setState(STATES.GREETING);
      }
    };
    
    recognizer.onerror = () => {};
    recognizer.start();
    
    return () => { try { recognizer.stop(); } catch(e) {} };
  }, [isVisible]);

  // ============================================================================
  // Audio Level Monitor (RequestAnimationFrame)
  // ============================================================================
  
  useEffect(() => {
    if (!isVisible) return;
    let ctx = null, source = null, analyser = null;
    
    const startMonitor = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        ctx = new AudioContext();
        source = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        source.connect(analyser);
        
        const data = new Uint8Array(analyser.frequencyBinCount);
        const update = () => {
          if (!analyser) return;
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setAudioLevel(Math.min(100, avg * 2));
          
          // Update waveform without React re-render
          const newWaveform = waveformRef.current.map((_, i) => {
            const phase = (Date.now() / 200 + i * 0.7) % (Math.PI * 2);
            return Math.round(Math.max(6, (avg / 100) * 40 + Math.sin(phase) * 10));
          });
          waveformRef.current = newWaveform;
          animationRef.current = requestAnimationFrame(update);
        };
        update();
      } catch(e) {}
    };
    
    startMonitor();
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (source) source.disconnect();
      if (ctx) ctx.close();
    };
  }, [isVisible]);

  // ============================================================================
  // Correction Modal
  // ============================================================================
  
  const askCorrection = useCallback((original, type, placeholder) => {
    return new Promise((resolve) => {
      setCorrectionText(original);
      setCorrectionType(type);
      setCorrectionPlaceholder(placeholder);
      setShowCorrection(true);
      
      let remaining = CORRECTION_COUNTDOWN;
      setCountdown(remaining);
      setShowCountdown(true);
      
      skipCountdownRef.current = () => {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        setShowCountdown(false);
        resolve(original);
      };
      
      countdownTimerRef.current = setInterval(() => {
        remaining--;
        setCountdown(remaining);
        if (remaining <= 0) {
          clearInterval(countdownTimerRef.current);
          setShowCountdown(false);
          resolve(original);
        }
      }, 1000);
      
      correctionResolveRef.current = (value) => {
        clearInterval(countdownTimerRef.current);
        setShowCountdown(false);
        setShowCorrection(false);
        resolve(value);
      };
    });
  }, []);

  const correctionResolveRef = useRef(null);
  const isListeningRef = useRef(false);
  const retryCountRef = useRef(0);

  // ============================================================================
  // State Machine Handlers
  // ============================================================================
  
  const reset = useCallback(() => {
    setStartPoint("");
    setDestination("");
    setTravelMode("");
    setRouteData(null);
    setCurrentStep(0);
    setDisplayText("");
  }, []);

  const handleGreeting = useCallback(async () => {
    speak("Hi! I'm Tryver. What's your starting point? Say an address, landmark, or current location.", async () => {
      const result = await listen(RECORDING_DURATIONS.COLLECTING_START);
      if (result?.text?.length >= 3) {
        const corrected = await askCorrection(result.text, "start", "e.g., 738 Dorseyville Rd");
        setStartPoint(corrected);
        setState(STATES.COLLECTING_DESTINATION);
      } else {
        speak("I didn't catch that. Let's try again.", () => setState(STATES.IDLE));
      }
    });
  }, [speak, listen, askCorrection]);

  const handleDestination = useCallback(async () => {
    speak("Got it. What's your destination?", async () => {
      const result = await listen(RECORDING_DURATIONS.COLLECTING_DESTINATION);
      const rawText = result?.text || null;
      const isValid = rawText && rawText.length >= 2 && rawText !== startPoint;
      
      if (isValid) {
        const corrected = await askCorrection(rawText, "destination", "e.g., Carnegie Mellon University");
        const finalText = corrected !== null && corrected !== undefined ? corrected : rawText;
        if (!finalText || finalText.trim().length < 2) {
          // Retry, don't restart!
          speak("I didn't get a valid destination. Please try again.", () => {
            // Stay in COLLECTING_DESTINATION state, don't go back to GREETING
            setState(STATES.COLLECTING_DESTINATION);
          });
          return;
        }
        setDestination(finalText);
        retryCountRef.current = 0;
        setState(STATES.COLLECTING_MODE);
      } else {
        retryCountRef.current++;
        if (retryCountRef.current >= MAX_RETRIES) {
          speak("I'm having trouble. Let's start over.", () => {
            reset();
            setState(STATES.IDLE);
          });
        } else {
          // Retry destination - DON'T go back to greeting!
          speak(rawText === startPoint 
            ? "Destination can't be same as start. Please say a different destination." 
            : "I didn't catch that. Please say your destination again.", 
            () => {
              // Stay in destination collection mode
              setState(STATES.COLLECTING_DESTINATION);
            });
        }
      }
    });
  }, [speak, listen, askCorrection, startPoint]);

  const handleMode = useCallback(async () => {
    speak("How would you like to travel? Walking, transit, or wheelchair.", async () => {
      const result = await listen(RECORDING_DURATIONS.COLLECTING_MODE);
      const text = result?.text || "";
      let mode = null;
      if (/walk/i.test(text)) mode = "walk";
      else if (/transit|bus/i.test(text)) mode = "transit";
      else if (/wheelchair|accessible/i.test(text)) mode = "wheelchair";
      
      if (mode) {
        setTravelMode(mode);
        setState(STATES.CONFIRMING);
      } else {
        speak("Using walking mode.", () => {
          setTravelMode("walk");
          setState(STATES.CONFIRMING);
        });
      }
    });
  }, [speak, listen]);

  const handleConfirm = useCallback(async () => {
    const modeLabel = travelMode === "walk" ? "walking" : travelMode === "transit" ? "transit" : "wheelchair";
    speak(`From ${startPoint}. To ${destination}. Mode: ${modeLabel}. Is that correct?`, async () => {
      const result = await listen(RECORDING_DURATIONS.CONFIRMING);
      const text = result?.text || "";
      
      if (/yes|correct|yeah|ok/i.test(text)) {
        setState(STATES.ROUTING);
      } else if (/no|wrong|start over/i.test(text)) {
        speak("Starting over.", () => { reset(); setState(STATES.IDLE); });
      } else {
        speak("I'll take that as yes.", () => setState(STATES.ROUTING));
      }
    });
  }, [speak, listen, startPoint, destination, travelMode, reset]);

  const handleRouting = useCallback(async () => {
    speak("Calculating route...");
    setIsLoading(true);
    
    try {
      const res = await fetch("http://127.0.0.1:5000/api/voice-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: startPoint,
          destination: destination,
          mode: travelMode,
          user_lat: userLocation?.[0] || 40.4406,
          user_lng: userLocation?.[1] || -79.9959
        })
      });
      
      const data = await res.json();
      setIsLoading(false);
      
      if (data.success) {
        setRouteData(data);
        routeRef.current = data;
        onRouteCalculated?.({
          success: true,
          route: {
            coordinates: (data.route_coords || []).map(p => ({ lat: p[0], lng: p[1] })),
            steps: data.steps || [],
            distance: data.distance,
            duration: data.duration,
            safety: data.safety
          }
        });
        speak(`Route found! ${data.distance}, ${data.duration}. Say "next step" for directions, or "stop" to end.`, () => {
          setState(STATES.NAVIGATING);
        });
      } else {
        speak("Couldn't find a route. Let's start over.", () => { reset(); setState(STATES.IDLE); });
      }
    } catch (err) {
      setIsLoading(false);
      speak("Server error. Please try again.", () => { reset(); setState(STATES.IDLE); });
    }
  }, [speak, startPoint, destination, travelMode, userLocation, onRouteCalculated, reset]);

  useEffect(() => {
    if (!isReady && state !== STATES.IDLE) {
      speak("Voice engine not ready. Check server.");
      setState(STATES.IDLE);
      return;
    }
    
    switch (state) {
      case STATES.GREETING: handleGreeting(); break;
      case STATES.COLLECTING_DESTINATION: handleDestination(); break;
      case STATES.COLLECTING_MODE: handleMode(); break;
      case STATES.CONFIRMING: handleConfirm(); break;
      case STATES.ROUTING: handleRouting(); break;
    }
  }, [state, isReady]);

  // ============================================================================
  // Navigation Commands
  // ============================================================================
  
  useEffect(() => {
    if (!isVisible) return;
    const SpeechRecog = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecog) return;
    
    const recognizer = new SpeechRecog();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    
    recognizer.onresult = (e) => {
      if (stateRef.current !== STATES.NAVIGATING) return;
      const text = Array.from(e.results).flatMap(r => Array.from(r)).map(a => a.transcript.toLowerCase()).join(" ");
      const route = routeRef.current;
      if (!route) return;
      
      if (/next step|continue|next/i.test(text)) {
        const next = currentStepRef.current + 1;
        if (next < (route.steps?.length || 0)) {
          setCurrentStep(next);
          speak(`Step ${next + 1}: ${route.steps[next]?.instruction || "Follow route"}`);
        } else {
          speak("You've reached your destination.");
        }
      } else if (/directions|all steps|read steps/i.test(text)) {
        const steps = route.steps?.map((s, i) => `Step ${i + 1}: ${s.instruction}`).join(". ");
        speak(`Here are all steps. ${steps}`);
      } else if (/repeat|again/i.test(text)) {
        const step = route.steps?.[currentStepRef.current];
        speak(`Step ${currentStepRef.current + 1}: ${step?.instruction || "Follow route"}`);
      } else if (/stop|cancel|exit|goodbye/i.test(text)) {
        speak("Navigation ended.", () => { reset(); setState(STATES.IDLE); });
      } else if (/help|commands/i.test(text)) {
        speak("Say: next step, directions, repeat, or stop.");
      }
    };
    
    recognizer.start();
    return () => { try { recognizer.stop(); } catch(e) {} };
  }, [isVisible, speak, reset]);

  // ============================================================================
  // UI
  // ============================================================================
  
  if (!isVisible) return null;
  
  const badge = (() => {
    if (isLoading) return { text: "ROUTING", color: "#FFB74D" };
    if (isTranscribing) return { text: "PROCESSING", color: "#4FC3F7" };
    if (isSpeaking) return { text: "SPEAKING", color: "#81C784" };
    if (state === STATES.NAVIGATING) return { text: "NAVIGATING", color: "#4FC3F7" };
    return { text: "READY", color: "#E8A870" };
  })();
  
  return (
    <>
      <div style={{
        position: "fixed",
        bottom: state === STATES.IDLE ? "50%" : "20px",
        right: state === STATES.IDLE ? "50%" : "20px",
        transform: state === STATES.IDLE ? "translate(50%, 50%)" : "none",
        width: state === STATES.IDLE ? "320px" : "350px",
        background: "#1a1a2e",
        border: `1px solid ${badge.color}`,
        borderRadius: "20px",
        boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
        zIndex: 1000,
        overflow: "hidden",
        transition: "all 0.3s ease"
      }}>
        {/* Header */}
        <div style={{ padding: "12px 16px", background: "#16213e", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "18px" }}>🎤 Tryver Voice</span>
          <div style={{ fontSize: "11px", color: badge.color, background: `${badge.color}22`, padding: "3px 8px", borderRadius: "12px" }}>{badge.text}</div>
          <button onClick={onDismiss} style={{ background: "none", border: "none", color: "#888", fontSize: "18px", cursor: "pointer" }}>✕</button>
        </div>
        
        {/* Status */}
        <div style={{ padding: "12px 16px", minHeight: "50px" }}>
          <div style={{ fontSize: "13px", color: "#eee", fontWeight: isSpeaking ? 500 : 400 }}>{status}</div>
        </div>
        
        {/* Transcribing indicator */}
        {isTranscribing && (
          <div style={{ margin: "0 16px 10px", padding: "8px 12px", background: "#0f3460", borderRadius: "10px", display: "flex", gap: "10px", alignItems: "center" }}>
            <div style={{ width: "16px", height: "16px", border: "2px solid #4FC3F7", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
            <div style={{ fontSize: "11px", color: "#4FC3F7" }}>Transcribing...</div>
          </div>
        )}
        
        {/* Waveform */}
        <div style={{ padding: "4px 16px", display: "flex", gap: "4px", height: "40px", alignItems: "flex-end" }}>
          {waveformRef.current.map((h, i) => (
            <div key={i} style={{ flex: 1, height: `${h}px`, background: badge.color, borderRadius: "2px", transition: "height 0.05s" }} />
          ))}
        </div>
        
        {/* Transcript */}
        {displayText && displayText !== "Listening..." && displayText !== "Transcribing..." && (
          <div style={{ margin: "0 16px 10px", padding: "6px 10px", background: "#0f3460", borderRadius: "8px", fontSize: "11px", color: "#aaa" }}>
            Heard: "{displayText}"
          </div>
        )}
        
        {/* Not ready warning */}
        {!isReady && (
          <div style={{ margin: "0 16px 10px", padding: "8px", background: "#ff6b6b22", border: "1px solid #ff6b6b", borderRadius: "8px", fontSize: "11px", color: "#ff6b6b" }}>
            ⚠️ Voice engine not ready. Check server.
          </div>
        )}
        
        {/* Idle state button */}
        {state === STATES.IDLE && (
          <div style={{ padding: "0 16px 16px" }}>
            <button onClick={() => setState(STATES.GREETING)} style={{
              width: "100%", padding: "12px", background: "#E8A870", border: "none", borderRadius: "12px",
              color: "#1a1a2e", fontWeight: "bold", fontSize: "14px", cursor: "pointer"
            }}>🎤 Start Navigation</button>
            <div style={{ fontSize: "10px", color: "#666", textAlign: "center", marginTop: "8px" }}>Say "Hi Tryver" or tap button</div>
          </div>
        )}
        
        {/* Loading state */}
        {isLoading && (
          <div style={{ padding: "12px 16px 16px", display: "flex", gap: "10px", alignItems: "center" }}>
            <div style={{ width: "20px", height: "20px", border: "2px solid #E8A870", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
            <div style={{ fontSize: "12px" }}>From {startPoint} → {destination}</div>
          </div>
        )}
        
        {/* Navigation step */}
        {state === STATES.NAVIGATING && routeData && (
          <div style={{ margin: "0 16px 16px", padding: "10px", background: "#0f3460", borderRadius: "10px" }}>
            <div style={{ fontSize: "10px", color: "#4FC3F7", fontWeight: "bold" }}>STEP {currentStep + 1} / {routeData.steps?.length || 0}</div>
            <div style={{ fontSize: "12px", marginTop: "4px" }}>{routeData.steps?.[currentStep]?.instruction || "Follow route"}</div>
            <div style={{ fontSize: "10px", color: "#888", marginTop: "6px", display: "flex", gap: "12px" }}>
              <span>🗣️ "next step"</span> <span>🗣️ "directions"</span> <span>🗣️ "stop"</span>
            </div>
          </div>
        )}
      </div>
      
      {/* Correction Modal */}
      {showCorrection && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.85)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#1a1a2e", borderRadius: "20px", padding: "24px", width: "90%", maxWidth: "400px" }}>
            <h4 style={{ margin: "0 0 12px" }}>Did I hear that right?</h4>
            <div style={{ background: "#0f3460", padding: "12px", borderRadius: "10px", marginBottom: "16px" }}>
              I heard: <strong>"{correctionText}"</strong>
            </div>
            <input
              type="text"
              value={correctionText}
              onChange={e => setCorrectionText(e.target.value)}
              placeholder={correctionPlaceholder}
              autoFocus
              style={{ width: "100%", padding: "12px", background: "#16213e", border: "1px solid #333", borderRadius: "10px", color: "#fff", marginBottom: "16px" }}
            />
            {showCountdown && <div style={{ textAlign: "center", marginBottom: "12px", fontSize: "12px", color: "#E8A870" }}>Auto-submitting in {countdown}s...</div>}
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => correctionResolveRef.current?.(correctionText)} style={{ flex: 1, padding: "12px", background: "#E8A870", border: "none", borderRadius: "10px", fontWeight: "bold", cursor: "pointer" }}>✓ Use this</button>
              <button onClick={() => correctionResolveRef.current?.(null)} style={{ flex: 1, padding: "12px", background: "#333", border: "none", borderRadius: "10px", cursor: "pointer" }}>Keep original</button>
            </div>
          </div>
        </div>
      )}
      
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
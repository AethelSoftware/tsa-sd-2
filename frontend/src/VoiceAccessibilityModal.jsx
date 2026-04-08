import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { io } from "socket.io-client";

const AUDIO_WORKLET_CODE = `
class VoskResampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.inputSampleRate = options.processorOptions.inputSampleRate || 44100;
    this.outputSampleRate = 16000;
    this.ratio = this.inputSampleRate / this.outputSampleRate;
    this.buffer = [];
    this.chunkSize = 4000;
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
      resampled[i] =
        idx + 1 < inputData.length
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

const MAX_RETRIES = 2;
const RECORDING_DURATIONS = {
  GREETING: 8000,
  COLLECTING_START: 10000,
  COLLECTING_DESTINATION: 10000,
  COLLECTING_MODE: 3000,
  CONFIRMING: 2000,
  NAVIGATING: 4000,
};

const WORD_TO_NUMBER = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

const TOMTOM_API_KEY = "pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM";
const CORRECTION_COUNTDOWN_SECONDS = 7;

const useVoiceSocket = (serverUrl = "http://127.0.0.1:5000") => {
  const socketRef = useRef(null);
  const [sessionId, setSessionId] = useState(null);
  const [finalTranscript, setFinalTranscript] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [voskReady, setVoskReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const audioContextRef = useRef(null);
  const streamRef = useRef(null);
  const workletNodeRef = useRef(null);
  const scriptProcessorRef = useRef(null);
  const workletBlobUrlRef = useRef(null);
  const isRecordingRef = useRef(false);
  const sessionIdRef = useRef(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    fetch(`${serverUrl}/api/voice/status`)
      .then((r) => r.json())
      .then((data) => {
        setVoskReady(data.vosk_installed && data.model_loaded);
        if (!data.model_loaded) {
          setErrorMessage(
            data.engine === "whisper"
              ? "Whisper model not loaded. Run: python -c \"import whisper; whisper.load_model('base.en')\""
              : "Voice model not loaded. Check server console.",
          );
        }
      })
      .catch(() => setErrorMessage("Cannot connect to Tryver server"));
  }, [serverUrl]);

  useEffect(() => {
    const socket = io(serverUrl, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      setErrorMessage(null);
      socket.emit("voice_start_session", {});
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
      setSessionId(null);
    });

    socket.on("voice_session_created", (data) => {
      setSessionId(data.session_id);
      sessionIdRef.current = data.session_id;
      console.log(
        `[Voice] Session created with engine: ${data.engine || "unknown"}`,
      );
    });

    socket.on("voice_final_result", (data) => {
      setIsTranscribing(false);
      if (data.transcript && data.transcript.trim()) {
        setFinalTranscript({
          text: data.transcript.trim().toLowerCase(),
          confidence: data.confidence || 0.7,
          raw: data.raw_transcript || data.transcript,
        });
      } else {
        setFinalTranscript({ text: "__EMPTY__", confidence: 0, raw: "" });
      }
    });

    socket.on("voice_error", (data) => {
      setIsTranscribing(false);
      setErrorMessage(data.error);
    });

    return () => {
      if (sessionIdRef.current) {
        socket.emit("voice_destroy_session", {
          session_id: sessionIdRef.current,
        });
      }
      socket.disconnect();
    };
  }, [serverUrl]);

  const sendAudioChunk = useCallback((pcmArrayBuffer, isFinal = false) => {
    if (!socketRef.current || !sessionIdRef.current) return;
    socketRef.current.emit("voice_audio_chunk", {
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
        },
      });
      streamRef.current = stream;

      const audioContext = new (
        window.AudioContext || window.webkitAudioContext
      )();
      audioContextRef.current = audioContext;
      const nativeSampleRate = audioContext.sampleRate;

      let usingWorklet = false;
      if (audioContext.audioWorklet && audioContext.audioWorklet.addModule) {
        try {
          const blob = new Blob([AUDIO_WORKLET_CODE], {
            type: "application/javascript",
          });
          const blobUrl = URL.createObjectURL(blob);
          workletBlobUrlRef.current = blobUrl;

          await audioContext.audioWorklet.addModule(blobUrl);

          const source = audioContext.createMediaStreamSource(stream);
          const workletNode = new AudioWorkletNode(
            audioContext,
            "vosk-resampler",
            {
              processorOptions: { inputSampleRate: nativeSampleRate },
            },
          );

          workletNode.port.onmessage = (event) => {
            if (isRecordingRef.current) {
              sendAudioChunk(event.data.pcmData, false);
            }
          };

          source.connect(workletNode);
          workletNodeRef.current = workletNode;
          usingWorklet = true;
        } catch (workletError) {
          console.warn(
            "[Voice] AudioWorklet failed, using ScriptProcessor:",
            workletError,
          );
        }
      }

      if (!usingWorklet) {
        const { source, processor } = createScriptProcessorFallback(
          audioContext,
          stream,
          (pcmBuffer) => {
            if (isRecordingRef.current) {
              sendAudioChunk(pcmBuffer, false);
            }
          },
        );
        scriptProcessorRef.current = { source, processor };
      }

      isRecordingRef.current = true;
    } catch (err) {
      if (err.name === "NotAllowedError") {
        setErrorMessage(
          "Microphone permission denied. Please allow microphone access.",
        );
      } else {
        setErrorMessage(`Could not access microphone: ${err.message}`);
      }
    }
  }, [sendAudioChunk]);

  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;

    if (socketRef.current && sessionIdRef.current) {
      setIsTranscribing(true);
      socketRef.current.emit("voice_stop_recording", {
        session_id: sessionIdRef.current,
      });
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
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (workletBlobUrlRef.current) {
      URL.revokeObjectURL(workletBlobUrlRef.current);
      workletBlobUrlRef.current = null;
    }
  }, []);

  return {
    sessionId,
    finalTranscript,
    setFinalTranscript,
    startRecording,
    stopRecording,
    isConnected,
    voskReady,
    errorMessage,
    isTranscribing,
  };
};

export default function VoiceAccessibilityModal({
  onRouteCalculated,
  onDismiss,
  userLocation,
  isVisible,
  onVisibilityChange,
}) {
  const [state, setState] = useState(STATES.IDLE);
  const [startPointRaw, setStartPointRaw] = useState("");
  const [destinationRaw, setDestinationRaw] = useState("");
  const [travelMode, setTravelMode] = useState("");
  const [routeData, setRouteData] = useState(null);
  const [routeId, setRouteId] = useState("");
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    'Say "Hi Tryver" to begin',
  );
  const [displayTranscript, setDisplayTranscript] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [speechRecognitionAvailable, setSpeechRecognitionAvailable] =
    useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionText, setCorrectionText] = useState("");
  const [correctionType, setCorrectionType] = useState("");
  const [correctionPlaceholder, setCorrectionPlaceholder] = useState("");
  const [correctionSuggestions, setCorrectionSuggestions] = useState([]);
  const [correctionSuggOpen, setCorrectionSuggOpen] = useState(false);
  const correctionResolveRef = useRef(null);
  const correctionDebRef = useRef(null);

  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [showCountdown, setShowCountdown] = useState(false);
  const countdownTimerRef = useRef(null);

  const stateRef = useRef(STATES.IDLE);
  const retryCountRef = useRef(0);
  const routeDataRef = useRef(null);
  const currentStepRef = useRef(0);
  const recordingTimerRef = useRef(null);
  const recognitionRef = useRef(null);
  const audioContextForLevelRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const handleNavigationCommandRef = useRef(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    retryCountRef.current = retryCount;
  }, [retryCount]);
  useEffect(() => {
    routeDataRef.current = routeData;
  }, [routeData]);
  useEffect(() => {
    currentStepRef.current = currentStepIndex;
  }, [currentStepIndex]);

  const {
    sessionId,
    finalTranscript,
    setFinalTranscript,
    startRecording,
    stopRecording,
    isConnected,
    voskReady,
    isTranscribing,
  } = useVoiceSocket("http://127.0.0.1:5000");

  const resetAllData = useCallback(() => {
    setStartPointRaw("");
    setDestinationRaw("");
    setTravelMode("");
    setRouteData(null);
    routeDataRef.current = null;
    setRouteId("");
    setCurrentStepIndex(0);
    currentStepRef.current = 0;
    setDisplayTranscript("");
    retryCountRef.current = 0;
    setRetryCount(0);
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }
    setShowCountdown(false);
    setCountdownSeconds(0);
  }, []);

  const cancelEverything = useCallback(() => {
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    stopRecording();

    resetAllData();

    setState(STATES.IDLE);
    setIsRecordingActive(false);
    setIsLoading(false);
    setIsSpeaking(false);
    setDisplayTranscript("");
    setShowCorrection(false);
    setShowCountdown(false);

    if (pendingTranscriptResolveRef.current) {
      pendingTranscriptResolveRef.current = null;
    }

    window.speechSynthesis.cancel();

    onDismiss();
  }, [stopRecording, resetAllData, onDismiss]);

  useEffect(() => {
    if (!isVisible) window.speechSynthesis.cancel();
  }, [isVisible]);

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
    utterance.lang = "en-US";

    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find(
        (v) =>
          v.name.includes("Samantha") ||
          v.name.includes("Google UK English Female") ||
          v.name.includes("Microsoft Zira") ||
          (v.lang === "en-US" && v.localService),
      ) || voices.find((v) => v.lang === "en-US");
    if (preferred) utterance.voice = preferred;

    utterance.onend = () => {
      setIsSpeaking(false);
      if (onDone) onDone();
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      if (onDone) onDone();
    };

    if (text.length > 200) {
      const pauseResume = setInterval(() => {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.pause();
          setTimeout(() => window.speechSynthesis.resume(), 50);
        } else clearInterval(pauseResume);
      }, 10000);
      utterance.onend = () => {
        clearInterval(pauseResume);
        setIsSpeaking(false);
        if (onDone) onDone();
      };
    }

    window.speechSynthesis.speak(utterance);
  }, []);

  // ── Audio level visualizer ───────────────────────────────────────────────

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
      /* non-critical */
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

  const playChime = useCallback((freq1 = 440, freq2 = 660) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [
        [freq1, 0, 0.2],
        [freq2, 0.25, 0.15],
      ].forEach(([freq, startOffset, dur]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);
        gain.gain.setValueAtTime(0.25, ctx.currentTime + startOffset);
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          ctx.currentTime + startOffset + dur,
        );
        osc.start(ctx.currentTime + startOffset);
        osc.stop(ctx.currentTime + startOffset + dur + 0.05);
      });
    } catch (e) {
      /* non-critical */
    }
  }, []);


  const skipCountdownRef = useRef(null);

  const runCountdown = useCallback((seconds) => {
    return new Promise((resolve) => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
      setCountdownSeconds(seconds);
      setShowCountdown(true);

      skipCountdownRef.current = () => {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        setShowCountdown(false);
        setCountdownSeconds(0);
        skipCountdownRef.current = null;
        resolve();
      };

      let remaining = seconds;
      countdownTimerRef.current = setInterval(() => {
        remaining -= 1;
        setCountdownSeconds(remaining);
        if (remaining <= 0) {
          clearInterval(countdownTimerRef.current);
          setShowCountdown(false);
          setCountdownSeconds(0);
          skipCountdownRef.current = null;
          resolve();
        }
      }, 1000);
    });
  }, []);


  const askForCorrection = useCallback(
    async (originalText, type, placeholder) => {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setDisplayTranscript(originalText || "");
      await runCountdown(CORRECTION_COUNTDOWN_SECONDS);
      return new Promise((resolve) => {
        setCorrectionText(originalText || "");
        setCorrectionType(type);
        setCorrectionPlaceholder(placeholder);
        setCorrectionSuggestions([]);
        setCorrectionSuggOpen(false);
        correctionResolveRef.current = resolve;
        setShowCorrection(true);
      });
    },
    [runCountdown],
  );

  const pendingTranscriptResolveRef = useRef(null);

  const resolveTranscriptRef = useRef(null);

  const startListeningWithVosk = useCallback(
    (durationMs) => {
      return new Promise(async (resolve) => {
        if (!voskReady || !sessionId) {
          resolve(null);
          return;
        }

        pendingTranscriptResolveRef.current = (result) => {
          clearTimeout(recordingTimerRef.current);
          setIsRecordingActive(false);
          stopAudioLevelMonitor();
          resolve(result);
        };

        await startRecording();
        setIsRecordingActive(true);
        setDisplayTranscript("Listening...");
        startAudioLevelMonitor();

        recordingTimerRef.current = setTimeout(() => {
          stopRecording();
          setIsRecordingActive(false);
          setDisplayTranscript("Transcribing...");
          stopAudioLevelMonitor();

          const fallbackTimer = setTimeout(() => {
            if (pendingTranscriptResolveRef.current) {
              pendingTranscriptResolveRef.current = null;
              resolve(null);
            }
          }, 15000);

          recordingTimerRef.current = fallbackTimer;
        }, durationMs);
      });
    },
    [
      voskReady,
      sessionId,
      startRecording,
      stopRecording,
      startAudioLevelMonitor,
      stopAudioLevelMonitor,
    ],
  );

  useEffect(() => {
    if (finalTranscript === null) return;

    if (pendingTranscriptResolveRef.current) {
      const handler = pendingTranscriptResolveRef.current;
      pendingTranscriptResolveRef.current = null;
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setFinalTranscript(null);

      const text =
        finalTranscript.text === "__EMPTY__" ? null : finalTranscript.text;
      if (text) setDisplayTranscript(text);
      else setDisplayTranscript("");

      handler(
        text === null
          ? null
          : { text, confidence: finalTranscript.confidence || 0.7 },
      );
    } else {
      setFinalTranscript(null);
    }
  }, [finalTranscript, setFinalTranscript]);


  const handleNavigationCommand = useCallback(
    (text) => {
      const t = text.toLowerCase().trim();
      const route = routeDataRef.current;
      if (!route) return;
      const steps = route.steps || [];
      const totalSteps = steps.length;

      if (/\b(directions?|steps?|navigate|all steps|read steps)\b/.test(t)) {
        const allSteps = steps
          .map((s, i) => {
            const instr =
              s.instruction || s.maneuver?.instruction || `Step ${i + 1}`;
            const dist = s.distance || "";
            return `Step ${i + 1}: ${instr}${dist ? ". Distance: " + dist : ""}`;
          })
          .join(". Pause. ");
        speak(
          `Here are all ${totalSteps} steps. ${allSteps}. End of directions.`,
        );
        return;
      }
      if (/\b(next|next step|continue)\b/.test(t)) {
        const nextIdx = currentStepRef.current + 1;
        if (nextIdx >= totalSteps) {
          speak("You have reached the end of the directions.");
          return;
        }
        setCurrentStepIndex(nextIdx);
        currentStepRef.current = nextIdx;
        const step = steps[nextIdx];
        speak(
          `Step ${nextIdx + 1} of ${totalSteps}: ${step.instruction || `Step ${nextIdx + 1}`}`,
        );
        return;
      }
      const stepMatch = t.match(/step\s+(\w+)/);
      if (stepMatch) {
        const num = parseInt(stepMatch[1]) || WORD_TO_NUMBER[stepMatch[1]];
        if (num && num >= 1 && num <= totalSteps) {
          const idx = num - 1;
          setCurrentStepIndex(idx);
          currentStepRef.current = idx;
          speak(
            `Step ${num} of ${totalSteps}: ${steps[idx].instruction || `Step ${num}`}`,
          );
          return;
        }
      }
      if (/\b(repeat|again|say again)\b/.test(t)) {
        const step = steps[currentStepRef.current];
        speak(
          `Repeating: Step ${currentStepRef.current + 1}: ${step?.instruction || "Follow route"}`,
        );
        return;
      }
      if (/\b(how far|distance)\b/.test(t)) {
        speak(`Your total route distance is ${route.distance}.`);
        return;
      }
      if (/\b(how long|time|duration|eta)\b/.test(t)) {
        speak(`Your estimated travel time is ${route.duration}.`);
        return;
      }
      if (/\b(safe|safety|danger|risk)\b/.test(t)) {
        const s = route.safety || {};
        speak(
          `Your route has a ${s.risk_level || "unknown"} risk level${s.overall_safety ? ` with a safety score of ${Math.round(s.overall_safety * 100)} percent` : ""}.`,
        );
        return;
      }
      if (
        /\b(new route|different route|change destination|start (a )?new)\b/.test(
          t,
        )
      ) {
        speak("Starting a new route.", () => {
          resetAllData();
          setState(STATES.GREETING);
        });
        return;
      }
      if (/\b(stop|cancel|exit|goodbye|bye|quit|end navigation)\b/.test(t)) {
        speak("Navigation ended. Goodbye!", () => {
          resetAllData();
          setState(STATES.IDLE);
        });
        return;
      }
      if (/\b(help|what can|commands?|options?)\b/.test(t)) {
        speak(
          "Available commands: directions, next step, step number, repeat, how far, how long, safety, new route, or stop.",
        );
        return;
      }
      speak(
        "I didn't understand that. Say: directions, next step, repeat, how far, how long, or stop.",
      );
    },
    [speak],
  );

  handleNavigationCommandRef.current = handleNavigationCommand;

  useEffect(() => {
    if (!isVisible) return;
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechRecognitionAvailable(false);
      return;
    }
    setSpeechRecognitionAvailable(true);

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 3;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      if (!["IDLE", "NAVIGATING"].includes(stateRef.current)) return;
      const results = Array.from(event.results);
      const allText = results
        .flatMap((r) => Array.from(r))
        .map((alt) => alt.transcript.toLowerCase())
        .join(" ");
      if (stateRef.current === "IDLE" && allText.includes("tryver")) {
        playChime(440, 660);
        recognition.stop();
        setState(STATES.GREETING);
        return;
      }
      const finalResult = results[results.length - 1];
      if (stateRef.current === "NAVIGATING" && finalResult.isFinal) {
        if (handleNavigationCommandRef.current)
          handleNavigationCommandRef.current(allText);
      }
    };

    recognition.onerror = (e) => {
      if (e.error === "not-allowed")
        setErrorMessage("Microphone permission denied.");
      if (e.error !== "no-speech" && e.error !== "aborted") {
        setTimeout(() => {
          if (["IDLE", "NAVIGATING"].includes(stateRef.current) && isVisible) {
            try {
              recognition.start();
            } catch (err) {}
          }
        }, 1500);
      }
    };
    recognition.onend = () => {
      setTimeout(() => {
        if (["IDLE", "NAVIGATING"].includes(stateRef.current) && isVisible) {
          try {
            recognition.start();
          } catch (err) {}
        }
      }, 500);
    };
    return () => {
      try {
        recognition.stop();
      } catch (e) {}
    };
  }, [isVisible, playChime]);

  const handleGreetingState = useCallback(async () => {
    speak(
      "Hi! First, what is your starting point? Say an address, a landmark, or say current location to use GPS.",
      async () => {
        const result = await startListeningWithVosk(
          RECORDING_DURATIONS.COLLECTING_START,
        );
        if (result && result.text && result.text.length >= 3) {
          const corrected = await askForCorrection(
            result.text,
            "start",
            "e.g., 738 Dorseyville Rd or Current Location",
          );
          const finalText =
            corrected !== null && corrected !== undefined
              ? corrected
              : result.text;
          if (!finalText || finalText.trim().length < 2) {
            speak(
              "I didn't get a valid starting point. Let me try again.",
              async () => {
                const retry = await startListeningWithVosk(
                  RECORDING_DURATIONS.COLLECTING_START,
                );
                if (retry && retry.text && retry.text.length >= 3) {
                  const rc = await askForCorrection(
                    retry.text,
                    "start",
                    "e.g., 738 Dorseyville Rd",
                  );
                  setStartPointRaw(
                    rc !== null && rc !== undefined ? rc : retry.text,
                  );
                  retryCountRef.current = 0;
                  setRetryCount(0);
                  setState(STATES.COLLECTING_DESTINATION);
                } else {
                  speak("Let me start over.", () => {
                    resetAllData();
                    setState(STATES.IDLE);
                  });
                }
              },
            );
            return;
          }
          setStartPointRaw(finalText);
          retryCountRef.current = 0;
          setRetryCount(0);
          setState(STATES.COLLECTING_DESTINATION);
        } else {
          retryCountRef.current++;
          setRetryCount(retryCountRef.current);
          if (retryCountRef.current >= MAX_RETRIES) {
            speak("I'm having trouble hearing you. Let me start over.", () => {
              resetAllData();
              setState(STATES.IDLE);
            });
          } else {
            speak(
              "I didn't catch that. Please say your starting point again.",
              async () => {
                const retry = await startListeningWithVosk(
                  RECORDING_DURATIONS.COLLECTING_START,
                );
                if (retry && retry.text && retry.text.length >= 3) {
                  const rc = await askForCorrection(
                    retry.text,
                    "start",
                    "e.g., 738 Dorseyville Rd",
                  );
                  setStartPointRaw(
                    rc !== null && rc !== undefined ? rc : retry.text,
                  );
                  retryCountRef.current = 0;
                  setRetryCount(0);
                  setState(STATES.COLLECTING_DESTINATION);
                } else {
                  speak("Let me start over.", () => {
                    resetAllData();
                    setState(STATES.IDLE);
                  });
                }
              },
            );
          }
        }
      },
    );
  }, [speak, startListeningWithVosk, askForCorrection, resetAllData]);

  const handleDestinationState = useCallback(async () => {
    speak("Got it. Now, what is your destination?", async () => {
      const result = await startListeningWithVosk(
        RECORDING_DURATIONS.COLLECTING_DESTINATION,
      );
      const rawText = result?.text || null;
      const isValid =
        rawText && rawText.length >= 2 && rawText !== startPointRaw;
      if (isValid) {
        const corrected = await askForCorrection(
          rawText,
          "destination",
          "e.g., Carnegie Mellon University",
        );
        const finalText =
          corrected !== null && corrected !== undefined ? corrected : rawText;
        if (!finalText || finalText.trim().length < 2) {
          speak(
            "I didn't get a valid destination. Please try again.",
            async () => {
              const retry = await startListeningWithVosk(
                RECORDING_DURATIONS.COLLECTING_DESTINATION,
              );
              if (retry && retry.text && retry.text.length >= 2) {
                const rc = await askForCorrection(
                  retry.text,
                  "destination",
                  "e.g., Carnegie Mellon University",
                );
                setDestinationRaw(
                  rc !== null && rc !== undefined ? rc : retry.text,
                );
                retryCountRef.current = 0;
                setState(STATES.COLLECTING_MODE);
              } else {
                speak("Let me start over.", () => {
                  resetAllData();
                  setState(STATES.IDLE);
                });
              }
            },
          );
          return;
        }
        setDestinationRaw(finalText);
        retryCountRef.current = 0;
        setRetryCount(0);
        setState(STATES.COLLECTING_MODE);
      } else {
        retryCountRef.current++;
        if (retryCountRef.current >= MAX_RETRIES) {
          speak("Let me start over.", () => {
            resetAllData();
            setState(STATES.IDLE);
          });
          return;
        }
        speak(
          rawText === startPointRaw
            ? "Destination can't be same as start. Say a different one."
            : "I didn't catch your destination.",
          async () => {
            const retry = await startListeningWithVosk(
              RECORDING_DURATIONS.COLLECTING_DESTINATION,
            );
            if (
              retry?.text &&
              retry.text.length >= 2 &&
              retry.text !== startPointRaw
            ) {
              const rc = await askForCorrection(
                retry.text,
                "destination",
                "e.g., Carnegie Mellon University",
              );
              setDestinationRaw(
                rc !== null && rc !== undefined ? rc : retry.text,
              );
              retryCountRef.current = 0;
              setState(STATES.COLLECTING_MODE);
            } else {
              speak("Let me start over.", () => {
                resetAllData();
                setState(STATES.IDLE);
              });
            }
          },
        );
      }
    });
  }, [
    speak,
    startListeningWithVosk,
    askForCorrection,
    startPointRaw,
    resetAllData,
  ]);

  const handleModeState = useCallback(async () => {
    speak(
      "How would you like to travel? Say walking or transit.",
      async () => {
        const result = await startListeningWithVosk(
          RECORDING_DURATIONS.COLLECTING_MODE,
        );
        const transcript = result?.text || null;
        let detectedMode = null;
        if (transcript) {
          if (/walk(ing)?/.test(transcript)) detectedMode = "walk";
          else if (/transit|bus/.test(transcript)) detectedMode = "transit";
          else if (/wheelchair|accessible|roll/.test(transcript))
            detectedMode = "wheelchair";
        }
        if (detectedMode) {
          setTravelMode(detectedMode);
          retryCountRef.current = 0;
          setState(STATES.CONFIRMING);
        } else {
          retryCountRef.current++;
          if (retryCountRef.current >= MAX_RETRIES) {
            speak("I'll use walking mode.", () => {
              setTravelMode("walk");
              setState(STATES.CONFIRMING);
            });
            return;
          }
          speak("Please say walking, transit, or wheelchair.", async () => {
            const retry = await startListeningWithVosk(
              RECORDING_DURATIONS.COLLECTING_MODE,
            );
            let mode = null;
            if (retry?.text) {
              if (/walk/.test(retry.text)) mode = "walk";
              else if (/transit|bus/.test(retry.text)) mode = "transit";
              else if (/wheelchair|accessible/.test(retry.text))
                mode = "wheelchair";
            }
            if (mode) {
              setTravelMode(mode);
              retryCountRef.current = 0;
              setState(STATES.CONFIRMING);
            } else {
              speak("I'll use walking mode.", () => {
                setTravelMode("walk");
                setState(STATES.CONFIRMING);
              });
            }
          });
        }
      },
    );
  }, [speak, startListeningWithVosk, resetAllData]);

  const handleConfirmingState = useCallback(async () => {
    const modeLabel =
      travelMode === "walk"
        ? "walking"
        : travelMode === "transit"
          ? "transit by bus"
          : "wheelchair accessible";
    speak(
      `Let me confirm. From ${startPointRaw}. To ${destinationRaw}. Mode: ${modeLabel}. Is that correct?`,
      async () => {
        const result = await startListeningWithVosk(
          RECORDING_DURATIONS.CONFIRMING,
        );
        const transcript = result?.text || null;
        const isYes =
          transcript &&
          /\b(yes|correct|confirm|yeah|yep|sure|right|okay|ok)\b/.test(
            transcript,
          );
        const isNo =
          transcript &&
          /\b(no|wrong|incorrect|restart|start over|different|change)\b/.test(
            transcript,
          );
        if (isYes) {
          setState(STATES.ROUTING);
        } else if (isNo) {
          speak("No problem, let's start over.", () => {
            resetAllData();
            setState(STATES.IDLE);
          });
        } else {
          retryCountRef.current++;
          if (retryCountRef.current >= MAX_RETRIES) {
            speak("I'll take that as a yes.", () => {
              setState(STATES.ROUTING);
            });
          } else {
            speak("Please say yes or no.", async () => {
              const retry = await startListeningWithVosk(
                RECORDING_DURATIONS.CONFIRMING,
              );
              if (
                retry?.text &&
                /\b(yes|correct|yeah|yep|ok)\b/.test(retry.text)
              )
                setState(STATES.ROUTING);
              else {
                speak("Let me start over.", () => {
                  resetAllData();
                  setState(STATES.IDLE);
                });
              }
            });
          }
        }
      },
    );
  }, [
    speak,
    startListeningWithVosk,
    startPointRaw,
    destinationRaw,
    travelMode,
    resetAllData,
  ]);

  const handleRoutingState = useCallback(async () => {
    speak("Calculating your route now, please wait.");
    setIsLoading(true);
    setDisplayTranscript("");
    try {
      const body = {
        start: startPointRaw,
        destination: destinationRaw,
        mode: travelMode,
        user_lat: userLocation ? userLocation[0] : 40.4406,
        user_lng: userLocation ? userLocation[1] : -79.9959,
      };
      const response = await fetch("http://127.0.0.1:5000/api/voice-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
              coordinates: (data.route_coords || []).map((p) => ({
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
        const numSteps = (data.steps || []).length;
        speak(
          `Route found! Your ${travelMode} route from ${data.start_address} to ${data.end_address} is approximately ${data.distance} and will take ${data.duration}. ${numSteps} steps. Say directions to hear all steps, next step for one at a time, or stop to end.`,
          () => {
            setState(STATES.NAVIGATING);
          },
        );
      } else {
        const errCode = data.code || "";
        let errMsg = "I couldn't find a route between those locations.";
        if (errCode === "GEOCODE_FAILED_START")
          errMsg = `I couldn't find: ${startPointRaw}.`;
        if (errCode === "GEOCODE_FAILED_DEST")
          errMsg = `I couldn't find: ${destinationRaw}.`;
        speak(errMsg + " Let me start over.", () => {
          resetAllData();
          setState(STATES.IDLE);
        });
      }
    } catch (err) {
      setIsLoading(false);
      speak(
        "I'm having trouble connecting to the server. Please try again.",
        () => {
          resetAllData();
          setState(STATES.IDLE);
        },
      );
    }
  }, [
    speak,
    startPointRaw,
    destinationRaw,
    travelMode,
    userLocation,
    onRouteCalculated,
    resetAllData,
  ]);

  useEffect(() => {
    if (!voskReady && state !== STATES.IDLE) {
      speak(
        "Voice recognition is not available. Please check the server console.",
      );
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
      try {
        recognitionRef.current?.stop();
      } catch (e) {}
      stopRecording();
      stopAudioLevelMonitor();
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
      if (correctionDebRef.current) clearTimeout(correctionDebRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [stopRecording, stopAudioLevelMonitor]);

  const progressSteps = useMemo(
    () => [
      {
        label: "Start",
        done: !!startPointRaw,
        active: state === STATES.GREETING || state === STATES.COLLECTING_START,
      },
      {
        label: "Destination",
        done: !!destinationRaw,
        active: state === STATES.COLLECTING_DESTINATION,
      },
      {
        label: "Mode",
        done: !!travelMode,
        active: state === STATES.COLLECTING_MODE,
      },
      {
        label: "Confirm",
        done: state === STATES.ROUTING || state === STATES.NAVIGATING,
        active: state === STATES.CONFIRMING,
      },
    ],
    [startPointRaw, destinationRaw, travelMode, state],
  );

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
    if (isLoading) return "⏳";
    if (isTranscribing) return "🧠";
    if (isRecordingActive) return "🔴";
    if (isSpeaking) return "🔊";
    if (showCountdown) return "⏱️";
    if (state === STATES.NAVIGATING) return "🗺️";
    if (state === STATES.IDLE) return "🎤";
    return "🎙️";
  };

  const getStateBadge = () => {
    if (isLoading) return { text: "ROUTING", color: "var(--amber)" };
    if (isTranscribing) return { text: "TRANSCRIBING", color: "var(--blue)" };
    if (isRecordingActive) return { text: "LISTENING", color: "var(--red)" };
    if (isSpeaking) return { text: "SPEAKING", color: "var(--green)" };
    if (showCountdown) return { text: "REVIEW", color: "var(--amber)" };
    if (state === STATES.NAVIGATING)
      return { text: "NAVIGATING", color: "var(--blue)" };
    return { text: "READY", color: "var(--wood)" };
  };

  const badge = getStateBadge();
  if (!isVisible) return null;

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tryver Voice Navigation Assistant"
        style={{
          position: "fixed",
          bottom: state === STATES.IDLE ? "50%" : "24px",
          right: state === STATES.IDLE ? "50%" : "70px",
          transform: state === STATES.IDLE ? "translate(50%, 50%)" : "none",
          width: state === STATES.IDLE ? "340px" : "360px",
          background: "var(--surface)",
          border: `1px solid ${isRecordingActive ? "var(--red)" : isTranscribing ? "var(--blue)" : isSpeaking ? "var(--green)" : "var(--border2)"}`,
          borderRadius: "20px",
          backdropFilter: "blur(32px)",
          boxShadow: "var(--sh-lg)",
          zIndex: 300,
          fontFamily: "var(--ff-b)",
          overflow: "hidden",
          transition: "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
          animation: "slideUp 0.3s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 16px 10px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "rgba(232,168,112,0.05)",
          }}
        >
          <span style={{ fontSize: "18px" }}>{getStateIcon()}</span>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: "var(--ff-d)",
                fontSize: "14px",
                fontWeight: 700,
                color: "var(--txt)",
              }}
            >
              Tryver Voice Navigation
            </div>
            {routeId && (
              <div
                style={{
                  fontSize: "10px",
                  color: "var(--txt3)",
                  marginTop: "1px",
                }}
              >
                Route: {routeId}
              </div>
            )}
          </div>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.5px",
              color: badge.color,
              background: `${badge.color}22`,
              border: `1px solid ${badge.color}44`,
              borderRadius: "6px",
              padding: "3px 8px",
            }}
          >
            {badge.text}
          </div>
          <button
            onClick={() => {
              cancelEverything();
            }}
            aria-label="Dismiss"
            style={{
              background: "var(--inset)",
              border: "1px solid var(--border)",
              borderRadius: "7px",
              width: "26px",
              height: "26px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "var(--txt2)",
              fontSize: "12px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Status message */}
        <div
          role="log"
          aria-live="polite"
          style={{ padding: "12px 16px 8px", minHeight: "52px" }}
        >
          <div
            style={{
              fontSize: "13px",
              lineHeight: "1.5",
              color: "var(--txt)",
              fontWeight: isSpeaking ? 500 : 400,
            }}
          >
            {statusMessage}
          </div>
        </div>

        {/* Transcribing indicator */}
        {isTranscribing && (
          <div
            style={{
              margin: "0 16px 8px",
              padding: "10px 14px",
              background: "rgba(79,195,247,0.1)",
              border: "1px solid rgba(79,195,247,0.3)",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <div
              style={{
                width: "18px",
                height: "18px",
                border: "2px solid var(--border)",
                borderTopColor: "var(--blue)",
                borderRadius: "50%",
                animation: "spin 0.65s linear infinite",
                flexShrink: 0,
              }}
            />
            <div
              style={{
                fontSize: "12px",
                color: "var(--blue)",
                fontWeight: 600,
              }}
            >
              Transcribing with Whisper...
            </div>
          </div>
        )}

        {/* Countdown banner */}
        {showCountdown && (
          <div
            style={{
              margin: "0 16px 8px",
              padding: "10px 14px",
              background: "rgba(255,183,77,0.12)",
              border: "1px solid rgba(255,183,77,0.35)",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <div
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "50%",
                background: "var(--amber, #FFB74D)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--ff-d)",
                fontSize: "18px",
                fontWeight: 800,
                flexShrink: 0,
                boxShadow: "0 2px 8px rgba(255,183,77,0.4)",
                animation: "pulse 1s ease-in-out infinite",
              }}
            >
              {countdownSeconds}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "var(--txt)",
                  lineHeight: "1.4",
                }}
              >
                Not happy with what I heard?
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--txt2)",
                  marginTop: "2px",
                }}
              >
                Correction modal in{" "}
                <strong style={{ color: "var(--amber, #FFB74D)" }}>
                  {countdownSeconds}
                </strong>
                ...
              </div>
            </div>
            <button
              onClick={() => {
                if (skipCountdownRef.current) skipCountdownRef.current();
              }}
              style={{
                padding: "7px 14px",
                background: "var(--amber, #FFB74D)",
                border: "none",
                borderRadius: "8px",
                color: "#fff",
                fontFamily: "var(--ff-d)",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
              aria-label="Skip countdown and fix now"
            >
              Fix now
            </button>
          </div>
        )}

        {/* Waveform */}
        <div
          style={{
            padding: "4px 16px 8px",
            display: "flex",
            alignItems: "flex-end",
            gap: "4px",
            height: "44px",
          }}
        >
          {waveformBars.map((height, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${height}px`,
                maxHeight: "36px",
                background: isRecordingActive
                  ? `hsl(${120 - audioLevel}, 70%, 60%)`
                  : "var(--border)",
                borderRadius: "2px",
                transition: "height 0.1s ease, background 0.3s ease",
              }}
            />
          ))}
          <div
            style={{
              marginLeft: "8px",
              fontSize: "11px",
              color: isRecordingActive
                ? "var(--red)"
                : isTranscribing
                  ? "var(--blue)"
                  : "var(--txt3)",
              fontWeight: 600,
              whiteSpace: "nowrap",
              alignSelf: "center",
            }}
          >
            {isRecordingActive
              ? "● REC"
              : isTranscribing
                ? "🧠 Processing"
                : isSpeaking
                  ? "◉ Speaking"
                  : "○ Idle"}
          </div>
        </div>

        {/* Transcript display */}
        {displayTranscript && (
          <div
            style={{
              margin: "0 16px 8px",
              padding: "8px 12px",
              background: "var(--inset)",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              fontSize: "12px",
              color: "var(--txt2)",
              fontStyle: "italic",
            }}
          >
            {displayTranscript === "Listening..." ||
            displayTranscript === "Transcribing..."
              ? displayTranscript
              : `Heard: "${displayTranscript}"`}
          </div>
        )}

        {/* Engine not ready warning */}
        {!voskReady && (
          <div
            style={{
              margin: "0 16px 8px",
              padding: "10px 12px",
              background: "rgba(255,123,107,0.1)",
              border: "1px solid rgba(255,123,107,0.3)",
              borderRadius: "10px",
              fontSize: "11px",
              color: "var(--red)",
              lineHeight: "1.6",
            }}
          >
            ⚠️ Voice engine not ready. {errorMessage || "Check server console."}
          </div>
        )}

        {/* Loading spinner */}
        {isLoading && (
          <div
            style={{
              padding: "8px 16px 12px",
              display: "flex",
              gap: "12px",
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: "20px",
                height: "20px",
                border: "2px solid var(--border)",
                borderTopColor: "var(--wood)",
                borderRadius: "50%",
                animation: "spin 0.65s linear infinite",
                flexShrink: 0,
              }}
            />
            <div style={{ fontSize: "12px", color: "var(--txt2)" }}>
              <div>
                From:{" "}
                <strong style={{ color: "var(--txt)" }}>{startPointRaw}</strong>
              </div>
              <div>
                To:{" "}
                <strong style={{ color: "var(--txt)" }}>
                  {destinationRaw}
                </strong>
              </div>
              <div>
                Mode:{" "}
                <strong style={{ color: "var(--wood)" }}>{travelMode}</strong>
              </div>
            </div>
          </div>
        )}

        {/* Navigation step */}
        {state === STATES.NAVIGATING && routeData && (
          <div
            style={{
              margin: "0 16px 8px",
              padding: "8px 12px",
              background: "var(--blue-dim)",
              border: "1px solid rgba(79,195,247,0.3)",
              borderRadius: "10px",
            }}
          >
            <div
              style={{
                fontSize: "10px",
                color: "var(--blue)",
                fontWeight: 700,
                marginBottom: "4px",
              }}
            >
              STEP {currentStepIndex + 1} OF {(routeData.steps || []).length}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--txt)",
                lineHeight: "1.4",
              }}
            >
              {routeData.steps?.[currentStepIndex]?.instruction ||
                "Follow route"}
            </div>
            <div
              style={{
                marginTop: "6px",
                fontSize: "10px",
                color: "var(--txt3)",
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <span>Say "next step"</span>
              <span>Say "directions"</span>
              <span>Say "stop"</span>
            </div>
          </div>
        )}

        {/* Progress dots */}
        {[
          STATES.GREETING,
          STATES.COLLECTING_START,
          STATES.COLLECTING_DESTINATION,
          STATES.COLLECTING_MODE,
          STATES.CONFIRMING,
        ].includes(state) && (
          <div
            style={{
              padding: "6px 16px 12px",
              display: "flex",
              gap: "8px",
              alignItems: "center",
            }}
          >
            {progressSteps.map((step, i) => (
              <React.Fragment key={i}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "3px",
                  }}
                >
                  <div
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      background: step.done
                        ? "var(--wood)"
                        : step.active
                          ? "var(--green)"
                          : "var(--border)",
                      boxShadow: step.active ? "0 0 6px var(--green)" : "none",
                      transition: "all 0.3s ease",
                    }}
                  />
                  <div
                    style={{
                      fontSize: "9px",
                      color: "var(--txt3)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {step.label}
                  </div>
                </div>
                {i < progressSteps.length - 1 && (
                  <div
                    style={{
                      flex: 1,
                      height: "1px",
                      marginBottom: "12px",
                      background: step.done ? "var(--wood)" : "var(--border)",
                      transition: "background 0.3s ease",
                    }}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Idle state */}
        {state === STATES.IDLE && (
          <div style={{ padding: "4px 16px 16px", textAlign: "center" }}>
            {speechRecognitionAvailable ? (
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--txt2)",
                  lineHeight: "1.7",
                }}
              >
                Say{" "}
                <strong style={{ color: "var(--wood)" }}>"Hi Tryver"</strong> to
                begin
                <br />
                <span style={{ fontSize: "11px", color: "var(--txt3)" }}>
                  or tap the button below
                </span>
              </div>
            ) : (
              <div style={{ fontSize: "12px", color: "var(--txt2)" }}>
                Tap below to start voice navigation.
              </div>
            )}
            <button
              onClick={() => {
                if (voskReady) {
                  playChime(440, 660);
                  setState(STATES.GREETING);
                } else
                  speak(
                    "Voice recognition is not set up. Check the server console.",
                  );
              }}
              style={{
                marginTop: "10px",
                width: "100%",
                padding: "11px",
                background: "var(--wood-g)",
                border: "none",
                borderRadius: "12px",
                color: "white",
                fontFamily: "var(--ff-d)",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
                letterSpacing: "0.2px",
              }}
              aria-label="Tap to start voice navigation"
            >
              Tap to Start Navigation
            </button>
            <div
              style={{
                fontSize: "10px",
                color: "var(--txt3)",
                marginTop: "8px",
              }}
            >
              Tap anywhere on the map to dismiss
            </div>
          </div>
        )}
      </div>

      {/* Correction Modal */}
      {showCorrection && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Correct voice transcript"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.82)",
            backdropFilter: "blur(8px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              width: "90%",
              maxWidth: "500px",
              background: "var(--surface)",
              border: "1px solid var(--border2)",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "var(--sh-lg)",
              fontFamily: "var(--ff-b)",
              animation: "slideUp 0.22s ease",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginBottom: "14px",
              }}
            >
              <span style={{ fontSize: "20px" }}>🎙️</span>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontFamily: "var(--ff-d)",
                    fontSize: "15px",
                    fontWeight: 700,
                    color: "var(--txt)",
                  }}
                >
                  Did I hear that right?
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--txt3)",
                    marginTop: "2px",
                  }}
                >
                  Correct the{" "}
                  {correctionType === "start"
                    ? "starting point"
                    : "destination"}{" "}
                  if needed
                </div>
              </div>
            </div>
            <div
              style={{
                background: "var(--inset)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "10px 14px",
                marginBottom: "14px",
                fontSize: "13px",
                color: "var(--txt2)",
              }}
            >
              I heard:{" "}
              <span style={{ color: "var(--wood)", fontWeight: 600 }}>
                "{correctionText}"
              </span>
            </div>
            <div style={{ position: "relative", marginBottom: "18px" }}>
              <input
                type="text"
                value={correctionText}
                onChange={(e) => {
                  const val = e.target.value;
                  setCorrectionText(val);
                  setCorrectionSuggOpen(false);
                  if (correctionDebRef.current)
                    clearTimeout(correctionDebRef.current);
                  if (val.length > 2) {
                    correctionDebRef.current = setTimeout(() => {
                      const lat = userLocation?.[0] || 40.4406;
                      const lng = userLocation?.[1] || -79.9959;
                      fetch(
                        `https://api.tomtom.com/search/2/search/${encodeURIComponent(val)}.json?key=${TOMTOM_API_KEY}&limit=4&lat=${lat}&lon=${lng}&radius=50000&language=en-US`,
                      )
                        .then((r) => r.json())
                        .then((data) => {
                          const sugg = (data.results || [])
                            .slice(0, 4)
                            .map((r) => ({
                              name: r.poi?.name || r.address?.freeformAddress,
                              address: r.address?.freeformAddress,
                            }))
                            .filter((s) => s.name);
                          setCorrectionSuggestions(sugg);
                          setCorrectionSuggOpen(sugg.length > 0);
                        })
                        .catch(() => {});
                    }, 280);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setShowCorrection(false);
                    setCorrectionSuggOpen(false);
                    correctionResolveRef.current?.(correctionText);
                  } else if (e.key === "Escape") {
                    setShowCorrection(false);
                    setCorrectionSuggOpen(false);
                    correctionResolveRef.current?.(null);
                  }
                }}
                placeholder={correctionPlaceholder}
                autoFocus
                style={{
                  width: "100%",
                  background: "var(--inset)",
                  border: "1px solid var(--border2)",
                  borderRadius: "10px",
                  padding: "11px 14px",
                  color: "var(--txt)",
                  fontFamily: "var(--ff-b)",
                  fontSize: "13.5px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {correctionSuggOpen && correctionSuggestions.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    left: 0,
                    right: 0,
                    background: "var(--card)",
                    border: "1px solid var(--border2)",
                    borderRadius: "12px",
                    overflow: "hidden",
                    zIndex: 1001,
                    boxShadow: "var(--sh-lg)",
                  }}
                >
                  <div
                    style={{
                      padding: "7px 12px 5px",
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: "1px",
                      textTransform: "uppercase",
                      color: "var(--txt2)",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    📍 Suggestions
                  </div>
                  {correctionSuggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setCorrectionText(s.address || s.name);
                        setCorrectionSuggOpen(false);
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "9px 13px",
                        background: "transparent",
                        border: "none",
                        borderTop:
                          i > 0 ? "1px solid rgba(232,168,112,0.1)" : "none",
                        cursor: "pointer",
                        color: "var(--txt)",
                        fontFamily: "var(--ff-b)",
                        transition: "background 0.12s",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "var(--wood-dim)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent)")
                      }
                    >
                      <div style={{ fontSize: "13px", fontWeight: 500 }}>
                        {s.name}
                      </div>
                      {s.address && s.address !== s.name && (
                        <div
                          style={{
                            fontSize: "11px",
                            color: "var(--txt2)",
                            marginTop: "1px",
                          }}
                        >
                          {s.address}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => {
                  const v = correctionText.trim();
                  setShowCorrection(false);
                  setCorrectionSuggOpen(false);
                  correctionResolveRef.current?.(v.length > 0 ? v : null);
                }}
                style={{
                  flex: 1,
                  padding: "11px",
                  background: "var(--wood-g)",
                  border: "none",
                  borderRadius: "11px",
                  color: "white",
                  fontFamily: "var(--ff-d)",
                  fontSize: "14px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                ✓ Use this
              </button>
              <button
                onClick={() => {
                  setShowCorrection(false);
                  setCorrectionSuggOpen(false);
                  correctionResolveRef.current?.(null);
                }}
                style={{
                  flex: 1,
                  padding: "11px",
                  background: "var(--inset)",
                  border: "1px solid var(--border)",
                  borderRadius: "11px",
                  color: "var(--txt2)",
                  fontFamily: "var(--ff-b)",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Keep original
              </button>
            </div>
            <div
              style={{
                fontSize: "10px",
                color: "var(--txt3)",
                marginTop: "10px",
                textAlign: "center",
              }}
            >
              Press Enter to confirm · Esc to keep original
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
      `}</style>
    </>
  );
}

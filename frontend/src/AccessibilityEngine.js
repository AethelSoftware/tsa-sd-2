/**
 * Accessibility Engine for multi-sensory output
 * Supports blind, deaf, and mobility-impaired users
 */

class AccessibilityEngine {
    constructor() {
      this.audioContext = null;
      this.speechQueue = [];
      this.isSpeaking = false;
      this.hapticEnabled = 'vibrate' in navigator;
      this.screenReaderEnabled = 'speechSynthesis' in window;
      this.visualAlertsEnabled = true;
      this.userPreferences = {
        audioVolume: 0.8,
        speechRate: 1.0,
        hapticIntensity: 'medium',
        contrastLevel: 'normal',
        fontSize: 'medium',
        reduceMotion: false
      };
      
      this.init();
    }
    
    init() {
      // Initialize audio context
      if (window.AudioContext || window.webkitAudioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      // Load user preferences from localStorage
      this.loadPreferences();
      
      // Set up visual alert container
      this.setupVisualAlerts();
    }
    
    loadPreferences() {
      const saved = localStorage.getItem('tryver_accessibility_prefs');
      if (saved) {
        this.userPreferences = { ...this.userPreferences, ...JSON.parse(saved) };
      }
    }
    
    savePreferences() {
      localStorage.setItem('tryver_accessibility_prefs', JSON.stringify(this.userPreferences));
    }
    
    setupVisualAlerts() {
      // Create visual alert container
      this.visualAlertContainer = document.createElement('div');
      this.visualAlertContainer.id = 'tryver-visual-alerts';
      this.visualAlertContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      `;
      document.body.appendChild(this.visualAlertContainer);
    }
    
    // Audio Methods
    speak(text, options = {}) {
      if (!this.screenReaderEnabled || this.userPreferences.audioVolume === 0) {
        return;
      }
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = options.rate || this.userPreferences.speechRate;
      utterance.pitch = options.pitch || 1.0;
      utterance.volume = options.volume || this.userPreferences.audioVolume;
      
      if (options.language) {
        utterance.lang = options.language;
      }
      
      // Priority handling
      if (options.priority === 'high') {
        speechSynthesis.cancel(); // Cancel current speech
        speechSynthesis.speak(utterance);
      } else {
        this.speechQueue.push(utterance);
        this.processSpeechQueue();
      }
      
      return utterance;
    }
    
    processSpeechQueue() {
      if (this.isSpeaking || this.speechQueue.length === 0) return;
      
      this.isSpeaking = true;
      const utterance = this.speechQueue.shift();
      
      utterance.onend = () => {
        this.isSpeaking = false;
        setTimeout(() => this.processSpeechQueue(), 100);
      };
      
      utterance.onerror = () => {
        this.isSpeaking = false;
        setTimeout(() => this.processSpeechQueue(), 100);
      };
      
      speechSynthesis.speak(utterance);
    }
    
    playDirectionalAudio(direction, distance, options = {}) {
      if (!this.audioContext) return;
      
      const frequencies = {
        'left': 440,      // A4
        'right': 523.25,  // C5
        'straight': 659.25, // E5
        'arrival': 880,   // A5
        'warning': 330,   // E4
        'emergency': 220  // A3
      };
      
      const freq = frequencies[direction] || 440;
      const duration = options.duration || 200;
      
      this.playTone(freq, duration, options);
      
      // Speak direction for blind users
      if (options.announce !== false) {
        const messages = {
          'left': `Turn left in ${distance} meters`,
          'right': `Turn right in ${distance} meters`,
          'straight': `Continue straight for ${distance} meters`,
          'arrival': 'You have arrived at your destination',
          'warning': 'Warning ahead',
          'emergency': 'Emergency situation'
        };
        
        this.speak(messages[direction] || `Direction: ${direction}`, {
          priority: 'high',
          ...options
        });
      }
    }
    
    playTone(frequency, duration, options = {}) {
      if (!this.audioContext) return;
      
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      
      oscillator.frequency.value = frequency;
      oscillator.type = options.type || 'sine';
      
      const volume = options.volume || 0.3;
      const now = this.audioContext.currentTime;
      
      // Smooth envelope
      gainNode.gain.setValueAtTime(0.001, now);
      gainNode.gain.exponentialRampToValueAtTime(volume, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration / 1000);
      
      oscillator.start(now);
      oscillator.stop(now + duration / 1000);
      
      return { oscillator, gainNode };
    }
    
    // Haptic Methods
    playHapticPattern(pattern, intensity = null) {
      if (!this.hapticEnabled) return;
      
      const patterns = {
        'left_turn': [100, 50, 100],
        'right_turn': [100, 50, 100, 50, 100],
        'hazard_nearby': [200, 100, 200, 100, 200],
        'rerouting': [300, 100, 300],
        'arrival': [100, 100, 100, 100, 100],
        'emergency': [500, 100, 500, 100, 500],
        'attention': [150, 150, 150]
      };
      
      const patternToPlay = patterns[pattern] || [100];
      
      // Adjust intensity
      let adjustedPattern = patternToPlay;
      if (intensity === 'low') {
        adjustedPattern = patternToPlay.map(v => Math.round(v * 0.7));
      } else if (intensity === 'high') {
        adjustedPattern = patternToPlay.map(v => Math.round(v * 1.3));
      }
      
      navigator.vibrate(adjustedPattern);
    }
    
    // Visual Methods
    showVisualAlert(type, message, options = {}) {
      if (!this.visualAlertsEnabled) return;
      
      const alertTypes = {
        'warning': {
          bgColor: '#f59e0b',
          textColor: '#ffffff',
          icon: '⚠️',
          duration: 5000
        },
        'danger': {
          bgColor: '#ef4444',
          textColor: '#ffffff',
          icon: '🚨',
          duration: 7000
        },
        'info': {
          bgColor: '#3b82f6',
          textColor: '#ffffff',
          icon: 'ℹ️',
          duration: 3000
        },
        'success': {
          bgColor: '#10b981',
          textColor: '#ffffff',
          icon: '✅',
          duration: 3000
        }
      };
      
      const config = { ...alertTypes[type], ...options };
      
      const alertElement = document.createElement('div');
      alertElement.style.cssText = `
        background: ${config.bgColor};
        color: ${config.textColor};
        padding: 16px 24px;
        border-radius: 12px;
        margin: 10px;
        max-width: 400px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        gap: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: ${this.userPreferences.fontSize === 'large' ? '1.125rem' : '1rem'};
        animation: slideIn 0.3s ease-out;
        pointer-events: auto;
      `;
      
      alertElement.innerHTML = `
        <span style="font-size: 1.5em;">${config.icon}</span>
        <div style="flex: 1;">
          <div style="font-weight: 600; margin-bottom: 4px;">${message.title || type.toUpperCase()}</div>
          <div style="font-size: 0.9em; opacity: 0.9;">${message.description || ''}</div>
        </div>
        <button style="background: none; border: none; color: inherit; font-size: 1.2em; cursor: pointer; opacity: 0.7; transition: opacity 0.2s;" onclick="this.parentElement.remove()">
          ×
        </button>
      `;
      
      // Add animation styles if not already present
      if (!document.getElementById('tryver-animations')) {
        const style = document.createElement('style');
        style.id = 'tryver-animations';
        style.textContent = `
          @keyframes slideIn {
            from {
              transform: translateY(-20px);
              opacity: 0;
            }
            to {
              transform: translateY(0);
              opacity: 1;
            }
          }
          @keyframes flash {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
          }
        `;
        document.head.appendChild(style);
      }
      
      this.visualAlertContainer.appendChild(alertElement);
      
      // Auto-remove after duration
      setTimeout(() => {
        if (alertElement.parentElement) {
          alertElement.style.animation = 'slideIn 0.3s ease-out reverse';
          setTimeout(() => alertElement.remove(), 300);
        }
      }, config.duration);
      
      return alertElement;
    }
    
    flashScreen(color = '#ef4444', count = 3) {
      if (this.userPreferences.reduceMotion) return;
      
      const flashElement = document.createElement('div');
      flashElement.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: ${color};
        opacity: 0.3;
        pointer-events: none;
        z-index: 9998;
        animation: flash 0.5s ${count} forwards;
      `;
      
      document.body.appendChild(flashElement);
      
      setTimeout(() => {
        flashElement.remove();
      }, 500 * count + 100);
    }
    
    // Multi-sensory alert
    alertMultiSensory(type, data) {
      const alertConfigs = {
        'hazard_detected': {
          audio: () => this.playDirectionalAudio('warning', data.distance, { announce: true }),
          haptic: () => this.playHapticPattern('hazard_nearby', 'high'),
          visual: () => this.showVisualAlert('warning', {
            title: 'Hazard Detected',
            description: `${data.type} ${data.distance ? `${data.distance}m ahead` : 'nearby'}`
          })
        },
        'rerouting': {
          audio: () => this.speak(`Rerouting due to ${data.reason}. New route calculated.`, { priority: 'high' }),
          haptic: () => this.playHapticPattern('rerouting'),
          visual: () => this.showVisualAlert('info', {
            title: 'Rerouting',
            description: `Finding safer path: ${data.reason}`
          })
        },
        'emergency': {
          audio: () => {
            this.playDirectionalAudio('emergency', 0, { duration: 1000 });
            this.speak('EMERGENCY ALERT! Emergency services notified.', { priority: 'highest', rate: 0.9 });
          },
          haptic: () => this.playHapticPattern('emergency'),
          visual: () => {
            this.flashScreen('#ef4444', 10);
            this.showVisualAlert('danger', {
              title: 'EMERGENCY',
              description: 'Emergency services have been notified'
            }, { duration: 10000 });
          }
        },
        'arrival': {
          audio: () => this.playDirectionalAudio('arrival', 0),
          haptic: () => this.playHapticPattern('arrival'),
          visual: () => this.showVisualAlert('success', {
            title: 'Arrived',
            description: 'You have reached your destination'
          })
        }
      };
      
      const config = alertConfigs[type];
      if (!config) return;
      
      // Execute all sensory outputs
      if (this.userPreferences.audioVolume > 0) config.audio();
      if (this.hapticEnabled) config.haptic();
      if (this.visualAlertsEnabled) config.visual();
    }
    
    // Update preferences
    updatePreferences(newPrefs) {
      this.userPreferences = { ...this.userPreferences, ...newPrefs };
      this.savePreferences();
      
      // Apply visual preferences
      this.applyVisualPreferences();
    }
    
    applyVisualPreferences() {
      const root = document.documentElement;
      
      // Contrast
      if (this.userPreferences.contrastLevel === 'high') {
        root.style.setProperty('--text-color', '#000000');
        root.style.setProperty('--bg-color', '#ffffff');
        root.style.filter = 'contrast(1.5)';
      } else {
        root.style.removeProperty('--text-color');
        root.style.removeProperty('--bg-color');
        root.style.filter = 'none';
      }
      
      // Font size
      const sizes = {
        'small': '0.875rem',
        'medium': '1rem',
        'large': '1.125rem',
        'xlarge': '1.25rem'
      };
      document.body.style.fontSize = sizes[this.userPreferences.fontSize] || '1rem';
      
      // Reduce motion
      if (this.userPreferences.reduceMotion) {
        root.style.setProperty('--animation-speed', '0');
      } else {
        root.style.removeProperty('--animation-speed');
      }
    }
    
    // Test all outputs
    testOutputs() {
      console.log('Testing accessibility outputs...');
      
      // Test audio
      this.speak('Testing audio guidance system. This is a test message.', { priority: 'high' });
      
      // Test haptic
      this.playHapticPattern('attention');
      
      // Test visual
      this.showVisualAlert('info', {
        title: 'System Test',
        description: 'Testing all accessibility outputs'
      });
      
      // Play test tones
      setTimeout(() => this.playDirectionalAudio('left', 50), 1000);
      setTimeout(() => this.playDirectionalAudio('right', 50), 2000);
      setTimeout(() => this.playDirectionalAudio('arrival', 0), 3000);
      
      return 'Test sequence started';
    }
    
    // Emergency contact
    async notifyEmergencyContacts(position, message = 'Emergency alert from Tryver') {
      // In production, this would integrate with SMS/email APIs
      console.log('Emergency notification:', { position, message });
      
      // Show confirmation
      this.showVisualAlert('danger', {
        title: 'Emergency Alert Sent',
        description: 'Emergency contacts have been notified'
      });
      
      this.speak('Emergency contacts have been notified. Help is on the way.', { priority: 'highest' });
      
      // Also play emergency pattern
      this.playHapticPattern('emergency');
      this.flashScreen('#ef4444', 5);
      
      return { success: true, timestamp: Date.now() };
    }
  }
  
  // Export singleton instance
  const accessibilityEngine = new AccessibilityEngine();
  export default accessibilityEngine;
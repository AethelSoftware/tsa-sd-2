// src/App.jsx
import { useState } from "react";

function App() {
  const [activeTab, setActiveTab] = useState("features");

  // Mock data for comparison
  const competitorComparison = [
    {
      feature: "Real-time Emergency Avoidance",
      safepath: "✓",
      blindsquare: "Partial",
      googleMaps: "✗"
    },
    {
      feature: "Crowd Density Routing",
      safepath: "✓",
      blindsquare: "✗",
      googleMaps: "Limited"
    },
    {
      feature: "Voice Guidance for Blind Users",
      safepath: "✓",
      blindsquare: "✓",
      googleMaps: "Basic"
    },
    {
      feature: "Haptic Feedback for Deaf Users",
      safepath: "✓",
      blindsquare: "✗",
      googleMaps: "✗"
    },
    {
      feature: "Violent Crime Alerts",
      safepath: "✓",
      blindsquare: "✗",
      googleMaps: "✗"
    },
    {
      feature: "Fire & Disaster Routing",
      safepath: "✓",
      blindsquare: "✗",
      googleMaps: "Emergency alerts only"
    },
    {
      feature: "Accessibility-First Design",
      safepath: "✓",
      blindsquare: "✓",
      googleMaps: "✗"
    },
    {
      feature: "Free to Use",
      safepath: "✓",
      blindsquare: "Premium",
      googleMaps: "✓"
    }
  ];

  const features = [
    {
      icon: "🚨",
      title: "Emergency Avoidance",
      description: "Real-time routing around fires, crime scenes, and natural disasters"
    },
    {
      icon: "👥",
      title: "Crowd Intelligence",
      description: "Avoid crowded areas and find less congested routes"
    },
    {
      icon: "🔊",
      title: "Multi-Modal Alerts",
      description: "Voice, vibration, and visual alerts for all abilities"
    },
    {
      icon: "♿",
      title: "Accessibility First",
      description: "Designed specifically for blind and deaf users from the ground up"
    },
    {
      icon: "🛡️",
      title: "Safety Scoring",
      description: "Every route gets a safety score based on multiple factors"
    },
    {
      icon: "📱",
      title: "Simple Interface",
      description: "Clean, uncluttered design that's easy to navigate"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50/30">
      {/* Header */}
      <header className="bg-white/90 backdrop-blur-md border-b border-emerald-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent">
                Tryver
              </h1>
              <p className="text-slate-600 text-sm mt-1">Accessible navigation for everyone</p>
            </div>
            <div className="flex gap-3">
              <a href="/login">
                <button 
                  className="px-6 py-2.5 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50 transition-all duration-200 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:outline-none"
                  aria-label="Sign in to your account"
                >
                  Sign In
                </button>
              </a>

              <a href="/login">
                <button 
                  className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-green-600 text-white font-medium rounded-lg hover:shadow-lg transition-all duration-200 transform hover:-translate-y-0.5 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:outline-none"
                  aria-label="Create new account"
                >
                  Sign up
                </button>
              </a> 
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-emerald-100 text-emerald-800 px-4 py-2 rounded-full text-sm font-medium mb-6">
            🎯 Built for Accessibility • 100% Free Forever
          </div>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black text-slate-900 mb-6 leading-tight">
            Navigate The World
            <span className="block bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent">
              Safely & Confidently
            </span>
          </h1>
          <p className="text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
            The first navigation app designed specifically for blind and deaf users with 
            <span className="font-semibold text-slate-900"> real-time emergency avoidance</span> and multi-sensory guidance.
          </p>
        </div>

        {/* Navigation Tabs - Enhanced for Accessibility */}
        <div className="flex justify-center mb-16" role="tablist" aria-label="App features navigation">
          <div className="flex bg-white/80 backdrop-blur-sm rounded-2xl p-2 shadow-lg border border-emerald-200">
            {[
              { id: "features", label: "Key Features" },
              { id: "comparison", label: "Vs Competitors" },
              { id: "demo", label: "How It Works" }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`${tab.id}-panel`}
                className={`px-8 py-4 rounded-xl font-semibold transition-all duration-300 ${
                  activeTab === tab.id 
                    ? "bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow-lg transform scale-105" 
                    : "text-slate-600 hover:text-slate-900 hover:bg-emerald-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Features Panel */}
        <div 
          id="features-panel"
          role="tabpanel"
          aria-labelledby="features"
          className={activeTab === "features" ? "block" : "hidden"}
        >
          <div className="space-y-16">
            {/* Features Grid */}
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, index) => (
                <div 
                  key={index}
                  className="group bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-emerald-200 hover:border-emerald-300 transition-all duration-300 hover:shadow-xl hover:transform hover:-translate-y-2"
                >
                  <div className="text-4xl mb-6 transform group-hover:scale-110 transition-transform duration-300">
                    {feature.icon}
                  </div>
                  <h3 className="font-bold text-xl text-slate-900 mb-3">{feature.title}</h3>
                  <p className="text-slate-600 leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>

            {/* Visual Demo */}
            <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-10 border border-emerald-200 shadow-sm">
              <h2 className="text-3xl font-bold text-center text-slate-900 mb-12">
                Real-Time Protection System
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                <div className="space-y-6">
                  {[
                    {
                      icon: "⚠️",
                      color: "red",
                      title: "Emergency Detection",
                      description: "Real-time monitoring of fires, crimes, and disasters"
                    },
                    {
                      icon: "🔄",
                      color: "emerald",
                      title: "Automatic Rerouting",
                      description: "Instantly finds safer alternative routes"
                    },
                    {
                      icon: "🎯",
                      color: "blue",
                      title: "Multi-Sensory Alerts",
                      description: "Voice, vibration, and visual notifications"
                    }
                  ].map((item, index) => (
                    <div key={index} className="flex items-start gap-5 p-4 rounded-2xl bg-slate-50/50 hover:bg-white transition-colors duration-200">
                      <div className={`bg-${item.color}-100 p-4 rounded-2xl text-2xl flex-shrink-0`}>
                        {item.icon}
                      </div>
                      <div>
                        <h4 className="font-semibold text-lg text-slate-900 mb-2">{item.title}</h4>
                        <p className="text-slate-600">{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl p-8 text-center border border-emerald-200">
                  <div className="text-7xl mb-6">🗺️</div>
                  <p className="text-slate-700 font-medium mb-6">Interactive safety map with real-time updates</p>
                  <div className="flex justify-center gap-3 flex-wrap">
                    <span className="bg-red-500 text-white px-4 py-2 rounded-full text-sm font-semibold shadow-sm">Danger Zone</span>
                    <span className="bg-amber-500 text-white px-4 py-2 rounded-full text-sm font-semibold shadow-sm">Crowded Area</span>
                    <span className="bg-emerald-500 text-white px-4 py-2 rounded-full text-sm font-semibold shadow-sm">Safe Route</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Comparison Panel */}
        <div 
          id="comparison-panel"
          role="tabpanel"
          aria-labelledby="comparison"
          className={activeTab === "comparison" ? "block" : "hidden"}
        >
          <div className="space-y-8">
            <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-8 border border-emerald-200 shadow-sm">
              <h2 className="text-3xl font-bold text-center text-slate-900 mb-12">
                Unmatched Accessibility & Safety
              </h2>
              
              {/* Comparison Table */}
              <div className="overflow-x-auto rounded-2xl border border-emerald-200">
                <table className="w-full" aria-label="Feature comparison table">
                  <thead>
                    <tr className="bg-slate-50/80">
                      <th className="px-8 py-6 text-left font-bold text-slate-900 text-lg">Navigation Feature</th>
                      <th className="px-8 py-6 text-center font-bold text-emerald-700 text-lg">Tryver</th>
                      <th className="px-8 py-6 text-center font-bold text-blue-700 text-lg">BlindSquare</th>
                      <th className="px-8 py-6 text-center font-bold text-red-700 text-lg">Google Maps</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {competitorComparison.map((row, index) => (
                      <tr key={index} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-8 py-5 font-semibold text-slate-900">{row.feature}</td>
                        <td className="px-8 py-5 text-center">
                          <span className="bg-emerald-100 text-emerald-800 px-4 py-2 rounded-full text-sm font-bold shadow-sm">
                            {row.safepath}
                          </span>
                        </td>
                        <td className="px-8 py-5 text-center">
                          <span className="bg-blue-100 text-blue-800 px-4 py-2 rounded-full text-sm font-bold">
                            {row.blindsquare}
                          </span>
                        </td>
                        <td className="px-8 py-5 text-center">
                          <span className="bg-red-100 text-red-800 px-4 py-2 rounded-full text-sm font-bold">
                            {row.googleMaps}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Key Differentiators */}
              <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
                {[
                  {
                    icon: "🎯",
                    title: "Specialized Design",
                    description: "Built specifically for accessibility needs from the ground up"
                  },
                  {
                    icon: "🆓",
                    title: "Completely Free",
                    description: "No premium tiers, subscriptions, or hidden costs"
                  },
                  {
                    icon: "🛡️",
                    title: "Safety First",
                    description: "Proactive emergency avoidance and real-time protection"
                  }
                ].map((item, index) => (
                  <div key={index} className="text-center p-8 bg-gradient-to-b from-white to-emerald-50/50 rounded-2xl border border-emerald-200 hover:shadow-lg transition-all duration-300">
                    <div className="text-5xl mb-6">{item.icon}</div>
                    <h3 className="font-bold text-xl text-slate-900 mb-4">{item.title}</h3>
                    <p className="text-slate-600 leading-relaxed">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Demo Panel */}
        <div 
          id="demo-panel"
          role="tabpanel"
          aria-labelledby="demo"
          className={activeTab === "demo" ? "block" : "hidden"}
        >
          <div className="space-y-8">
            <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-10 border border-emerald-200 shadow-sm">
              <h2 className="text-3xl font-bold text-center text-slate-900 mb-12">
                Simple, Intuitive Navigation
              </h2>
              
              {/* Process Steps */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
                {[
                  {
                    step: "1",
                    title: "Set Your Destination",
                    description: "Enter where you want to go using voice, text, or preset locations"
                  },
                  {
                    step: "2",
                    title: "Safety Analysis",
                    description: "We analyze routes for emergencies, crowds, and accessibility"
                  },
                  {
                    step: "3",
                    title: "Guided Navigation",
                    description: "Follow safe routes with multi-sensory guidance"
                  }
                ].map((step, index) => (
                  <div key={index} className="text-center group">
                    <div className="bg-gradient-to-br from-emerald-600 to-green-600 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 text-2xl font-black text-white shadow-lg transform group-hover:scale-110 transition-transform duration-300">
                      {step.step}
                    </div>
                    <h3 className="font-bold text-xl text-slate-900 mb-4">{step.title}</h3>
                    <p className="text-slate-600 leading-relaxed">{step.description}</p>
                  </div>
                ))}
              </div>

              {/* User Scenarios */}
              <div>
                <h3 className="text-2xl font-bold text-center text-slate-900 mb-12">
                  Designed For Real Accessibility Needs
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {[
                    {
                      icon: "👨‍🦯",
                      title: "For Blind Users",
                      features: [
                        "Detailed voice descriptions of surroundings",
                        "Haptic feedback for turns and alerts", 
                        "Avoidance of construction and obstacles",
                        "Audio-based safety notifications"
                      ]
                    },
                    {
                      icon: "🧏‍♀️",
                      title: "For Deaf Users",
                      features: [
                        "Strong visual and vibration alerts",
                        "Emergency visual indicators",
                        "Text-based route instructions",
                        "Flashing light warnings for dangers"
                      ]
                    }
                  ].map((scenario, index) => (
                    <div key={index} className="bg-gradient-to-br from-slate-50 to-emerald-50/30 p-8 rounded-2xl border border-emerald-200 hover:shadow-lg transition-all duration-300">
                      <div className="flex items-center mb-6">
                        <div className="text-4xl mr-5">{scenario.icon}</div>
                        <h4 className="font-bold text-xl text-slate-900">{scenario.title}</h4>
                      </div>
                      <ul className="space-y-4">
                        {scenario.features.map((feature, featureIndex) => (
                          <li key={featureIndex} className="flex items-start">
                            <span className="text-emerald-500 mr-3 mt-1">✓</span>
                            <span className="text-slate-700">{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Call to Action */}
        <div className="text-center mt-20 bg-gradient-to-br from-emerald-600 to-green-700 rounded-3xl p-12 text-white shadow-2xl">
          <h2 className="text-4xl font-black mb-6">Ready to Navigate with Confidence?</h2>
          <p className="text-emerald-100 text-xl mb-8 max-w-2xl mx-auto leading-relaxed">
            Begin navigating safetly with Tryver.
            Completely free, completely accessible.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a href="/login">
              <button 
                className="px-10 py-4 bg-white text-slate-900 font-bold rounded-2xl hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 focus:ring-4 focus:ring-white/50 focus:outline-none text-lg"
                aria-label="Get started with Tryver for free"
              >
                Get Started Free
              </button>
            </a>
            
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-white mt-20">
        <div className="max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
          <div className="text-center">
            <h3 className="text-2xl font-bold mb-4 bg-gradient-to-r from-emerald-400 to-green-400 bg-clip-text text-transparent">
              Tryver
            </h3>
            <p className="text-slate-400 max-w-md mx-auto leading-relaxed">
              Making the world more accessible and safe for everyone, one route at a time.
            </p>
            <div className="mt-8 pt-8 border-t border-slate-800 text-slate-500 text-sm">
              <p>© 2025 Tryver. All rights reserved. Built with ♥ for the accessibility community.</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
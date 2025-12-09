// src/App.jsx
import { useState, useEffect } from "react";
import { 
  Shield, 
  Users, 
  Volume2, 
  Accessibility,
  Award,
  Smartphone,
  Map,
  RefreshCw,
  AlertTriangle,
  Target,
  Eye,
  Ear,
  Check,
  X,
  Star,
  Crown,
  Navigation,
  AlertCircle,
  Bell,
  Menu,
  X as CloseIcon
} from "lucide-react";

function App() {
  const [activeTab, setActiveTab] = useState("features");
  const [isVisible, setIsVisible] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  // Mock data for comparison
  const competitorComparison = [
    {
      feature: "Real-time Emergency Avoidance",
      safepath: "Full Support",
      blindsquare: "Partial",
      googleMaps: "Not Available"
    },
    {
      feature: "Crowd Density Routing",
      safepath: "Full Support",
      blindsquare: "Not Available",
      googleMaps: "Limited"
    },
    {
      feature: "Voice Guidance for Blind Users",
      safepath: "Advanced",
      blindsquare: "Advanced",
      googleMaps: "Basic"
    },
    {
      feature: "Haptic Feedback for Deaf Users",
      safepath: "Full Support",
      blindsquare: "Not Available",
      googleMaps: "Not Available"
    },
    {
      feature: "Violent Crime Alerts",
      safepath: "Real-time",
      blindsquare: "Not Available",
      googleMaps: "Not Available"
    },
    {
      feature: "Fire & Disaster Routing",
      safepath: "Proactive",
      blindsquare: "Not Available",
      googleMaps: "Alerts Only"
    },
    {
      feature: "Accessibility-First Design",
      safepath: "Built-in",
      blindsquare: "Built-in",
      googleMaps: "Limited"
    },
    {
      feature: "Free to Use",
      safepath: "Completely Free",
      blindsquare: "Premium",
      googleMaps: "Free"
    }
  ];

  const features = [
    {
      icon: Shield,
      title: "Emergency Avoidance",
      description: "Real-time routing around fires, crime scenes, and natural disasters with proactive alerts"
    },
    {
      icon: Users,
      title: "Crowd Intelligence",
      description: "Avoid crowded areas and find less congested routes using live data analytics"
    },
    {
      icon: Volume2,
      title: "Multi-Modal Alerts",
      description: "Voice, vibration, and visual alerts designed for all abilities and preferences"
    },
    {
      icon: Accessibility,
      title: "Accessibility First",
      description: "Designed specifically for blind and deaf users from the ground up with WCAG compliance"
    },
    {
      icon: Award,
      title: "Safety Scoring",
      description: "Every route receives a comprehensive safety score based on multiple environmental factors"
    },
    {
      icon: Smartphone,
      title: "Intuitive Interface",
      description: "Clean, uncluttered design with high contrast and scalable text for easy navigation"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30">
      {/* Header */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-2 rounded-lg">
                <Navigation className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                  Tryver
                </h1>
                <p className="text-slate-600 text-xs sm:text-sm">Accessible navigation for everyone</p>
              </div>
            </div>
            
            {/* Desktop Navigation */}
            <nav className="hidden md:flex gap-3" aria-label="Main navigation">
              <a href="/login">
                <button 
                  className="px-4 sm:px-6 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50 transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none text-sm sm:text-base"
                  aria-label="Sign in to your account"
                >
                  Sign In
                </button>
              </a>
              <a href="/signup">
                <button 
                  className="px-4 sm:px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium rounded-lg hover:shadow-lg transition-all duration-200 transform hover:-translate-y-0.5 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none text-sm sm:text-base"
                  aria-label="Create new account"
                >
                  Sign Up
                </button>
              </a>
            </nav>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden p-2 rounded-lg hover:bg-slate-100 transition-colors"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {isMobileMenuOpen ? <CloseIcon className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>

          {/* Mobile Menu */}
          {isMobileMenuOpen && (
            <div className="md:hidden mt-4 pb-4 border-t border-slate-200 pt-4">
              <div className="flex flex-col gap-3">
                <a href="/login">
                  <button 
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50 transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    aria-label="Sign in to your account"
                  >
                    Sign In
                  </button>
                </a>
                <a href="/signup">
                  <button 
                    className="w-full px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium rounded-lg hover:shadow-lg transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    aria-label="Create new account"
                  >
                    Sign Up
                  </button>
                </a>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
        <div className={`text-center mb-8 sm:mb-12 lg:mb-16 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-800 px-3 sm:px-4 py-1 sm:py-2 rounded-full text-xs sm:text-sm font-medium mb-6 sm:mb-8" role="status">
            <Accessibility className="h-3 w-3 sm:h-4 sm:w-4" />
            Built for Accessibility • 100% Free Forever
          </div>
          <h1 className="text-2xl sm:text-4xl lg:text-5xl xl:text-6xl font-bold text-slate-900 mb-4 sm:mb-6 leading-tight">
            Navigate The World
            <span className="block bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mt-1 sm:mt-2">
              Safely & Confidently
            </span>
          </h1>
          <p className="text-base sm:text-lg lg:text-xl text-slate-600 max-w-3xl mx-auto leading-relaxed mb-6 sm:mb-8 px-4">
            The first navigation app designed specifically for blind and deaf users with 
            <strong className="font-semibold text-slate-900"> real-time emergency avoidance</strong> and multi-sensory guidance.
          </p>
        </div>

        {/* Navigation Tabs - Enhanced for Accessibility */}
        <div className="flex justify-center mb-8 sm:mb-12 lg:mb-16" role="tablist" aria-label="App features navigation">
          <div className="flex bg-white/80 backdrop-blur-sm rounded-lg sm:rounded-xl p-1 shadow-lg border border-slate-200 max-w-full overflow-x-auto">
            {[
              { id: "features", label: "Features", icon: Award },
              { id: "comparison", label: "Comparison", icon: Shield },
              { id: "demo", label: "How It Works", icon: Navigation }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`${tab.id}-panel`}
                className={`flex items-center gap-1 sm:gap-2 px-3 sm:px-4 lg:px-6 py-2 sm:py-3 rounded-lg font-semibold transition-all duration-300 min-w-[100px] sm:min-w-[140px] justify-center whitespace-nowrap text-xs sm:text-sm ${
                  activeTab === tab.id 
                    ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg" 
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                <tab.icon className="h-3 w-3 sm:h-4 sm:w-4" />
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
          <div className="space-y-8 sm:space-y-12 lg:space-y-16">
            {/* Features Grid */}
            <div className="grid grid-cols-1 gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, index) => (
                <div 
                  key={index}
                  className="group bg-white rounded-lg sm:rounded-xl p-4 sm:p-6 border border-slate-200 hover:border-blue-300 transition-all duration-300 hover:shadow-lg focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2"
                >
                  <div className="bg-blue-100 p-2 sm:p-3 rounded-lg w-fit mb-3 sm:mb-4 group-hover:scale-110 transition-transform duration-300">
                    <feature.icon className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
                  </div>
                  <h3 className="font-bold text-base sm:text-lg text-slate-900 mb-2">{feature.title}</h3>
                  <p className="text-slate-600 leading-relaxed text-xs sm:text-sm">{feature.description}</p>
                </div>
              ))}
            </div>

            {/* Visual Demo */}
            <div className="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 lg:p-8 border border-slate-200 shadow-sm">
              <h2 className="text-xl sm:text-2xl font-bold text-center text-slate-900 mb-6 sm:mb-8">
                Real-Time Protection System
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 items-center">
                <div className="space-y-3 sm:space-y-4">
                  {[
                    {
                      icon: AlertCircle,
                      color: "red",
                      title: "Emergency Detection",
                      description: "Real-time monitoring of fires, crimes, and disasters"
                    },
                    {
                      icon: RefreshCw,
                      color: "blue",
                      title: "Automatic Rerouting",
                      description: "Instantly finds safer alternative routes"
                    },
                    {
                      icon: Bell,
                      color: "green",
                      title: "Multi-Sensory Alerts",
                      description: "Voice, vibration, and visual notifications"
                    }
                  ].map((item, index) => (
                    <div 
                      key={index} 
                      className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-lg sm:rounded-xl bg-slate-50 hover:bg-white transition-colors duration-200 border border-transparent hover:border-slate-200"
                    >
                      <div className={`bg-${item.color}-100 p-2 sm:p-3 rounded-lg flex-shrink-0`}>
                        <item.icon className={`h-4 w-4 sm:h-5 sm:w-5 text-${item.color}-600`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-slate-900 text-sm sm:text-base mb-1">{item.title}</h4>
                        <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg sm:rounded-xl p-4 sm:p-6 text-center border border-blue-200">
                  <Map className="h-12 w-12 sm:h-16 sm:w-16 text-blue-600 mx-auto mb-3 sm:mb-4" />
                  <p className="text-slate-700 font-medium text-sm sm:text-base mb-3 sm:mb-4">Interactive safety map with real-time updates</p>
                  <div className="flex flex-wrap justify-center gap-1 sm:gap-2">
                    <span className="bg-red-500 text-white px-2 sm:px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                      <AlertTriangle className="h-2 w-2 sm:h-3 sm:w-3" /> Danger
                    </span>
                    <span className="bg-amber-500 text-white px-2 sm:px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                      <Users className="h-2 w-2 sm:h-3 sm:w-3" /> Crowded
                    </span>
                    <span className="bg-green-500 text-white px-2 sm:px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                      <Check className="h-2 w-2 sm:h-3 sm:w-3" /> Safe
                    </span>
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
          <div className="space-y-6 sm:space-y-8">
            <div className="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-slate-200 shadow-sm">
              <h2 className="text-xl sm:text-2xl font-bold text-center text-slate-900 mb-6 sm:mb-8">
                Unmatched Accessibility & Safety
              </h2>
              
              {/* Comparison Table */}
              <div className="overflow-x-auto rounded-lg border border-slate-200 -mx-2 sm:mx-0">
                <table className="w-full min-w-[600px] sm:min-w-0" aria-label="Feature comparison table">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 sm:px-6 py-3 text-left font-bold text-slate-900 text-sm">Navigation Feature</th>
                      <th className="px-3 sm:px-6 py-3 text-center font-bold text-blue-700 text-sm">
                        <div className="flex items-center justify-center gap-1 sm:gap-2">
                          <Crown className="h-3 w-3 sm:h-4 sm:w-4" />
                          Tryver
                        </div>
                      </th>
                      <th className="px-3 sm:px-6 py-3 text-center font-bold text-slate-700 text-sm">BlindSquare</th>
                      <th className="px-3 sm:px-6 py-3 text-center font-bold text-slate-700 text-sm">Google Maps</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {competitorComparison.map((row, index) => (
                      <tr key={index} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-3 sm:px-6 py-3 font-semibold text-slate-900 text-xs sm:text-sm">{row.feature}</td>
                        <td className="px-3 sm:px-6 py-3 text-center">
                          <span className="bg-blue-100 text-blue-800 px-2 sm:px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1">
                            <Check className="h-2 w-2 sm:h-3 sm:w-3" /> {row.safepath}
                          </span>
                        </td>
                        <td className="px-3 sm:px-6 py-3 text-center">
                          <span className={`px-2 sm:px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${
                            row.blindsquare === "Not Available" 
                              ? "bg-red-100 text-red-800" 
                              : row.blindsquare === "Partial"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-green-100 text-green-800"
                          }`}>
                            {row.blindsquare === "Not Available" ? <X className="h-2 w-2 sm:h-3 sm:w-3" /> : <Check className="h-2 w-2 sm:h-3 sm:w-3" />}
                            {row.blindsquare}
                          </span>
                        </td>
                        <td className="px-3 sm:px-6 py-3 text-center">
                          <span className={`px-2 sm:px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${
                            row.googleMaps === "Not Available" 
                              ? "bg-red-100 text-red-800" 
                              : row.googleMaps === "Limited" || row.googleMaps === "Alerts Only"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-green-100 text-green-800"
                          }`}>
                            {row.googleMaps === "Not Available" ? <X className="h-2 w-2 sm:h-3 sm:w-3" /> : <Check className="h-2 w-2 sm:h-3 sm:w-3" />}
                            {row.googleMaps}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Key Differentiators */}
              <div className="mt-8 sm:mt-12 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                {[
                  {
                    icon: Target,
                    title: "Specialized Design",
                    description: "Built specifically for accessibility needs from the ground up"
                  },
                  {
                    icon: Star,
                    title: "Completely Free",
                    description: "No premium tiers, subscriptions, or hidden costs"
                  },
                  {
                    icon: Shield,
                    title: "Safety First",
                    description: "Proactive emergency avoidance and real-time protection"
                  }
                ].map((item, index) => (
                  <div 
                    key={index} 
                    className="text-center p-4 sm:p-6 bg-white rounded-lg sm:rounded-xl border border-slate-200 hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
                  >
                    <div className="bg-blue-100 p-2 sm:p-3 rounded-lg w-fit mx-auto mb-3 sm:mb-4">
                      <item.icon className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
                    </div>
                    <h3 className="font-bold text-base sm:text-lg text-slate-900 mb-2 sm:mb-3">{item.title}</h3>
                    <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">{item.description}</p>
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
          <div className="space-y-6 sm:space-y-8">
            <div className="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 lg:p-8 border border-slate-200 shadow-sm">
              <h2 className="text-xl sm:text-2xl font-bold text-center text-slate-900 mb-6 sm:mb-8">
                Simple, Intuitive Navigation
              </h2>
              
              {/* Process Steps */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-8 sm:mb-12">
                {[
                  {
                    step: "1",
                    title: "Set Destination",
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
                    <div className="bg-gradient-to-br from-blue-600 to-indigo-600 w-12 h-12 sm:w-16 sm:h-16 rounded-lg sm:rounded-xl flex items-center justify-center mx-auto mb-3 sm:mb-4 text-sm sm:text-lg font-bold text-white shadow-lg transform group-hover:scale-110 transition-transform duration-300">
                      {step.step}
                    </div>
                    <h3 className="font-bold text-base sm:text-lg text-slate-900 mb-2 sm:mb-3">{step.title}</h3>
                    <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">{step.description}</p>
                  </div>
                ))}
              </div>

              {/* User Scenarios */}
              <div>
                <h3 className="text-lg sm:text-xl font-bold text-center text-slate-900 mb-6 sm:mb-8">
                  Designed For Real Accessibility Needs
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                  {[
                    {
                      icon: Eye,
                      title: "For Blind Users",
                      features: [
                        "Detailed voice descriptions of surroundings",
                        "Haptic feedback for turns and alerts", 
                        "Avoidance of construction and obstacles",
                        "Audio-based safety notifications"
                      ]
                    },
                    {
                      icon: Ear,
                      title: "For Deaf Users",
                      features: [
                        "Strong visual and vibration alerts",
                        "Emergency visual indicators",
                        "Text-based route instructions",
                        "Flashing light warnings for dangers"
                      ]
                    }
                  ].map((scenario, index) => (
                    <div key={index} className="bg-slate-50 p-4 sm:p-6 rounded-lg sm:rounded-xl border border-slate-200 hover:shadow-lg transition-all duration-300">
                      <div className="flex items-center mb-3 sm:mb-4">
                        <div className="bg-blue-100 p-2 rounded-lg mr-3 sm:mr-4">
                          <scenario.icon className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
                        </div>
                        <h4 className="font-bold text-base sm:text-lg text-slate-900">{scenario.title}</h4>
                      </div>
                      <ul className="space-y-2 sm:space-y-3" role="list">
                        {scenario.features.map((feature, featureIndex) => (
                          <li key={featureIndex} className="flex items-start text-xs sm:text-sm">
                            <Check className="h-3 w-3 sm:h-4 sm:w-4 text-green-500 mr-2 sm:mr-3 mt-0.5 flex-shrink-0" />
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
        <div className="text-center mt-12 sm:mt-16 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl sm:rounded-2xl p-6 sm:p-8 lg:p-10 text-white shadow-xl">
          <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold mb-3 sm:mb-4">Ready to Navigate with Confidence?</h2>
          <p className="text-blue-100 text-sm sm:text-base lg:text-lg mb-4 sm:mb-6 max-w-2xl mx-auto leading-relaxed px-4">
            Begin navigating safely with Tryver. Completely free, completely accessible.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-center">
            <a href="/signup">
              <button 
                className="w-full sm:w-auto px-6 sm:px-8 py-3 bg-white text-slate-900 font-bold rounded-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 focus:ring-4 focus:ring-white/50 focus:outline-none flex items-center gap-2 justify-center text-sm sm:text-base"
                aria-label="Get started with Tryver for free"
              >
                <Navigation className="h-4 w-4 sm:h-5 sm:w-5" />
                Get Started Free
              </button>
            </a>
            <a href="/demo">
              <button 
                className="w-full sm:w-auto px-6 sm:px-8 py-3 border border-white/30 text-white font-medium rounded-lg hover:bg-white/10 transition-all duration-200 focus:ring-2 focus:ring-white focus:outline-none text-sm sm:text-base"
                aria-label="Watch product demo"
              >
                Watch Demo
              </button>
            </a>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-white mt-12 sm:mt-16">
        <div className="max-w-7xl mx-auto px-4 py-8 sm:py-12 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-3 sm:mb-4">
              <div className="bg-white p-1 rounded-lg">
                <Navigation className="h-4 w-4 sm:h-6 sm:w-6 text-blue-600" />
              </div>
              <h3 className="text-lg sm:text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                Tryver
              </h3>
            </div>
            <p className="text-slate-400 max-w-md mx-auto leading-relaxed text-xs sm:text-sm px-4">
              Making the world more accessible and safe for everyone, one route at a time.
            </p>
            <div className="mt-6 sm:mt-8 pt-6 sm:pt-8 border-t border-slate-800 text-slate-500 text-xs">
              <p>© 2025 Tryver. All rights reserved. Built with accessibility in mind for the global community.</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
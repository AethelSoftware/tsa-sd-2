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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Tryver</h1>
              <p className="text-gray-600">Accessible navigation for everyone</p>
            </div>
            <div className="space-x-4">
              <button 
                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors"
                aria-label="Sign in to your account"
              >
                Sign In
              </button>
              <button 
                className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition-colors"
                aria-label="Create new account"
              >
                Sign Up
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-extrabold text-gray-900 sm:text-5xl sm:tracking-tight lg:text-6xl">
            Navigate Safely
          </h2>
          <p className="mt-5 max-w-xl mx-auto text-xl text-gray-500">
            The first navigation app designed specifically for blind and deaf users with real-time emergency avoidance
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex justify-center mb-12">
          <div className="flex space-x-1 bg-white rounded-lg p-1 shadow-md">
            <button
              onClick={() => setActiveTab("features")}
              className={`px-6 py-3 rounded-md font-medium transition-colors ${
                activeTab === "features" 
                  ? "bg-blue-500 text-white" 
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Features
            </button>
            <button
              onClick={() => setActiveTab("comparison")}
              className={`px-6 py-3 rounded-md font-medium transition-colors ${
                activeTab === "comparison" 
                  ? "bg-blue-500 text-white" 
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Vs Competitors
            </button>
            <button
              onClick={() => setActiveTab("demo")}
              className={`px-6 py-3 rounded-md font-medium transition-colors ${
                activeTab === "demo" 
                  ? "bg-blue-500 text-white" 
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              How It Works
            </button>
          </div>
        </div>

        {/* Features Tab */}
        {activeTab === "features" && (
          <div className="space-y-12">
            {/* Features Grid */}
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, index) => (
                <div key={index} className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
                  <div className="text-3xl mb-4">{feature.icon}</div>
                  <h4 className="font-semibold text-lg mb-2">{feature.title}</h4>
                  <p className="text-gray-600">{feature.description}</p>
                </div>
              ))}
            </div>

            {/* Visual Demo */}
            <div className="bg-white rounded-2xl shadow-xl p-8">
              <h3 className="text-2xl font-bold text-center mb-8">How Tryver Protects You</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                <div className="space-y-4">
                  <div className="flex items-start space-x-4">
                    <div className="bg-red-100 p-3 rounded-full">⚠️</div>
                    <div>
                      <h4 className="font-semibold">Emergency Detection</h4>
                      <p className="text-gray-600">Real-time monitoring of fires, crimes, and disasters</p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-4">
                    <div className="bg-green-100 p-3 rounded-full">🔄</div>
                    <div>
                      <h4 className="font-semibold">Automatic Rerouting</h4>
                      <p className="text-gray-600">Instantly finds safer alternative routes</p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-4">
                    <div className="bg-blue-100 p-3 rounded-full">🎯</div>
                    <div>
                      <h4 className="font-semibold">Multi-Sensory Alerts</h4>
                      <p className="text-gray-600">Voice, vibration, and visual notifications</p>
                    </div>
                  </div>
                </div>
                <div className="bg-gray-100 rounded-lg p-6 text-center">
                  <div className="text-6xl mb-4">🗺️</div>
                  <p className="text-gray-500">Interactive safety map visualization</p>
                  <div className="mt-4 flex justify-center space-x-2">
                    <span className="bg-red-500 text-white px-2 py-1 rounded text-sm">Danger</span>
                    <span className="bg-yellow-500 text-white px-2 py-1 rounded text-sm">Crowded</span>
                    <span className="bg-green-500 text-white px-2 py-1 rounded text-sm">Safe</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Comparison Tab */}
        {activeTab === "comparison" && (
          <div className="space-y-8">
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h3 className="text-2xl font-bold text-center mb-8">How We Compare to Other Solutions</h3>
              
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-6 py-4 text-left font-semibold text-gray-900">Feature</th>
                      <th className="px-6 py-4 text-center font-semibold text-green-600">Tryver</th>
                      <th className="px-6 py-4 text-center font-semibold text-blue-600">BlindSquare</th>
                      <th className="px-6 py-4 text-center font-semibold text-red-600">Google Maps</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {competitorComparison.map((row, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4 font-medium text-gray-900">{row.feature}</td>
                        <td className="px-6 py-4 text-center">
                          <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">
                            {row.safepath}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
                            {row.blindsquare}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-medium">
                            {row.googleMaps}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Key Differentiators */}
              <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center p-6 bg-green-50 rounded-lg">
                  <div className="text-4xl mb-4">🎯</div>
                  <h4 className="font-bold text-lg mb-2">Specialized</h4>
                  <p className="text-gray-600">Built specifically for accessibility needs</p>
                </div>
                <div className="text-center p-6 bg-green-50 rounded-lg">
                  <div className="text-4xl mb-4">🆓</div>
                  <h4 className="font-bold text-lg mb-2">Completely Free</h4>
                  <p className="text-gray-600">No premium tiers or hidden costs</p>
                </div>
                <div className="text-center p-6 bg-green-50 rounded-lg">
                  <div className="text-4xl mb-4">🛡️</div>
                  <h4 className="font-bold text-lg mb-2">Safety First</h4>
                  <p className="text-gray-600">Proactive emergency avoidance</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Demo Tab */}
        {activeTab === "demo" && (
          <div className="space-y-8">
            <div className="bg-white rounded-2xl shadow-xl p-8">
              <h3 className="text-2xl font-bold text-center mb-8">How Tryver Works</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="text-center">
                  <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">
                    1
                  </div>
                  <h4 className="font-bold text-lg mb-2">Set Your Destination</h4>
                  <p className="text-gray-600">Enter where you want to go using voice, text, or preset locations</p>
                </div>
                <div className="text-center">
                  <div className="bg-green-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">
                    2
                  </div>
                  <h4 className="font-bold text-lg mb-2">Safety Analysis</h4>
                  <p className="text-gray-600">We analyze routes for emergencies, crowds, and accessibility</p>
                </div>
                <div className="text-center">
                  <div className="bg-purple-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">
                    3
                  </div>
                  <h4 className="font-bold text-lg mb-2">Guided Navigation</h4>
                  <p className="text-gray-600">Follow safe routes with multi-sensory guidance</p>
                </div>
              </div>

              {/* User Scenarios */}
              <div className="mt-12">
                <h4 className="text-xl font-bold text-center mb-6">Designed For Real-World Scenarios</h4>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-gray-50 p-6 rounded-lg">
                    <div className="flex items-center mb-4">
                      <div className="text-2xl mr-4">👨‍🦯</div>
                      <h5 className="font-semibold">For Blind Users</h5>
                    </div>
                    <ul className="space-y-2 text-gray-600">
                      <li>• Detailed voice descriptions of surroundings</li>
                      <li>• Haptic feedback for turns and alerts</li>
                      <li>• Avoidance of construction and obstacles</li>
                    </ul>
                  </div>
                  <div className="bg-gray-50 p-6 rounded-lg">
                    <div className="flex items-center mb-4">
                      <div className="text-2xl mr-4">🧏‍♀️</div>
                      <h5 className="font-semibold">For Deaf Users</h5>
                    </div>
                    <ul className="space-y-2 text-gray-600">
                      <li>• Strong visual and vibration alerts</li>
                      <li>• Emergency visual indicators</li>
                      <li>• Text-based route instructions</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Call to Action */}
        <div className="text-center mt-16">
          <h3 className="text-3xl font-bold text-gray-900 mb-4">Ready to Navigate Safely?</h3>
          <p className="text-gray-600 mb-8 max-w-2xl mx-auto">
            Join as the first users of Tryver for their daily navigation needs. 
            Completely free, completely accessible.
          </p>
          <div className="space-x-4">
            <button className="bg-green-500 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-lg text-lg transition-colors">
              Get Started Free
            </button>
            <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg text-lg transition-colors">
              Learn More
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white mt-20 border-t">
        <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
          <div className="text-center text-gray-600">
            <p>Tryver - Making the world more accessible, one route at a time</p>
            <p className="mt-2 text-sm">100% client-side processing • Your privacy protected</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
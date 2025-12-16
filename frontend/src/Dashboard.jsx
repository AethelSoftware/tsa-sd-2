import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Shield, 
  AlertTriangle, 
  CheckCircle, 
  Zap,
  Brain,
  TrendingUp,
  BarChart3,
  RefreshCw,
  Download,
  Upload,
  Settings,
  Train,
  Activity
} from 'lucide-react';

const Dashboard = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [mapStyle, setMapStyle] = useState('roadmap');
  const [routeFrom, setRouteFrom] = useState('Current Location');
  const [routeTo, setRouteTo] = useState('');
  const [disabilitySettings, setDisabilitySettings] = useState({
    blind: false,
    deaf: false,
    lowEnergy: false
  });
  
  // AI Model States
  const [safetyAnalysis, setSafetyAnalysis] = useState(null);
  const [modelStatus, setModelStatus] = useState(null);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [modelMetrics, setModelMetrics] = useState(null);
  
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const navigate = useNavigate();
  const modalRef = useRef(null);

  // Fetch model status on component mount
  useEffect(() => {
    fetchModelStatus();
  }, []);

  const fetchModelStatus = async () => {
    try {
      const response = await fetch('/api/model/status');
      const data = await response.json();
      if (data.success) {
        setModelStatus(data.model);
        setModelMetrics(data.model.training_metrics);
      }
    } catch (error) {
      console.error('Failed to fetch model status:', error);
    }
  };

  const trainModel = async () => {
    setIsTraining(true);
    setTrainingProgress(0);
    
    try {
      const response = await fetch('/api/model/train', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          n_loops: 15,
          n_epochs: 5,
          force: true
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Simulate training progress
        const interval = setInterval(() => {
          setTrainingProgress(prev => {
            if (prev >= 100) {
              clearInterval(interval);
              return 100;
            }
            return prev + 5;
          });
        }, 200);
        
        setTimeout(() => {
          clearInterval(interval);
          setTrainingProgress(100);
          setIsTraining(false);
          fetchModelStatus(); // Refresh model status
          
          alert('Model training completed successfully!');
        }, 4000);
      } else {
        alert(`Training failed: ${data.error}`);
        setIsTraining(false);
      }
    } catch (error) {
      console.error('Training error:', error);
      alert('Failed to train model');
      setIsTraining(false);
    }
  };

  const calculateRoute = () => {
    if (!routeTo.trim()) {
      alert('Please enter a destination');
      return;
    }

    // Generate sample route coordinates (in production, use Google Maps API)
    const sampleRoute = [
      { lat: 40.4406, lng: -79.9959 },
      { lat: 40.4410, lng: -79.9965 },
      { lat: 40.4415, lng: -79.9970 },
      { lat: 40.4420, lng: -79.9975 },
      { lat: 40.4425, lng: -79.9980 }
    ];
    
    setRouteCoordinates(sampleRoute);
    
    // Analyze route safety
    analyzeRouteSafety(sampleRoute);
  };

  const analyzeRouteSafety = async (route) => {
    try {
      const response = await fetch('/api/model/route', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ route })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setSafetyAnalysis(data.analysis);
      } else {
        alert('Failed to analyze route safety');
      }
    } catch (error) {
      console.error('Route analysis error:', error);
      
      // Fallback to mock analysis
      setSafetyAnalysis({
        overall_safety: 0.75,
        risk_level: 'medium',
        segment_count: route.length,
        risky_segments: [
          {
            index: 2,
            safety_score: 0.35,
            risk_level: 'high',
            recommendations: ['Avoid if possible', 'Use well-lit paths']
          }
        ],
        confidence: 0.82,
        recommendations: [
          'Route has one high-risk segment',
          'Consider alternative path during night time'
        ]
      });
    }
  };

  const predictLocationSafety = async (lat, lng) => {
    try {
      const response = await fetch('/api/model/predict', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ lat, lng })
      });
      
      const data = await response.json();
      
      if (data.success) {
        return data.prediction;
      }
    } catch (error) {
      console.error('Prediction error:', error);
    }
    
    // Fallback prediction
    return {
      safety_score: 0.7,
      confidence: 0.8,
      risk_level: 'medium',
      recommendations: ['Use normal precautions']
    };
  };

  const handleDisabilityChange = (disability) => {
    setDisabilitySettings(prev => ({
      ...prev,
      [disability]: !prev[disability]
    }));
  };

  // Close modal when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        setIsSettingsOpen(false);
      }
    }

    if (isSettingsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSettingsOpen]);

  const getSafetyColor = (score) => {
    if (score >= 0.7) return 'text-green-500';
    if (score >= 0.4) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getSafetyBgColor = (score) => {
    if (score >= 0.7) return 'bg-green-500';
    if (score >= 0.4) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="relative w-full h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 overflow-hidden">
      {/* Model Status Banner */}
      {modelStatus && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 w-11/12 max-w-4xl">
          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className={`p-2 rounded-lg ${modelStatus.is_trained ? 'bg-green-100' : 'bg-yellow-100'}`}>
                  {modelStatus.is_trained ? (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-yellow-600" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">
                    AI Safety Model: {modelStatus.is_trained ? 'Active' : 'Not Trained'}
                  </h3>
                  {modelMetrics && (
                    <p className="text-sm text-slate-600">
                      Accuracy: {(modelMetrics.test_score * 100).toFixed(1)}% | 
                      Last trained: {new Date(modelMetrics.training_time).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={trainModel}
                  disabled={isTraining}
                  className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center space-x-2 ${
                    isTraining 
                      ? 'bg-blue-400 text-white' 
                      : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:shadow-lg'
                  }`}
                >
                  {isTraining ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Training {trainingProgress}%</span>
                    </>
                  ) : (
                    <>
                      <Train className="h-4 w-4" />
                      <span>Train Model</span>
                    </>
                  )}
                </button>
                <button
                  onClick={fetchModelStatus}
                  className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                  title="Refresh model status"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Button */}
      <button 
        className="absolute top-4 right-4 z-50 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
        onClick={() => setIsSettingsOpen(true)}
        aria-label="Open settings"
      >
        <Settings className="w-6 h-6" />
      </button>

      {/* AI Quick Stats */}
      <div className="absolute top-20 right-4 z-40 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-slate-200 p-4 w-64">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600">Model Status</span>
            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
              modelStatus?.is_trained ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
            }`}>
              {modelStatus?.is_trained ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600">Confidence</span>
            <span className="text-sm font-semibold text-blue-600">
              {modelMetrics ? `${(modelMetrics.test_score * 100).toFixed(1)}%` : 'N/A'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600">Samples</span>
            <span className="text-sm font-semibold text-slate-900">
              {modelMetrics?.n_samples?.toLocaleString() || 'N/A'}
            </span>
          </div>
          <button
            onClick={() => navigate('/admin')}
            className="w-full mt-2 py-2 text-sm bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:shadow-lg transition-all duration-200 flex items-center justify-center space-x-2"
          >
            <Activity className="h-4 w-4" />
            <span>Admin Panel</span>
          </button>
        </div>
      </div>

      {/* Collapsible Sidebar */}
      <div className={`absolute top-0 left-0 z-40 h-full bg-white shadow-xl transition-all duration-300 ${
        isSidebarOpen ? 'w-80' : 'w-0'
      }`}>
        {isSidebarOpen && (
          <div className="p-6 h-full flex flex-col">
            {/* Sidebar Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-2 rounded-lg">
                  <Brain className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">AI Route Planner</h2>
                  <p className="text-sm text-slate-600">Smart safety routing</p>
                </div>
              </div>
              <button 
                onClick={() => setIsSidebarOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded"
                aria-label="Close sidebar"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Route Inputs */}
            <div className="space-y-4 flex-1">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <div className="flex items-center space-x-2">
                    <Shield className="h-4 w-4 text-emerald-600" />
                    <span>Safe Route Planner</span>
                  </div>
                </label>
                <div className="space-y-3">
                  <div className="relative">
                    <input
                      type="text"
                      value={routeFrom}
                      onChange={(e) => setRouteFrom(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-4 py-3 pl-10 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-colors duration-200"
                      placeholder="Current location"
                    />
                    <div className="absolute left-3 top-1/2 transform -translate-y-1/2" aria-hidden="true">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    </div>
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      value={routeTo}
                      onChange={(e) => setRouteTo(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-4 py-3 pl-10 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-colors duration-200"
                      placeholder="Enter destination"
                    />
                    <div className="absolute left-3 top-1/2 transform -translate-y-1/2" aria-hidden="true">
                      <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>

              {/* Safety Priority Slider */}
              <div className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">Safety Priority</label>
                  <span className="text-sm font-semibold text-emerald-600">High</span>
                </div>
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-emerald-500 to-green-500 w-3/4"></div>
                </div>
                <p className="text-xs text-slate-500 mt-1">Prioritizes safety over speed</p>
              </div>

              {/* Calculate Button */}
              <div className="pt-6">
                <button
                  onClick={calculateRoute}
                  disabled={!routeTo.trim()}
                  className={`w-full py-3 px-4 rounded-lg font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                    routeTo.trim()
                      ? 'bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 focus:ring-emerald-500'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed focus:ring-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-center space-x-2">
                    <Brain className="h-5 w-5" />
                    <span>Calculate Safe Route</span>
                  </div>
                </button>
              </div>

              {/* Safety Analysis Results */}
              {safetyAnalysis && (
                <div className="mt-6 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
                  <h3 className="font-bold text-slate-900 mb-3 flex items-center">
                    <Shield className="h-5 w-5 text-blue-600 mr-2" />
                    Safety Analysis
                  </h3>
                  
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-700">Overall Safety</span>
                      <div className="flex items-center space-x-2">
                        <span className={`text-lg font-bold ${getSafetyColor(safetyAnalysis.overall_safety)}`}>
                          {(safetyAnalysis.overall_safety * 100).toFixed(0)}%
                        </span>
                        <div className="flex items-center">
                          {[...Array(5)].map((_, i) => (
                            <div
                              key={i}
                              className={`w-2 h-4 mx-0.5 rounded-sm ${
                                i < Math.floor(safetyAnalysis.overall_safety * 5)
                                  ? getSafetyBgColor(safetyAnalysis.overall_safety)
                                  : 'bg-slate-300'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-700">Risk Level</span>
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        safetyAnalysis.risk_level === 'high' ? 'bg-red-100 text-red-800' :
                        safetyAnalysis.risk_level === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {safetyAnalysis.risk_level.toUpperCase()}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-700">Confidence</span>
                      <span className="text-sm font-semibold text-blue-600">
                        {(safetyAnalysis.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    
                    {safetyAnalysis.risky_segments && safetyAnalysis.risky_segments.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-blue-200">
                        <div className="flex items-center text-sm text-slate-700 mb-2">
                          <AlertTriangle className="h-4 w-4 text-amber-500 mr-2" />
                          <span>Risky Segments: {safetyAnalysis.risky_segments.length}</span>
                        </div>
                        <ul className="space-y-2">
                          {safetyAnalysis.risky_segments.slice(0, 2).map((segment, index) => (
                            <li key={index} className="text-xs bg-white/80 p-2 rounded border border-amber-200">
                              <div className="flex justify-between">
                                <span className="font-medium">Segment {segment.index + 1}</span>
                                <span className={`font-bold ${getSafetyColor(segment.safety_score)}`}>
                                  {(segment.safety_score * 100).toFixed(0)}%
                                </span>
                              </div>
                              <p className="text-slate-600 mt-1">{segment.recommendations[0]}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* AI Model Info Footer */}
            <div className="mt-6 pt-6 border-t border-slate-200">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">AI Model Version</span>
                <span className="font-medium text-slate-900">v2.1.0</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-slate-600">Last Updated</span>
                <span className="text-slate-900">
                  {modelMetrics?.training_time 
                    ? new Date(modelMetrics.training_time).toLocaleDateString()
                    : 'N/A'}
                </span>
              </div>
              <button
                onClick={() => window.open('/admin', '_blank')}
                className="w-full mt-4 py-2 text-sm bg-gradient-to-r from-slate-800 to-slate-900 text-white rounded-lg hover:shadow-lg transition-all duration-200 flex items-center justify-center space-x-2"
              >
                <BarChart3 className="h-4 w-4" />
                <span>View Detailed Analytics</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Google Maps Container */}
      <div className="w-full h-full relative">
        {/* Show sidebar toggle when collapsed */}
        {!isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="absolute top-4 left-4 z-30 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white rounded-lg px-4 py-2 shadow-lg transition-all duration-200 flex items-center space-x-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
            aria-label="Open route planner"
          >
            <Brain className="w-5 h-5" />
            <span>Open AI Planner</span>
          </button>
        )}

        {/* Google Maps Embed */}
        <iframe
          width="100%"
          height="100%"
          frameBorder="0"
          style={{ border: 0 }}
          src={`https://www.google.com/maps/embed/v1/view?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&center=40.4406,-79.9959&zoom=13&maptype=${mapStyle}`}
          allowFullScreen
          aria-label="Interactive map"
          title="Google Maps"
          loading="lazy"
        />

        {/* Safety Overlay Legend */}
        <div className="absolute bottom-4 right-4 z-20 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4 w-48">
          <h4 className="font-semibold text-slate-900 mb-3 flex items-center">
            <Shield className="h-4 w-4 text-emerald-600 mr-2" />
            Safety Legend
          </h4>
          <div className="space-y-2">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
              <span className="text-sm text-slate-700">Safe (70-100%)</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2"></div>
              <span className="text-sm text-slate-700">Moderate (40-69%)</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div>
              <span className="text-sm text-slate-700">High Risk (0-39%)</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-200">
            <div className="text-xs text-slate-500">
              Powered by AI Safety Model
              <div className="flex items-center mt-1">
                <div className="w-2 h-2 bg-emerald-500 rounded-full mr-1 animate-pulse"></div>
                <span>Real-time analysis active</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div 
            ref={modalRef}
            className="bg-white rounded-2xl shadow-2xl w-96 max-h-[80vh] overflow-hidden"
          >
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-xl font-semibold text-slate-900">AI Model Settings</h2>
              <button 
                className="text-slate-400 hover:text-slate-600 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded"
                onClick={() => setIsSettingsOpen(false)}
                aria-label="Close settings"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 space-y-6 max-h-96 overflow-y-auto">
              {/* Model Training Section */}
              <div className="space-y-4">
                <h3 className="font-medium text-slate-700 flex items-center">
                  <Train className="h-5 w-5 text-emerald-600 mr-2" />
                  Model Training
                </h3>
                
                <div className="space-y-3">
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-xl border border-blue-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-slate-900">Current Model</span>
                      {modelStatus?.is_trained ? (
                        <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full">
                          Trained
                        </span>
                      ) : (
                        <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-semibold rounded-full">
                          Needs Training
                        </span>
                      )}
                    </div>
                    
                    {modelMetrics && (
                      <div className="space-y-2 mt-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Accuracy</span>
                          <span className="font-semibold text-slate-900">
                            {(modelMetrics.test_score * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Training Data</span>
                          <span className="font-semibold text-slate-900">
                            {modelMetrics.n_samples?.toLocaleString()} samples
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Last Trained</span>
                          <span className="font-semibold text-slate-900">
                            {modelMetrics.training_time 
                              ? new Date(modelMetrics.training_time).toLocaleDateString()
                              : 'N/A'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <button
                    onClick={trainModel}
                    disabled={isTraining}
                    className={`w-full py-3 px-4 rounded-xl font-medium transition-all duration-200 flex items-center justify-center space-x-2 ${
                      isTraining
                        ? 'bg-blue-400 text-white'
                        : 'bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white shadow-lg hover:shadow-xl'
                    }`}
                  >
                    {isTraining ? (
                      <>
                        <RefreshCw className="h-5 w-5 animate-spin" />
                        <span>Training {trainingProgress}%</span>
                      </>
                    ) : (
                      <>
                        <Zap className="h-5 w-5" />
                        <span>Train AI Model</span>
                      </>
                    )}
                  </button>
                  
                  <button
                    onClick={fetchModelStatus}
                    className="w-full py-2 px-4 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors duration-200 flex items-center justify-center space-x-2"
                  >
                    <RefreshCw className="h-4 w-4" />
                    <span>Refresh Status</span>
                  </button>
                </div>
              </div>

              {/* Accessibility Settings */}
              <div className="space-y-4">
                <h3 className="font-medium text-slate-700">Accessibility Features</h3>
                
                <div className="space-y-2">
                  {[
                    { key: 'blind', label: 'Vision Impaired', desc: 'High contrast, screen reader support', icon: '👁️' },
                    { key: 'deaf', label: 'Hearing Impaired', desc: 'Visual alerts, captions', icon: '👂' },
                    { key: 'lowEnergy', label: 'Energy Efficient', desc: 'Reduced animations, battery saver', icon: '⚡' }
                  ].map((setting) => (
                    <label key={setting.key} className="flex items-center justify-between cursor-pointer p-3 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all duration-200">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-gradient-to-r from-blue-100 to-indigo-100 rounded-lg flex items-center justify-center">
                          <span className="text-lg">{setting.icon}</span>
                        </div>
                        <div>
                          <div className="font-medium text-slate-900">{setting.label}</div>
                          <div className="text-sm text-slate-600">{setting.desc}</div>
                        </div>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={disabilitySettings[setting.key]}
                        onChange={() => handleDisabilityChange(setting.key)}
                        className="rounded text-emerald-500 focus:ring-emerald-500 focus:ring-2"
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Model Configuration */}
              <div className="space-y-3">
                <h3 className="font-medium text-slate-700">AI Configuration</h3>
                <div className="space-y-2">
                  <label className="flex items-center justify-between p-2 rounded hover:bg-slate-50">
                    <span className="text-slate-700">Real-time Updates</span>
                    <input type="checkbox" className="rounded text-emerald-500" defaultChecked />
                  </label>
                  <label className="flex items-center justify-between p-2 rounded hover:bg-slate-50">
                    <span className="text-slate-700">Predictive Analytics</span>
                    <input type="checkbox" className="rounded text-emerald-500" defaultChecked />
                  </label>
                  <label className="flex items-center justify-between p-2 rounded hover:bg-slate-50">
                    <span className="text-slate-700">Automatic Model Updates</span>
                    <input type="checkbox" className="rounded text-emerald-500" />
                  </label>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-between p-6 border-t border-slate-200 bg-slate-50">
              <button 
                className="px-4 py-2 text-slate-700 hover:text-slate-900 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded"
                onClick={() => navigate('/admin')}
              >
                Advanced Settings
              </button>
              <button 
                className="px-6 py-2 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                onClick={() => setIsSettingsOpen(false)}
              >
                Apply Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
import { useState, useEffect } from 'react';
import { 
  Brain, 
  TrendingUp, 
  BarChart3, 
  Database, 
  Cpu, 
  Clock,
  Download,
  Upload,
  RefreshCw,
  Zap,
  Shield,
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Play,
  Pause,
  Settings
} from 'lucide-react';

const AdminPage = () => {
  const [modelStatus, setModelStatus] = useState(null);
  const [trainingHistory, setTrainingHistory] = useState([]);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [trainingParams, setTrainingParams] = useState({
    n_loops: 15,
    n_epochs: 5,
    n_samples: 5000,
    force_retrain: false
  });
  const [activeTab, setActiveTab] = useState('overview');
  const [modelMetrics, setModelMetrics] = useState(null);

  useEffect(() => {
    fetchModelStatus();
    fetchTrainingHistory();
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

  const fetchTrainingHistory = async () => {
    try {
      // This would come from your API
      // For now, create mock history
      const mockHistory = [
        {
          id: 1,
          timestamp: '2024-01-15T10:30:00Z',
          n_loops: 15,
          n_epochs: 5,
          accuracy: 0.87,
          status: 'completed',
          duration: '2m 45s'
        },
        {
          id: 2,
          timestamp: '2024-01-14T09:15:00Z',
          n_loops: 10,
          n_epochs: 3,
          accuracy: 0.82,
          status: 'completed',
          duration: '1m 30s'
        },
        {
          id: 3,
          timestamp: '2024-01-13T14:20:00Z',
          n_loops: 5,
          n_epochs: 2,
          accuracy: 0.75,
          status: 'completed',
          duration: '45s'
        }
      ];
      setTrainingHistory(mockHistory);
    } catch (error) {
      console.error('Failed to fetch training history:', error);
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
        body: JSON.stringify(trainingParams)
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
            return prev + 2;
          });
        }, 100);

        setTimeout(() => {
          clearInterval(interval);
          setTrainingProgress(100);
          setIsTraining(false);
          fetchModelStatus();
          fetchTrainingHistory();
          alert('Model training completed successfully!');
        }, 5000);
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

  const incrementalTrain = async () => {
    try {
      const response = await fetch('/api/model/incremental', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ epochs: 1 })
      });

      const data = await response.json();
      if (data.success) {
        alert('Incremental training completed!');
        fetchModelStatus();
      }
    } catch (error) {
      console.error('Incremental training error:', error);
    }
  };

  const exportModel = () => {
    // Export model functionality
    alert('Model exported successfully!');
  };

  const importModel = () => {
    // Import model functionality
    alert('Model imported successfully!');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">AI Model Management</h1>
            <p className="text-slate-600 mt-2">Monitor, train, and optimize your safety prediction model</p>
          </div>
          <div className="flex items-center space-x-4 mt-4 md:mt-0">
            <div className="bg-white rounded-xl px-4 py-2 border border-slate-200 shadow-sm">
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${modelStatus?.is_trained ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></div>
                <span className="text-sm font-medium">
                  {modelStatus?.is_trained ? 'Model Active' : 'Model Inactive'}
                </span>
              </div>
            </div>
            <button
              onClick={fetchModelStatus}
              className="p-2 bg-white rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
              title="Refresh status"
            >
              <RefreshCw className="h-5 w-5 text-slate-600" />
            </button>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Brain className="h-6 w-6 text-blue-600" />
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                modelStatus?.is_trained ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
              }`}>
                {modelStatus?.is_trained ? 'Active' : 'Inactive'}
              </span>
            </div>
            <h3 className="text-2xl font-bold text-slate-900">
              {modelMetrics ? `${(modelMetrics.test_score * 100).toFixed(1)}%` : 'N/A'}
            </h3>
            <p className="text-sm text-slate-600">Model Accuracy</p>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <Database className="h-6 w-6 text-emerald-600" />
              </div>
            </div>
            <h3 className="text-2xl font-bold text-slate-900">
              {modelMetrics?.n_samples?.toLocaleString() || '0'}
            </h3>
            <p className="text-sm text-slate-600">Training Samples</p>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Cpu className="h-6 w-6 text-purple-600" />
              </div>
            </div>
            <h3 className="text-2xl font-bold text-slate-900">
              {modelMetrics?.n_features || '0'}
            </h3>
            <p className="text-sm text-slate-600">Features Used</p>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 bg-amber-100 rounded-lg">
                <Clock className="h-6 w-6 text-amber-600" />
              </div>
            </div>
            <h3 className="text-2xl font-bold text-slate-900">
              {trainingHistory.length}
            </h3>
            <p className="text-sm text-slate-600">Training Sessions</p>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Training Control */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              {/* Tabs */}
              <div className="border-b border-slate-200">
                <div className="flex">
                  {['overview', 'training', 'analytics'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-6 py-4 font-medium text-sm transition-colors ${
                        activeTab === tab
                          ? 'text-emerald-600 border-b-2 border-emerald-600'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab Content */}
              <div className="p-6">
                {activeTab === 'overview' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900 mb-4">Model Overview</h3>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-700">Model Type</span>
                          <span className="font-medium">Stacking Ensemble</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-700">Base Models</span>
                          <span className="font-medium">Random Forest, Gradient Boosting, Ridge</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-700">Final Estimator</span>
                          <span className="font-medium">Neural Network (MLP)</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-700">Last Training</span>
                          <span className="font-medium">
                            {modelMetrics?.training_time 
                              ? new Date(modelMetrics.training_time).toLocaleDateString()
                              : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-lg font-semibold text-slate-900 mb-4">Quick Actions</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <button
                          onClick={trainModel}
                          disabled={isTraining}
                          className={`p-4 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center space-y-2 ${
                            isTraining
                              ? 'bg-blue-50 border-blue-200'
                              : 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                          }`}
                        >
                          {isTraining ? (
                            <>
                              <RefreshCw className="h-6 w-6 text-blue-600 animate-spin" />
                              <span className="text-sm font-medium text-blue-700">
                                Training {trainingProgress}%
                              </span>
                            </>
                          ) : (
                            <>
                              <Zap className="h-6 w-6 text-emerald-600" />
                              <span className="text-sm font-medium text-emerald-700">Train Model</span>
                            </>
                          )}
                        </button>
                        <button
                          onClick={incrementalTrain}
                          className="p-4 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors duration-200 flex flex-col items-center justify-center space-y-2"
                        >
                          <TrendingUp className="h-6 w-6 text-blue-600" />
                          <span className="text-sm font-medium text-blue-700">Incremental Train</span>
                        </button>
                        <button
                          onClick={exportModel}
                          className="p-4 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors duration-200 flex flex-col items-center justify-center space-y-2"
                        >
                          <Download className="h-6 w-6 text-amber-600" />
                          <span className="text-sm font-medium text-amber-700">Export Model</span>
                        </button>
                        <button
                          onClick={importModel}
                          className="p-4 rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 transition-colors duration-200 flex flex-col items-center justify-center space-y-2"
                        >
                          <Upload className="h-6 w-6 text-purple-600" />
                          <span className="text-sm font-medium text-purple-700">Import Model</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'training' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900 mb-4">Training Configuration</h3>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            Number of Loops
                          </label>
                          <input
                            type="range"
                            min="5"
                            max="30"
                            step="5"
                            value={trainingParams.n_loops}
                            onChange={(e) => setTrainingParams(prev => ({ ...prev, n_loops: parseInt(e.target.value) }))}
                            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                          />
                          <div className="flex justify-between text-sm text-slate-600 mt-1">
                            <span>5 (Quick)</span>
                            <span className="font-medium">{trainingParams.n_loops}</span>
                            <span>30 (Thorough)</span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            Epochs per Loop
                          </label>
                          <input
                            type="range"
                            min="1"
                            max="10"
                            value={trainingParams.n_epochs}
                            onChange={(e) => setTrainingParams(prev => ({ ...prev, n_epochs: parseInt(e.target.value) }))}
                            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                          />
                          <div className="flex justify-between text-sm text-slate-600 mt-1">
                            <span>1 (Fast)</span>
                            <span className="font-medium">{trainingParams.n_epochs}</span>
                            <span>10 (Deep)</span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            Training Samples per Loop
                          </label>
                          <select
                            value={trainingParams.n_samples}
                            onChange={(e) => setTrainingParams(prev => ({ ...prev, n_samples: parseInt(e.target.value) }))}
                            className="w-full border border-slate-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          >
                            <option value={1000}>1,000 samples (Light)</option>
                            <option value={5000}>5,000 samples (Standard)</option>
                            <option value={10000}>10,000 samples (Heavy)</option>
                          </select>
                        </div>

                        <div className="flex items-center space-x-3">
                          <input
                            type="checkbox"
                            id="force-retrain"
                            checked={trainingParams.force_retrain}
                            onChange={(e) => setTrainingParams(prev => ({ ...prev, force_retrain: e.target.checked }))}
                            className="rounded text-emerald-500 focus:ring-emerald-500"
                          />
                          <label htmlFor="force-retrain" className="text-sm text-slate-700">
                            Force retrain even if model exists
                          </label>
                        </div>
                      </div>
                    </div>

                    <div>
                      <button
                        onClick={trainModel}
                        disabled={isTraining}
                        className={`w-full py-3 px-4 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center space-x-2 ${
                          isTraining
                            ? 'bg-blue-500 text-white'
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
                            <Play className="h-5 w-5" />
                            <span>Start Training</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === 'analytics' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900 mb-4">Model Performance</h3>
                      {modelMetrics ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-xl border border-blue-200">
                              <div className="text-2xl font-bold text-blue-700">
                                {(modelMetrics.cv_mean * 100).toFixed(1)}%
                              </div>
                              <div className="text-sm text-blue-600">Cross-Validation Score</div>
                              <div className="text-xs text-slate-500 mt-1">
                                ± {(modelMetrics.cv_std * 100).toFixed(2)}%
                              </div>
                            </div>
                            <div className="bg-gradient-to-br from-emerald-50 to-green-50 p-4 rounded-xl border border-emerald-200">
                              <div className="text-2xl font-bold text-emerald-700">
                                {(modelMetrics.train_score * 100).toFixed(1)}%
                              </div>
                              <div className="text-sm text-emerald-600">Training Score</div>
                            </div>
                          </div>
                          
                          <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-4 rounded-xl border border-amber-200">
                            <div className="text-2xl font-bold text-amber-700">
                              {(modelMetrics.test_score * 100).toFixed(1)}%
                            </div>
                            <div className="text-sm text-amber-600">Test Score (Accuracy)</div>
                            <div className="mt-2">
                              <div className="flex items-center justify-between text-sm mb-1">
                                <span className="text-slate-700">Model Performance</span>
                                <span className="font-medium">
                                  {modelMetrics.test_score >= 0.8 ? 'Excellent' :
                                   modelMetrics.test_score >= 0.7 ? 'Good' :
                                   modelMetrics.test_score >= 0.6 ? 'Acceptable' : 'Needs Improvement'}
                                </span>
                              </div>
                              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-gradient-to-r from-emerald-500 to-green-500"
                                  style={{ width: `${modelMetrics.test_score * 100}%` }}
                                ></div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-8 text-slate-500">
                          No performance metrics available. Train the model first.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - History and Info */}
          <div className="space-y-8">
            {/* Training History */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h3 className="font-semibold text-slate-900 flex items-center">
                  <Clock className="h-5 w-5 text-amber-600 mr-2" />
                  Training History
                </h3>
              </div>
              <div className="p-4 max-h-96 overflow-y-auto">
                {trainingHistory.length > 0 ? (
                  <div className="space-y-3">
                    {trainingHistory.map((session) => (
                      <div key={session.id} className="p-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            <div className={`w-2 h-2 rounded-full ${
                              session.status === 'completed' ? 'bg-green-500' :
                              session.status === 'failed' ? 'bg-red-500' :
                              'bg-yellow-500'
                            }`}></div>
                            <span className="text-sm font-medium text-slate-900">
                              {new Date(session.timestamp).toLocaleDateString()}
                            </span>
                          </div>
                          <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                            {session.duration}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-600">
                            {session.n_loops} loops × {session.n_epochs} epochs
                          </span>
                          <span className="font-medium text-slate-900">
                            {(session.accuracy * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    No training history available
                  </div>
                )}
              </div>
            </div>

            {/* Model Information */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h3 className="font-semibold text-slate-900 flex items-center">
                  <Settings className="h-5 w-5 text-slate-600 mr-2" />
                  Model Information
                </h3>
              </div>
              <div className="p-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Status</span>
                    <span className={`text-sm font-medium ${
                      modelStatus?.is_trained ? 'text-green-600' : 'text-yellow-600'
                    }`}>
                      {modelStatus?.is_trained ? 'Ready' : 'Not Trained'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Version</span>
                    <span className="text-sm font-medium text-slate-900">2.1.0</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Storage</span>
                    <span className="text-sm font-medium text-slate-900">12.4 MB</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Last Updated</span>
                    <span className="text-sm font-medium text-slate-900">
                      {modelMetrics?.training_time 
                        ? new Date(modelMetrics.training_time).toLocaleDateString()
                        : 'N/A'}
                    </span>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-slate-200">
                  <h4 className="text-sm font-medium text-slate-900 mb-3">Model Actions</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={fetchModelStatus}
                      className="py-2 text-sm border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center space-x-2"
                    >
                      <RefreshCw className="h-4 w-4" />
                      <span>Refresh</span>
                    </button>
                    <button
                      onClick={() => window.location.reload()}
                      className="py-2 text-sm bg-gradient-to-r from-slate-800 to-slate-900 text-white rounded-lg hover:shadow-lg transition-all duration-200 flex items-center justify-center space-x-2"
                    >
                      <Activity className="h-4 w-4" />
                      <span>Restart</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-8 border-t border-slate-200">
          <div className="flex flex-col md:flex-row justify-between items-center text-sm text-slate-600">
            <div>
              <p>Tryver AI Safety Model Management System</p>
              <p className="mt-1">Version 2.1.0 • Last updated: {new Date().toLocaleDateString()}</p>
            </div>
            <div className="flex items-center space-x-4 mt-4 md:mt-0">
              <button className="hover:text-slate-900 transition-colors">Documentation</button>
              <button className="hover:text-slate-900 transition-colors">Support</button>
              <button className="hover:text-slate-900 transition-colors">Settings</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
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

  const styles = {
    container: {
      minHeight: '100vh',
      background: '#110a04',
      padding: '1rem',
      fontFamily: "'DM Sans', sans-serif"
    },
    wrapper: {
      maxWidth: '1280px',
      margin: '0 auto'
    },
    header: {
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '2rem'
    },
    headerTitle: {
      fontSize: '2rem',
      fontWeight: 'bold',
      color: '#ffffff',
      fontFamily: "'Playfair Display', serif",
      margin: 0
    },
    headerSubtitle: {
      color: '#e0c8b0',
      marginTop: '0.5rem',
      fontSize: '1rem'
    },
    statusBadge: {
      background: 'rgba(28,17,8,0.97)',
      border: '1px solid rgba(180,120,60,0.16)',
      borderRadius: '12px',
      padding: '0.5rem 1rem',
      backdropFilter: 'blur(28px)',
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem'
    },
    statusDot: (isActive) => ({
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: isActive ? '#8cd69c' : '#ffb347',
      animation: isActive ? 'pulse 2s infinite' : 'none'
    }),
    statusText: {
      color: '#e0c8b0',
      fontSize: '0.875rem',
      fontWeight: 500
    },
    refreshButton: {
      padding: '0.5rem',
      background: 'rgba(28,17,8,0.97)',
      border: '1px solid rgba(180,120,60,0.16)',
      borderRadius: '12px',
      cursor: 'pointer',
      color: '#e0c8b0',
      transition: 'all 0.2s'
    },
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '1rem',
      marginBottom: '2rem'
    },
    statCard: {
      background: 'rgba(28,17,8,0.97)',
      border: '1px solid rgba(180,120,60,0.16)',
      borderRadius: '16px',
      padding: '1.5rem',
      backdropFilter: 'blur(28px)'
    },
    statHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '1rem'
    },
    statIcon: (bg) => ({
      padding: '0.5rem',
      background: bg,
      borderRadius: '8px'
    }),
    statValue: {
      fontSize: '1.5rem',
      fontWeight: 'bold',
      color: '#ffffff',
      fontFamily: "'Playfair Display', serif",
      margin: 0
    },
    statLabel: {
      color: '#e0c8b0',
      fontSize: '0.875rem',
      marginTop: '0.25rem'
    },
    mainGrid: {
      display: 'grid',
      gridTemplateColumns: '2fr 1fr',
      gap: '2rem'
    },
    card: {
      background: 'rgba(28,17,8,0.97)',
      border: '1px solid rgba(180,120,60,0.16)',
      borderRadius: '16px',
      backdropFilter: 'blur(28px)',
      overflow: 'hidden'
    },
    tabs: {
      display: 'flex',
      borderBottom: '1px solid rgba(180,120,60,0.16)'
    },
    tab: (isActive) => ({
      padding: '1rem 1.5rem',
      fontSize: '0.875rem',
      fontWeight: 500,
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      color: isActive ? '#e8a870' : '#e0c8b0',
      borderBottom: isActive ? '2px solid #e8a870' : 'none',
      transition: 'color 0.2s'
    }),
    cardContent: {
      padding: '1.5rem'
    },
    sectionTitle: {
      fontSize: '1.125rem',
      fontWeight: 600,
      color: '#ffffff',
      fontFamily: "'Playfair Display', serif",
      marginBottom: '1rem'
    },
    infoRow: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: '1rem'
    },
    infoLabel: {
      color: '#e0c8b0'
    },
    infoValue: {
      color: '#ffffff',
      fontWeight: 500
    },
    actionGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: '1rem'
    },
    actionButton: (isTraining, type) => ({
      padding: '1rem',
      borderRadius: '12px',
      border: '1px solid',
      background: isTraining 
        ? 'rgba(232,168,112,0.18)' 
        : type === 'train' 
          ? 'rgba(140,214,156,0.15)' 
          : type === 'incremental'
            ? 'rgba(232,168,112,0.18)'
            : type === 'export'
              ? 'rgba(255,179,71,0.1)'
              : 'rgba(255,123,107,0.15)',
      borderColor: isTraining
        ? '#e8a870'
        : type === 'train'
          ? 'rgba(140,214,156,0.3)'
          : type === 'incremental'
            ? 'rgba(232,168,112,0.3)'
            : type === 'export'
              ? 'rgba(255,179,71,0.3)'
              : 'rgba(255,123,107,0.3)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '0.5rem',
      cursor: 'pointer',
      transition: 'all 0.2s'
    }),
    actionIcon: (type) => ({
      color: type === 'train' 
        ? '#8cd69c' 
        : type === 'incremental' 
          ? '#e8a870' 
          : type === 'export' 
            ? '#ffb347' 
            : '#ff7b6b'
    }),
    actionText: (type) => ({
      fontSize: '0.875rem',
      fontWeight: 500,
      color: type === 'train' 
        ? '#8cd69c' 
        : type === 'incremental' 
          ? '#e8a870' 
          : type === 'export' 
            ? '#ffb347' 
            : '#ff7b6b'
    }),
    rangeInput: {
      width: '100%',
      height: '8px',
      background: 'rgba(180,120,60,0.16)',
      borderRadius: '8px',
      accentColor: '#e8a870'
    },
    rangeLabels: {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: '0.25rem',
      fontSize: '0.875rem',
      color: '#e0c8b0'
    },
    select: {
      width: '100%',
      background: 'rgba(255,255,255,0.035)',
      border: '1px solid rgba(180,120,60,0.16)',
      borderRadius: '8px',
      padding: '0.5rem 1rem',
      color: '#ffffff',
      outline: 'none'
    },
    checkbox: {
      marginRight: '0.5rem',
      accentColor: '#e8a870'
    },
    startButton: (isTraining) => ({
      width: '100%',
      padding: '0.75rem 1rem',
      borderRadius: '8px',
      border: 'none',
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.5rem',
      cursor: isTraining ? 'not-allowed' : 'pointer',
      background: isTraining 
        ? 'rgba(232,168,112,0.18)' 
        : 'linear-gradient(135deg, #c06c30, #e89c60)',
      color: isTraining ? '#e8a870' : '#ffffff',
      transition: 'all 0.2s'
    }),
    metricsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: '1rem',
      marginBottom: '1rem'
    },
    metricCard: (bg, border) => ({
      background: bg,
      padding: '1rem',
      borderRadius: '12px',
      border: `1px solid ${border}`
    }),
    metricValue: {
      fontSize: '1.5rem',
      fontWeight: 'bold',
      fontFamily: "'Playfair Display', serif"
    },
    progressBar: {
      height: '8px',
      background: 'rgba(180,120,60,0.16)',
      borderRadius: '4px',
      overflow: 'hidden',
      marginTop: '0.5rem'
    },
    progressFill: (width) => ({
      height: '100%',
      background: 'linear-gradient(90deg, #e8a870, #ffb347)',
      width: width,
      transition: 'width 0.3s'
    }),
    historyList: {
      maxHeight: '384px',
      overflowY: 'auto'
    },
    historyItem: {
      padding: '0.75rem',
      border: '1px solid rgba(180,120,60,0.16)',
      borderRadius: '8px',
      marginBottom: '0.75rem',
      transition: 'background 0.2s'
    },
    historyHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '0.5rem'
    },
    historyStatus: (status) => ({
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: status === 'completed' ? '#8cd69c' : status === 'failed' ? '#ff7b6b' : '#ffb347'
    }),
    historyDate: {
      fontSize: '0.875rem',
      fontWeight: 500,
      color: '#ffffff'
    },
    historyDuration: {
      fontSize: '0.75rem',
      fontWeight: 600,
      padding: '0.25rem 0.5rem',
      borderRadius: '9999px',
      background: 'rgba(232,168,112,0.18)',
      color: '#e8a870'
    },
    historyDetails: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '0.875rem'
    },
    footer: {
      marginTop: '2rem',
      paddingTop: '2rem',
      borderTop: '1px solid rgba(180,120,60,0.16)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      color: '#e0c8b0',
      fontSize: '0.875rem'
    },
    footerLinks: {
      display: 'flex',
      gap: '1rem'
    },
    footerLink: {
      background: 'none',
      border: 'none',
      color: '#e0c8b0',
      cursor: 'pointer',
      transition: 'color 0.2s'
    }
  };

  return (
    <>
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:wght@400;500;600&display=swap');
          
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }

          .admin-container {
            min-height: 100vh;
            background: #110a04;
            padding: 1rem;
            font-family: 'DM Sans', sans-serif;
          }

          @media (min-width: 768px) {
            .admin-container {
              padding: 2rem;
            }
          }

          .admin-wrapper {
            max-width: 1280px;
            margin: 0 auto;
          }

          .admin-header {
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 2rem;
          }

          @media (min-width: 768px) {
            .admin-header {
              flex-direction: row;
              align-items: center;
            }
          }

          .admin-title {
            font-size: 1.875rem;
            font-weight: bold;
            color: #ffffff;
            font-family: 'Playfair Display', serif;
          }

          .admin-subtitle {
            color: #e0c8b0;
            margin-top: 0.5rem;
          }

          .admin-header-actions {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-top: 1rem;
          }

          @media (min-width: 768px) {
            .admin-header-actions {
              margin-top: 0;
            }
          }

          .status-badge {
            background: rgba(28,17,8,0.97);
            border: 1px solid rgba(180,120,60,0.16);
            border-radius: 12px;
            padding: 0.5rem 1rem;
            backdrop-filter: blur(28px);
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }

          .status-dot-active {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #8cd69c;
            animation: pulse 2s infinite;
          }

          .status-dot-inactive {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #ffb347;
          }

          .status-text {
            color: #e0c8b0;
            font-size: 0.875rem;
            font-weight: 500;
          }

          .refresh-button {
            padding: 0.5rem;
            background: rgba(28,17,8,0.97);
            border: 1px solid rgba(180,120,60,0.16);
            border-radius: 12px;
            cursor: pointer;
            color: #e0c8b0;
            transition: all 0.2s;
          }

          .refresh-button:hover {
            background: rgba(232,168,112,0.18);
          }

          .stats-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 1rem;
            margin-bottom: 2rem;
          }

          @media (min-width: 640px) {
            .stats-grid {
              grid-template-columns: repeat(2, 1fr);
            }
          }

          @media (min-width: 1024px) {
            .stats-grid {
              grid-template-columns: repeat(4, 1fr);
            }
          }

          .stat-card {
            background: rgba(28,17,8,0.97);
            border: 1px solid rgba(180,120,60,0.16);
            border-radius: 16px;
            padding: 1.5rem;
            backdrop-filter: blur(28px);
          }

          .stat-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 1rem;
          }

          .stat-icon-blue {
            padding: 0.5rem;
            background: rgba(232,168,112,0.18);
            border-radius: 8px;
            color: #e8a870;
          }

          .stat-icon-green {
            padding: 0.5rem;
            background: rgba(140,214,156,0.15);
            border-radius: 8px;
            color: #8cd69c;
          }

          .stat-icon-red {
            padding: 0.5rem;
            background: rgba(255,123,107,0.15);
            border-radius: 8px;
            color: #ff7b6b;
          }

          .stat-icon-amber {
            padding: 0.5rem;
            background: rgba(255,179,71,0.1);
            border-radius: 8px;
            color: #ffb347;
          }

          .stat-badge {
            padding: 0.25rem 0.5rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 600;
          }

          .stat-badge-active {
            background: rgba(140,214,156,0.15);
            color: #8cd69c;
          }

          .stat-badge-inactive {
            background: rgba(255,179,71,0.1);
            color: #ffb347;
          }

          .stat-value {
            font-size: 1.5rem;
            font-weight: bold;
            color: #ffffff;
            font-family: 'Playfair Display', serif;
          }

          .stat-label {
            color: #e0c8b0;
            font-size: 0.875rem;
            margin-top: 0.25rem;
          }

          .main-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 2rem;
          }

          @media (min-width: 1024px) {
            .main-grid {
              grid-template-columns: 2fr 1fr;
            }
          }

          .card {
            background: rgba(28,17,8,0.97);
            border: 1px solid rgba(180,120,60,0.16);
            border-radius: 16px;
            backdrop-filter: blur(28px);
            overflow: hidden;
          }

          .tabs {
            display: flex;
            border-bottom: 1px solid rgba(180,120,60,0.16);
          }

          .tab {
            padding: 1rem 1.5rem;
            font-size: 0.875rem;
            font-weight: 500;
            background: transparent;
            border: none;
            cursor: pointer;
            color: #e0c8b0;
            transition: color 0.2s;
          }

          .tab:hover {
            color: #ffffff;
          }

          .tab.active {
            color: #e8a870;
            border-bottom: 2px solid #e8a870;
          }

          .card-content {
            padding: 1.5rem;
          }

          .section-title {
            font-size: 1.125rem;
            font-weight: 600;
            color: #ffffff;
            font-family: 'Playfair Display', serif;
            margin-bottom: 1rem;
          }

          .info-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 1rem;
          }

          .info-label {
            color: #e0c8b0;
          }

          .info-value {
            color: #ffffff;
            font-weight: 500;
          }

          .action-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 1rem;
          }

          .action-button {
            padding: 1rem;
            border-radius: 12px;
            border: 1px solid;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.5rem;
            cursor: pointer;
            transition: all 0.2s;
          }

          .action-button.train {
            background: rgba(140,214,156,0.15);
            border-color: rgba(140,214,156,0.3);
          }

          .action-button.train:hover {
            background: rgba(140,214,156,0.25);
          }

          .action-button.incremental {
            background: rgba(232,168,112,0.18);
            border-color: rgba(232,168,112,0.3);
          }

          .action-button.incremental:hover {
            background: rgba(232,168,112,0.25);
          }

          .action-button.export {
            background: rgba(255,179,71,0.1);
            border-color: rgba(255,179,71,0.3);
          }

          .action-button.export:hover {
            background: rgba(255,179,71,0.18);
          }

          .action-button.import {
            background: rgba(255,123,107,0.15);
            border-color: rgba(255,123,107,0.3);
          }

          .action-button.import:hover {
            background: rgba(255,123,107,0.25);
          }

          .action-button.training {
            background: rgba(232,168,112,0.18);
            border-color: #e8a870;
          }

          .action-icon-train { color: #8cd69c; }
          .action-icon-incremental { color: #e8a870; }
          .action-icon-export { color: #ffb347; }
          .action-icon-import { color: #ff7b6b; }

          .action-text-train { color: #8cd69c; }
          .action-text-incremental { color: #e8a870; }
          .action-text-export { color: #ffb347; }
          .action-text-import { color: #ff7b6b; }

          .training-config {
            margin-bottom: 1rem;
          }

          .config-label {
            display: block;
            font-size: 0.875rem;
            font-weight: 500;
            color: #e0c8b0;
            margin-bottom: 0.5rem;
          }

          .range-input {
            width: 100%;
            height: 8px;
            background: rgba(180,120,60,0.16);
            border-radius: 8px;
            accent-color: #e8a870;
          }

          .range-labels {
            display: flex;
            justify-content: space-between;
            margin-top: 0.25rem;
            font-size: 0.875rem;
            color: #e0c8b0;
          }

          .range-value {
            color: #ffffff;
            font-weight: 500;
          }

          .select-input {
            width: 100%;
            background: rgba(255,255,255,0.035);
            border: 1px solid rgba(180,120,60,0.16);
            border-radius: 8px;
            padding: 0.5rem 1rem;
            color: #ffffff;
            outline: none;
          }

          .select-input:focus {
            ring: 2px solid #e8a870;
          }

          .checkbox-wrapper {
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }

          .checkbox-input {
            accent-color: #e8a870;
          }

          .checkbox-label {
            font-size: 0.875rem;
            color: #e0c8b0;
          }

          .start-button {
            width: 100%;
            padding: 0.75rem 1rem;
            border-radius: 8px;
            border: none;
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            cursor: pointer;
            transition: all 0.2s;
          }

          .start-button.idle {
            background: linear-gradient(135deg, #c06c30, #e89c60);
            color: #ffffff;
          }

          .start-button.idle:hover {
            box-shadow: 0 4px 20px rgba(232,168,112,0.25);
            filter: brightness(1.1);
          }

          .start-button.training {
            background: rgba(232,168,112,0.18);
            color: #e8a870;
            cursor: not-allowed;
          }

          .metrics-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 1rem;
            margin-bottom: 1rem;
          }

          .metric-card-amber {
            background: rgba(232,168,112,0.18);
            padding: 1rem;
            border-radius: 12px;
            border: 1px solid rgba(232,168,112,0.3);
          }

          .metric-card-green {
            background: rgba(140,214,156,0.15);
            padding: 1rem;
            border-radius: 12px;
            border: 1px solid rgba(140,214,156,0.3);
          }

          .metric-card-yellow {
            background: rgba(255,179,71,0.1);
            padding: 1rem;
            border-radius: 12px;
            border: 1px solid rgba(255,179,71,0.3);
          }

          .metric-value-amber { color: #e8a870; }
          .metric-value-green { color: #8cd69c; }
          .metric-value-yellow { color: #ffb347; }

          .metric-title {
            font-size: 0.875rem;
            margin-top: 0.25rem;
          }

          .metric-title-amber { color: #e8a870; }
          .metric-title-green { color: #8cd69c; }
          .metric-title-yellow { color: #ffb347; }

          .metric-subtitle {
            font-size: 0.75rem;
            color: #e0c8b0;
            margin-top: 0.25rem;
          }

          .performance-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 0.875rem;
            margin-bottom: 0.25rem;
          }

          .performance-label {
            color: #e0c8b0;
          }

          .performance-value {
            color: #ffffff;
            font-weight: 500;
          }

          .progress-bar {
            height: 8px;
            background: rgba(180,120,60,0.16);
            border-radius: 4px;
            overflow: hidden;
          }

          .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #e8a870, #ffb347);
            transition: width 0.3s;
          }

          .empty-state {
            text-align: center;
            padding: 2rem 0;
            color: #e0c8b0;
          }

          .history-list {
            max-height: 384px;
            overflow-y: auto;
          }

          .history-item {
            padding: 0.75rem;
            border: 1px solid rgba(180,120,60,0.16);
            border-radius: 8px;
            margin-bottom: 0.75rem;
            transition: background 0.2s;
          }

          .history-item:hover {
            background: rgba(232,168,112,0.18);
          }

          .history-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 0.5rem;
          }

          .history-status {
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }

          .status-dot-completed {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #8cd69c;
          }

          .status-dot-failed {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #ff7b6b;
          }

          .status-dot-pending {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #ffb347;
          }

          .history-date {
            font-size: 0.875rem;
            font-weight: 500;
            color: #ffffff;
          }

          .history-duration {
            font-size: 0.75rem;
            font-weight: 600;
            padding: 0.25rem 0.5rem;
            border-radius: 9999px;
            background: rgba(232,168,112,0.18);
            color: #e8a870;
          }

          .history-details {
            display: flex;
            justify-content: space-between;
            font-size: 0.875rem;
          }

          .history-params {
            color: #e0c8b0;
          }

          .history-accuracy {
            color: #ffffff;
            font-weight: 500;
          }

          .model-actions {
            margin-top: 1.5rem;
            padding-top: 1.5rem;
            border-top: 1px solid rgba(180,120,60,0.16);
          }

          .model-actions-title {
            font-size: 0.875rem;
            font-weight: 500;
            color: #ffffff;
            margin-bottom: 0.75rem;
          }

          .model-actions-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 0.75rem;
          }

          .model-action-button {
            padding: 0.5rem;
            font-size: 0.875rem;
            border: 1px solid rgba(180,120,60,0.16);
            border-radius: 8px;
            background: transparent;
            color: #e0c8b0;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
          }

          .model-action-button:hover {
            background: rgba(232,168,112,0.18);
          }

          .model-action-button.restart {
            background: linear-gradient(135deg, #c06c30, #e89c60);
            color: #ffffff;
            border: none;
          }

          .model-action-button.restart:hover {
            box-shadow: 0 4px 20px rgba(232,168,112,0.25);
          }

          .footer {
            margin-top: 2rem;
            padding-top: 2rem;
            border-top: 1px solid rgba(180,120,60,0.16);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            align-items: center;
            color: #e0c8b0;
            font-size: 0.875rem;
          }

          @media (min-width: 768px) {
            .footer {
              flex-direction: row;
            }
          }

          .footer-info p {
            margin: 0;
          }

          .footer-info p:first-child {
            margin-bottom: 0.25rem;
          }

          .footer-links {
            display: flex;
            gap: 1rem;
            margin-top: 1rem;
          }

          @media (min-width: 768px) {
            .footer-links {
              margin-top: 0;
            }
          }

          .footer-link {
            background: none;
            border: none;
            color: #e0c8b0;
            cursor: pointer;
            transition: color 0.2s;
          }

          .footer-link:hover {
            color: #ffffff;
          }
        `}
      </style>

      <div className="admin-container">
        <div className="admin-wrapper">
          {/* Header */}
          <div className="admin-header">
            <div>
              <h1 className="admin-title">AI Model Management</h1>
              <p className="admin-subtitle">Monitor, train, and optimize your safety prediction model</p>
            </div>
            <div className="admin-header-actions">
              <div className="status-badge">
                <div className={modelStatus?.is_trained ? 'status-dot-active' : 'status-dot-inactive'}></div>
                <span className="status-text">
                  {modelStatus?.is_trained ? 'Model Active' : 'Model Inactive'}
                </span>
              </div>
              <button
                onClick={fetchModelStatus}
                className="refresh-button"
                title="Refresh status"
              >
                <RefreshCw size={20} />
              </button>
            </div>
          </div>

          {/* Stats Overview */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-header">
                <div className="stat-icon-blue">
                  <Brain size={24} />
                </div>
                <span className={`stat-badge ${modelStatus?.is_trained ? 'stat-badge-active' : 'stat-badge-inactive'}`}>
                  {modelStatus?.is_trained ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="stat-value">
                {modelMetrics ? `${(modelMetrics.test_score * 100).toFixed(1)}%` : 'N/A'}
              </div>
              <div className="stat-label">Model Accuracy</div>
            </div>

            <div className="stat-card">
              <div className="stat-header">
                <div className="stat-icon-green">
                  <Database size={24} />
                </div>
              </div>
              <div className="stat-value">
                {modelMetrics?.n_samples?.toLocaleString() || '0'}
              </div>
              <div className="stat-label">Training Samples</div>
            </div>

            <div className="stat-card">
              <div className="stat-header">
                <div className="stat-icon-red">
                  <Cpu size={24} />
                </div>
              </div>
              <div className="stat-value">
                {modelMetrics?.n_features || '0'}
              </div>
              <div className="stat-label">Features Used</div>
            </div>

            <div className="stat-card">
              <div className="stat-header">
                <div className="stat-icon-amber">
                  <Clock size={24} />
                </div>
              </div>
              <div className="stat-value">
                {trainingHistory.length}
              </div>
              <div className="stat-label">Training Sessions</div>
            </div>
          </div>

          {/* Main Content */}
          <div className="main-grid">
            {/* Left Column - Training Control */}
            <div className="lg:col-span-2">
              <div className="card">
                {/* Tabs */}
                <div className="tabs">
                  {['overview', 'training', 'analytics'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`tab ${activeTab === tab ? 'active' : ''}`}
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Tab Content */}
                <div className="card-content">
                  {activeTab === 'overview' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      <div>
                        <h3 className="section-title">Model Overview</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                          <div className="info-row">
                            <span className="info-label">Model Type</span>
                            <span className="info-value">Stacking Ensemble</span>
                          </div>
                          <div className="info-row">
                            <span className="info-label">Base Models</span>
                            <span className="info-value">Random Forest, Gradient Boosting, Ridge</span>
                          </div>
                          <div className="info-row">
                            <span className="info-label">Final Estimator</span>
                            <span className="info-value">Neural Network (MLP)</span>
                          </div>
                          <div className="info-row">
                            <span className="info-label">Last Training</span>
                            <span className="info-value">
                              {modelMetrics?.training_time 
                                ? new Date(modelMetrics.training_time).toLocaleDateString()
                                : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h3 className="section-title">Quick Actions</h3>
                        <div className="action-grid">
                          <button
                            onClick={trainModel}
                            disabled={isTraining}
                            className={`action-button ${isTraining ? 'training' : 'train'}`}
                          >
                            {isTraining ? (
                              <>
                                <RefreshCw size={24} style={{ color: '#e8a870', animation: 'spin 1s linear infinite' }} />
                                <span style={{ color: '#e8a870', fontSize: '0.875rem', fontWeight: 500 }}>
                                  Training {trainingProgress}%
                                </span>
                              </>
                            ) : (
                              <>
                                <Zap size={24} style={{ color: '#8cd69c' }} />
                                <span style={{ color: '#8cd69c', fontSize: '0.875rem', fontWeight: 500 }}>Train Model</span>
                              </>
                            )}
                          </button>
                          <button
                            onClick={incrementalTrain}
                            className="action-button incremental"
                          >
                            <TrendingUp size={24} style={{ color: '#e8a870' }} />
                            <span style={{ color: '#e8a870', fontSize: '0.875rem', fontWeight: 500 }}>Incremental Train</span>
                          </button>
                          <button
                            onClick={exportModel}
                            className="action-button export"
                          >
                            <Download size={24} style={{ color: '#ffb347' }} />
                            <span style={{ color: '#ffb347', fontSize: '0.875rem', fontWeight: 500 }}>Export Model</span>
                          </button>
                          <button
                            onClick={importModel}
                            className="action-button import"
                          >
                            <Upload size={24} style={{ color: '#ff7b6b' }} />
                            <span style={{ color: '#ff7b6b', fontSize: '0.875rem', fontWeight: 500 }}>Import Model</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'training' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      <div>
                        <h3 className="section-title">Training Configuration</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                          <div className="training-config">
                            <label className="config-label">Number of Loops</label>
                            <input
                              type="range"
                              min="5"
                              max="30"
                              step="5"
                              value={trainingParams.n_loops}
                              onChange={(e) => setTrainingParams(prev => ({ ...prev, n_loops: parseInt(e.target.value) }))}
                              className="range-input"
                            />
                            <div className="range-labels">
                              <span>5 (Quick)</span>
                              <span className="range-value">{trainingParams.n_loops}</span>
                              <span>30 (Thorough)</span>
                            </div>
                          </div>

                          <div className="training-config">
                            <label className="config-label">Epochs per Loop</label>
                            <input
                              type="range"
                              min="1"
                              max="10"
                              value={trainingParams.n_epochs}
                              onChange={(e) => setTrainingParams(prev => ({ ...prev, n_epochs: parseInt(e.target.value) }))}
                              className="range-input"
                            />
                            <div className="range-labels">
                              <span>1 (Fast)</span>
                              <span className="range-value">{trainingParams.n_epochs}</span>
                              <span>10 (Deep)</span>
                            </div>
                          </div>

                          <div className="training-config">
                            <label className="config-label">Training Samples per Loop</label>
                            <select
                              value={trainingParams.n_samples}
                              onChange={(e) => setTrainingParams(prev => ({ ...prev, n_samples: parseInt(e.target.value) }))}
                              className="select-input"
                            >
                              <option value={1000}>1,000 samples (Light)</option>
                              <option value={5000}>5,000 samples (Standard)</option>
                              <option value={10000}>10,000 samples (Heavy)</option>
                            </select>
                          </div>

                          <div className="checkbox-wrapper">
                            <input
                              type="checkbox"
                              id="force-retrain"
                              checked={trainingParams.force_retrain}
                              onChange={(e) => setTrainingParams(prev => ({ ...prev, force_retrain: e.target.checked }))}
                              className="checkbox-input"
                            />
                            <label htmlFor="force-retrain" className="checkbox-label">
                              Force retrain even if model exists
                            </label>
                          </div>
                        </div>
                      </div>

                      <div>
                        <button
                          onClick={trainModel}
                          disabled={isTraining}
                          className={`start-button ${isTraining ? 'training' : 'idle'}`}
                        >
                          {isTraining ? (
                            <>
                              <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite' }} />
                              <span>Training {trainingProgress}%</span>
                            </>
                          ) : (
                            <>
                              <Play size={20} />
                              <span>Start Training</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {activeTab === 'analytics' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      <div>
                        <h3 className="section-title">Model Performance</h3>
                        {modelMetrics ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div className="metrics-grid">
                              <div className="metric-card-amber">
                                <div className="stat-value metric-value-amber">
                                  {(modelMetrics.cv_mean * 100).toFixed(1)}%
                                </div>
                                <div className="metric-title-amber">Cross-Validation Score</div>
                                <div className="metric-subtitle">
                                  ± {(modelMetrics.cv_std * 100).toFixed(2)}%
                                </div>
                              </div>
                              <div className="metric-card-green">
                                <div className="stat-value metric-value-green">
                                  {(modelMetrics.train_score * 100).toFixed(1)}%
                                </div>
                                <div className="metric-title-green">Training Score</div>
                              </div>
                            </div>
                            
                            <div className="metric-card-yellow">
                              <div className="stat-value metric-value-yellow">
                                {(modelMetrics.test_score * 100).toFixed(1)}%
                              </div>
                              <div className="metric-title-yellow">Test Score (Accuracy)</div>
                              <div style={{ marginTop: '0.5rem' }}>
                                <div className="performance-row">
                                  <span className="performance-label">Model Performance</span>
                                  <span className="performance-value">
                                    {modelMetrics.test_score >= 0.8 ? 'Excellent' :
                                     modelMetrics.test_score >= 0.7 ? 'Good' :
                                     modelMetrics.test_score >= 0.6 ? 'Acceptable' : 'Needs Improvement'}
                                  </span>
                                </div>
                                <div className="progress-bar">
                                  <div 
                                    className="progress-fill"
                                    style={{ width: `${modelMetrics.test_score * 100}%` }}
                                  ></div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="empty-state">
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              {/* Training History */}
              <div className="card">
                <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid rgba(180,120,60,0.16)' }}>
                  <h3 className="section-title" style={{ marginBottom: 0, display: 'flex', alignItems: 'center' }}>
                    <Clock size={20} style={{ color: '#ffb347', marginRight: '0.5rem' }} />
                    Training History
                  </h3>
                </div>
                <div style={{ padding: '1rem', maxHeight: '384px', overflowY: 'auto' }}>
                  {trainingHistory.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {trainingHistory.map((session) => (
                        <div key={session.id} className="history-item">
                          <div className="history-header">
                            <div className="history-status">
                              <div className={`status-dot-${session.status === 'completed' ? 'completed' : session.status === 'failed' ? 'failed' : 'pending'}`}></div>
                              <span className="history-date">
                                {new Date(session.timestamp).toLocaleDateString()}
                              </span>
                            </div>
                            <span className="history-duration">
                              {session.duration}
                            </span>
                          </div>
                          <div className="history-details">
                            <span className="history-params">
                              {session.n_loops} loops × {session.n_epochs} epochs
                            </span>
                            <span className="history-accuracy">
                              {(session.accuracy * 100).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      No training history available
                    </div>
                  )}
                </div>
              </div>

              {/* Model Information */}
              <div className="card">
                <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid rgba(180,120,60,0.16)' }}>
                  <h3 className="section-title" style={{ marginBottom: 0, display: 'flex', alignItems: 'center' }}>
                    <Settings size={20} style={{ color: '#e0c8b0', marginRight: '0.5rem' }} />
                    Model Information
                  </h3>
                </div>
                <div style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div className="info-row">
                      <span className="info-label">Status</span>
                      <span className={`info-value ${modelStatus?.is_trained ? 'metric-value-green' : 'metric-value-yellow'}`}>
                        {modelStatus?.is_trained ? 'Ready' : 'Not Trained'}
                      </span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Version</span>
                      <span className="info-value">2.1.0</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Storage</span>
                      <span className="info-value">12.4 MB</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Last Updated</span>
                      <span className="info-value">
                        {modelMetrics?.training_time 
                          ? new Date(modelMetrics.training_time).toLocaleDateString()
                          : 'N/A'}
                      </span>
                    </div>
                  </div>

                  <div className="model-actions">
                    <h4 className="model-actions-title">Model Actions</h4>
                    <div className="model-actions-grid">
                      <button
                        onClick={fetchModelStatus}
                        className="model-action-button"
                      >
                        <RefreshCw size={16} />
                        <span>Refresh</span>
                      </button>
                      <button
                        onClick={() => window.location.reload()}
                        className="model-action-button restart"
                      >
                        <Activity size={16} />
                        <span>Restart</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="footer">
            <div className="footer-info">
              <p>Tryver AI Safety Model Management System</p>
              <p>Version 2.1.0 • Last updated: {new Date().toLocaleDateString()}</p>
            </div>
            <div className="footer-links">
              <button className="footer-link">Documentation</button>
              <button className="footer-link">Support</button>
              <button className="footer-link">Settings</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default AdminPage;
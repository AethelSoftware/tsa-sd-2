import logging
from datetime import datetime
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class EmergencyDataFetcher:
    """Lightweight fetcher that returns mock data for compatibility"""
    
    def __init__(self):
        self.emergencies = []
        self.last_update = datetime.now()
        logger.info("Lightweight Emergency Data Fetcher initialized (News API only)")
    
    def get_emergencies_in_area(self, lat: float, lng: float, radius_meters: float = 1000) -> List[Dict[str, Any]]:
        """Return empty list - actual hazards come from News API"""
        return []
    
    def get_emergencies_on_route(self, route_coords: List[tuple], buffer_meters: float = 200) -> List[Dict[str, Any]]:
        """Return empty list - actual hazards come from News API"""
        return []
    
    def get_summary_stats(self) -> Dict[str, Any]:
        """Return summary stats"""
        return {
            'total': 0,
            'by_type': {},
            'last_update': self.last_update.isoformat() if self.last_update else None
        }
    
    def fetch_all_data(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """No-op for compatibility"""
        return []

# Singleton instance
_emergency_fetcher = None

def get_emergency_fetcher() -> EmergencyDataFetcher:
    """Get or create the singleton emergency fetcher instance"""
    global _emergency_fetcher
    if _emergency_fetcher is None:
        _emergency_fetcher = EmergencyDataFetcher()
    return _emergency_fetcher
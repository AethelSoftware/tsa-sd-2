"""
city_config.py — Multi-city configuration registry for Tryver
"""
from typing import Dict, Any

CITY_CONFIGS: Dict[str, Dict[str, Any]] = {
    "pittsburgh": {
        "name": "Pittsburgh, PA", "state": "PA",
        "center_lat": 40.4406, "center_lng": -79.9959,
        "bbox": {"min_lat": 40.2, "max_lat": 40.8, "min_lng": -80.8, "max_lng": -79.5},
        "zoom": 13, "gtfs_path": "GTFS.zip",
        "tomtom_search_radius": 50000,
        "wprdc_crime_resource": "bd41992a-987a-4cca-8798-fbe1cd946b07",
        "gdelt_fips": "US-PA", "gdelt_geoname": "Pittsburgh",
        "timezone": "America/New_York",
        "supports_wprdc": True, "supports_pulsepoint": True,
    },
    "philadelphia": {
        "name": "Philadelphia, PA", "state": "PA",
        "center_lat": 39.9526, "center_lng": -75.1652,
        "bbox": {"min_lat": 39.85, "max_lat": 40.05, "min_lng": -75.35, "max_lng": -74.95},
        "zoom": 13, "gtfs_path": "SEPTA_GTFS.zip",
        "tomtom_search_radius": 50000, "wprdc_crime_resource": None,
        "gdelt_fips": "US-PA", "gdelt_geoname": "Philadelphia",
        "timezone": "America/New_York", "supports_wprdc": False, "supports_pulsepoint": False,
    },
    "cleveland": {
        "name": "Cleveland, OH", "state": "OH",
        "center_lat": 41.4993, "center_lng": -81.6944,
        "bbox": {"min_lat": 41.3, "max_lat": 41.7, "min_lng": -81.9, "max_lng": -81.4},
        "zoom": 13, "gtfs_path": "RTA_GTFS.zip",
        "tomtom_search_radius": 50000, "wprdc_crime_resource": None,
        "gdelt_fips": "US-OH", "gdelt_geoname": "Cleveland",
        "timezone": "America/New_York", "supports_wprdc": False, "supports_pulsepoint": False,
    },
    "columbus": {
        "name": "Columbus, OH", "state": "OH",
        "center_lat": 39.9612, "center_lng": -82.9988,
        "bbox": {"min_lat": 39.8, "max_lat": 40.1, "min_lng": -83.2, "max_lng": -82.8},
        "zoom": 13, "gtfs_path": "COTA_GTFS.zip",
        "tomtom_search_radius": 50000, "wprdc_crime_resource": None,
        "gdelt_fips": "US-OH", "gdelt_geoname": "Columbus Ohio",
        "timezone": "America/New_York", "supports_wprdc": False, "supports_pulsepoint": False,
    },
    "cincinnati": {
        "name": "Cincinnati, OH", "state": "OH",
        "center_lat": 39.1031, "center_lng": -84.5120,
        "bbox": {"min_lat": 38.9, "max_lat": 39.3, "min_lng": -84.8, "max_lng": -84.2},
        "zoom": 13, "gtfs_path": "SORTA_GTFS.zip",
        "tomtom_search_radius": 50000, "wprdc_crime_resource": None,
        "gdelt_fips": "US-OH", "gdelt_geoname": "Cincinnati",
        "timezone": "America/New_York", "supports_wprdc": False, "supports_pulsepoint": False,
    },
}

DEFAULT_CITY = "pittsburgh"

def get_city(city_key: str) -> Dict[str, Any]:
    return CITY_CONFIGS.get(city_key, CITY_CONFIGS[DEFAULT_CITY])

def get_all_cities():
    return [{"key": k, "name": v["name"]} for k, v in CITY_CONFIGS.items()]
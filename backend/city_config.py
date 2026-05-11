"""
city_config.py — Canonical city registry for Tryver multi-city expansion.

Each city dict contains everything needed to:
  1. Fetch crime data from the city's open-data portal
  2. Initialise a PulsePoint agency search
  3. Query GDELT for news-based hazards
  4. Validate coordinates against the city bounding box

ADDING A NEW CITY: add one entry to CITIES and restart the server. No other changes needed.
"""

from datetime import datetime, timedelta

CITIES = {

    "pittsburgh": {
        "display_name":   "Pittsburgh, PA",
        "center_lat":     40.4406,
        "center_lng":    -79.9959,
        "gdelt_geoname":  "Pittsburgh Pennsylvania",
        "bbox": {
            "min_lat": 40.20, "max_lat": 40.80,
            "min_lng": -80.80, "max_lng": -79.50,
        },
        "pulsepoint_search_coords": "40.4406,-79.9959",

        # ── Crime data source ──────────────────────────────────────────────
        "crime_source": "wprdc_ckan",
        "crime_endpoint": "https://data.wprdc.org/api/3/action/datastore_search_sql",
        "crime_resource_id": "bd41992a-987a-4cca-8798-fbe1cd946b07",
        "crime_date_col":    "ReportedDate",
        "crime_offense_col": "NIBRS_Coded_Offense",
        "crime_lat_col":     "YCOORD",
        "crime_lng_col":     "XCOORD",
        "crime_address_col": "Block_Address",
        "crime_neighborhood_col": "Neighborhood",
        "crime_limit":       500,
        "crime_lookback_days": 42,
    },

    "philadelphia": {
        "display_name":   "Philadelphia, PA",
        "center_lat":     39.9526,
        "center_lng":    -75.1652,
        "gdelt_geoname":  "Philadelphia Pennsylvania",
        "bbox": {
            "min_lat": 39.85, "max_lat": 40.14,
            "min_lng": -75.29, "max_lng": -74.95,
        },
        "pulsepoint_search_coords": "39.9526,-75.1652",

        # FIXED 2026-05-08: Increased lookback_days from 30 to 330 because dataset hasn't been updated since Aug 2025
        "crime_source":             "socrata_json",
        "crime_endpoint":          "https://data.phila.gov/resource/sspu-uyfa.json",
        "crime_fallback_endpoint":  "https://data.phila.gov/resource/u6bt-9fu4.json",
        "crime_date_col":           "dispatch_date_time",
        "crime_offense_col":        "text_general_code",
        "crime_lat_col":            "point_y",
        "crime_lng_col":            "point_x",
        "crime_address_col":        "location_block",
        "crime_neighborhood_col":   "dc_dist",
        "crime_limit":              500,
        "crime_lookback_days":      330,  # Covers data back to August 2025
        "crime_where_template":     "dispatch_date_time >= '{cutoff}'",
        "crime_date_format":        "%Y-%m-%dT%H:%M:%S",
        "crime_supports_order":     True,
    },

    "cleveland": {
        "display_name":   "Cleveland, OH",
        "center_lat":     41.4993,
        "center_lng":    -81.6944,
        "gdelt_geoname":  "Cleveland Ohio",
        "bbox": {
            "min_lat": 41.35, "max_lat": 41.60,
            "min_lng": -81.88, "max_lng": -81.53,
        },
        "pulsepoint_search_coords": "41.4993,-81.6944",

        # CONFIRMED 2026-05-10: Crime_Incidents_P1RMS — LIVE data from new RMS (post 11/11/2025)
        # Item ID: e15e8989c83e4cbd841fb171a6c62f68 (modified Apr 2026)
        # Field 'IncidentDesc' contains NIBRS offense codes (e.g., "Simple Assault", "All Other Larceny")
        "crime_source":   "arcgis_rest",
        "crime_endpoint": "https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Crime_Incidents_P1RMS/FeatureServer/0/query",
        "crime_fallback_endpoint": None,
        "crime_date_col":         "ReportedDate",
        "crime_offense_col":      "IncidentDesc",
        "crime_lat_col":          "LAT",
        "crime_lng_col":          "LON",
        "crime_address_col":      "Address_Public",
        "crime_neighborhood_col": "NEIGHBORHOOD",
        "crime_limit":            500,
        "crime_lookback_days":    30,
        "crime_where_template":   "ReportedDate >= TIMESTAMP '{cutoff} 00:00:00'",
        "crime_supports_order":   True,
    },

    "columbus": {
        "display_name":   "Columbus, OH",
        "center_lat":     39.9612,
        "center_lng":    -82.9988,
        "gdelt_geoname":  "Columbus Ohio",
        "bbox": {
            "min_lat": 39.85, "max_lat": 40.16,
            "min_lng": -83.20, "max_lng": -82.77,
        },
        "pulsepoint_search_coords": "39.9612,-82.9988",

        # CONFIRMED 2026-05-09: Socrata endpoint active with current data (May 2026)
        # ArcGIS endpoints (services1/services3.arcgis.com) blocked by egress proxy (403 host_not_allowed)
        "crime_source":             "socrata_json",
        "crime_endpoint":           "https://data.columbus.gov/resource/rntm-jp9t.json",
        "crime_fallback_endpoint":  None,
        "crime_date_col":           "report_date",
        "crime_offense_col":        "offense_type",  # Also has ucr_text for more detail
        "crime_lat_col":            "latitude",
        "crime_lng_col":            "longitude",
        "crime_address_col":        "block_address",
        "crime_neighborhood_col":   "beat",
        "crime_limit":              500,
        "crime_lookback_days":      30,  # Data is current as of May 2026
        "crime_where_template":     "report_date >= '{cutoff}'",
        "crime_date_format":        "%Y-%m-%dT%H:%M:%S",
        "crime_supports_order":     True,
    },

    "cincinnati": {
        "display_name":   "Cincinnati, OH",
        "center_lat":     39.1031,
        "center_lng":    -84.5120,
        "gdelt_geoname":  "Cincinnati Ohio",
        "bbox": {
            "min_lat": 38.98, "max_lat": 39.32,
            "min_lng": -84.76, "max_lng": -84.26,
        },
        "pulsepoint_search_coords": "39.1031,-84.5120",

        # CONFIRMED via curl 2026-05-04: resource 7aqy-xrv9 is active
        "crime_source":             "socrata_json",
        "crime_endpoint":           "https://data.cincinnati-oh.gov/resource/7aqy-xrv9.json",
        "crime_fallback_endpoint":  "https://data.cincinnati-oh.gov/resource/k59e-2pvf.json",
        "crime_date_col":           "datereported",
        "crime_offense_col":        "stars_category",
        "crime_lat_col":            "latitude_x",
        "crime_lng_col":            "longitude_x",
        "crime_address_col":        "address_x",
        "crime_neighborhood_col":   "cpd_neighborhood",
        "crime_limit":              500,
        "crime_lookback_days":      30,
        "crime_where_template":     "datereported >= '{cutoff}'",
        "crime_date_format":        "%Y-%m-%dT%H:%M:%S",
        "crime_supports_order":     False,   # $order causes HTTP 400
    },
}


def get_city(city_key: str) -> dict:
    """Return city config dict. Raises KeyError if city_key is unknown."""
    key = city_key.lower().strip()
    if key not in CITIES:
        raise KeyError(f"Unknown city: {key!r}. Known: {list(CITIES)}")
    return CITIES[key]


def get_cutoff_date(city_key: str) -> str:
    """
    Return ISO date string for the crime lookback window.
    Accepts EITHER a city key ("pittsburgh") OR a display_name
    ("Pittsburgh, PA"). Falls back to Pittsburgh if input is unparseable.
    """
    if not city_key:
        key = "pittsburgh"
    else:
        raw = city_key.strip().lower()
        # Strip state suffix: "pittsburgh, pa" → "pittsburgh"
        if "," in raw:
            raw = raw.split(",", 1)[0].strip()
        # Strip trailing state words like "pennsylvania"
        for state_word in ("pennsylvania", "ohio", "pa", "oh"):
            if raw.endswith(" " + state_word):
                raw = raw[: -(len(state_word) + 1)].strip()
        key = raw

    try:
        cfg = get_city(key)
    except KeyError:
        # Last-resort fallback so we never block the pipeline
        cfg = get_city("pittsburgh")

    days = cfg.get("crime_lookback_days", 14)
    return (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")


def is_in_bounds(city_key: str, lat: float, lng: float) -> bool:
    """Return True if (lat, lng) is inside the city bounding box."""
    bbox = get_city(city_key)["bbox"]
    return (
        bbox["min_lat"] <= lat <= bbox["max_lat"] and
        bbox["min_lng"] <= lng <= bbox["max_lng"]
    )
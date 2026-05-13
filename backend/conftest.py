"""
Run all tests:     cd backend && pytest test_routing.py -v
Run one test:      cd backend && pytest test_routing.py::TestCacheInvalidation::test_clear_cache_actually_empties -v
Run with coverage: cd backend && pytest test_routing.py --cov=. --cov-report=term-missing
"""
import os
import sys
import pytest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(scope="session")
def flask_app():
    from app import add_model_endpoints
    from flask import Flask
    from flask_cors import CORS

    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['SERVER_NAME'] = 'localhost.test'
    CORS(app, resources={r"/*": {"origins": "*"}})
    add_model_endpoints(app)
    yield app


@pytest.fixture
def client(flask_app):
    with flask_app.test_client() as c:
        with flask_app.app_context():
            yield c


@pytest.fixture
def safety_model():
    from ai_safety_model import get_safety_ai
    return get_safety_ai()


@pytest.fixture
def trained_safety_model(safety_model):
    if not safety_model.is_trained:
        with patch('ai_safety_model.fetch_wprdc_crime_incidents') as mock_crime:
            mock_crime.return_value = [
                {'lat': 40.4406, 'lng': -79.9959, 'severity': 0.8,
                 'type': 'crime', 'description': 'Test incident'},
                {'lat': 40.4500, 'lng': -79.9900, 'severity': 0.7,
                 'type': 'crime', 'description': 'Test incident 2'},
                {'lat': 40.4350, 'lng': -79.9800, 'severity': 0.85,
                 'type': 'crime', 'description': 'Test incident 3'},
            ] * 30
            safety_model.train_on_real_data(force_retrain=True)
    return safety_model


@pytest.fixture
def pittsburgh_coords():
    return {
        'oakland':       (40.4440, -79.9545),
        'downtown':      (40.4406, -79.9959),
        'shadyside':     (40.4500, -79.9300),
        'squirrel_hill': (40.4350, -79.9230),
        'fox_chapel':    (40.5193, -79.8898),
        'oakland_to_downtown_dist_km': 3.5,
    }


@pytest.fixture
def indiana_coords():
    return {
        'pintail_drive_indiana': (39.7684, -86.1581),
    }


@pytest.fixture(autouse=True)
def reset_caches_between_tests():
    try:
        from app import tomtom_router
        if tomtom_router and hasattr(tomtom_router, 'clear_cache'):
            tomtom_router.clear_cache()
        if tomtom_router and hasattr(tomtom_router, 'route_cache'):
            tomtom_router.route_cache.clear()
        if tomtom_router and hasattr(tomtom_router, 'geocode_cache'):
            tomtom_router.geocode_cache.clear()
    except ImportError:
        pass

    try:
        from news_hazard_fetcher import get_news_fetcher
        nf = get_news_fetcher()
        if hasattr(nf, 'force_refresh_cache'):
            nf.force_refresh_cache()
    except ImportError:
        pass

    yield
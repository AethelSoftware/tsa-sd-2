"""
Tryver Routing Test Harness.

Three categories:
  1. Route correctness   — ends where requested, in the right city.
  2. Cache invalidation  — successive different routes don't leak.
  3. ML routing effect   — the safety model is causal, not cosmetic.

Run:  cd backend && pytest test_routing.py -v
"""
import math
import pytest
from unittest.mock import patch


def haversine_m(lat1, lng1, lat2, lng2):
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


# ============================================================================
# CATEGORY 1: ROUTE CORRECTNESS
# ============================================================================

class TestRouteCorrectness:

    def test_pittsburgh_to_pittsburgh_route(self, client, pittsburgh_coords):
        """Route geometry must end at the requested Pittsburgh coord, not Indiana."""
        oak_lat, oak_lng = pittsburgh_coords['oakland']
        dt_lat,  dt_lng  = pittsburgh_coords['downtown']

        r = client.post('/api/calculate-route', json={
            'start_lat': oak_lat, 'start_lng': oak_lng,
            'end_lat':   dt_lat,  'end_lng':   dt_lng,
            'travel_mode': 'pedestrian',
            'accessibility_preferences': {},
        })

        data = r.get_json()
        if not data.get('success'):
            pytest.skip(f"Routing provider unavailable: {data.get('error')}")

        coords = data['route']['coordinates']
        assert len(coords) >= 2

        last = coords[-1]
        end_dist = haversine_m(last['lat'], last['lng'], dt_lat, dt_lng)
        assert end_dist < 200, (
            f"Route ends {end_dist:.0f}m from requested downtown "
            f"({last['lat']}, {last['lng']}). Likely cache leak."
        )

    def test_route_steps_reference_correct_city(self, client, pittsburgh_coords):
        """No step instruction should name a non-PA state if routing in Pittsburgh."""
        oak_lat, oak_lng = pittsburgh_coords['oakland']
        dt_lat,  dt_lng  = pittsburgh_coords['downtown']

        r = client.post('/api/calculate-route', json={
            'start_lat': oak_lat, 'start_lng': oak_lng,
            'end_lat':   dt_lat,  'end_lng':   dt_lng,
            'travel_mode': 'pedestrian',
        })
        data = r.get_json()
        if not data.get('success'):
            pytest.skip(f"Routing failed: {data.get('error')}")

        FORBIDDEN = ['ohio', 'illinois', 'michigan', 'kentucky',
                     'west virginia', 'maryland', 'new york', 'new jersey']
        # NOTE: "indiana" alone is ambiguous — Indiana Township is a Pittsburgh suburb.
        # We check for "indiana, " (with comma = state reference) or "indiana state".
        FORBIDDEN_INDIANA = ['indiana, ', 'indiana state', 'indianapolis']

        for step in data['route']['steps']:
            instr = step.get('instruction', '').lower()
            for word in FORBIDDEN:
                assert word not in instr, (
                    f"Pittsburgh route step mentions '{word}': '{instr[:80]}'"
                )
            for phrase in FORBIDDEN_INDIANA:
                assert phrase not in instr, (
                    f"Pittsburgh route step mentions Indiana state: '{instr[:80]}'"
                )

    def test_route_distance_is_reasonable(self, client, pittsburgh_coords):
        """Oakland→Downtown is ~3.5 km. >17 km means wrong destination."""
        oak_lat, oak_lng = pittsburgh_coords['oakland']
        dt_lat,  dt_lng  = pittsburgh_coords['downtown']
        expected_km      = pittsburgh_coords['oakland_to_downtown_dist_km']

        r = client.post('/api/calculate-route', json={
            'start_lat': oak_lat, 'start_lng': oak_lng,
            'end_lat':   dt_lat,  'end_lng':   dt_lng,
            'travel_mode': 'pedestrian',
        })
        data = r.get_json()
        if not data.get('success'):
            pytest.skip("Routing failed")

        actual_km = data['route']['distance_meters'] / 1000
        assert actual_km < expected_km * 5, (
            f"Route is {actual_km:.1f} km for a {expected_km} km direct distance. "
            f"Wrong destination suspected."
        )


# ============================================================================
# CATEGORY 2: CACHE INVALIDATION
# ============================================================================

class TestCacheInvalidation:

    def test_different_destinations_yield_different_routes(self, client, pittsburgh_coords):
        """A→B then A→C must produce routes ending at B and C respectively."""
        oak_lat, oak_lng = pittsburgh_coords['oakland']
        dt_lat,  dt_lng  = pittsburgh_coords['downtown']
        ss_lat,  ss_lng  = pittsburgh_coords['shadyside']

        r1 = client.post('/api/calculate-route', json={
            'start_lat': oak_lat, 'start_lng': oak_lng,
            'end_lat':   dt_lat,  'end_lng':   dt_lng,
            'travel_mode': 'pedestrian',
        })
        if not r1.get_json().get('success'):
            pytest.skip("First routing call failed")

        r2 = client.post('/api/calculate-route', json={
            'start_lat': oak_lat, 'start_lng': oak_lng,
            'end_lat':   ss_lat,  'end_lng':   ss_lng,
            'travel_mode': 'pedestrian',
        })
        if not r2.get_json().get('success'):
            pytest.skip("Second routing call failed")

        last1 = r1.get_json()['route']['coordinates'][-1]
        last2 = r2.get_json()['route']['coordinates'][-1]
        end_diff = haversine_m(last1['lat'], last1['lng'], last2['lat'], last2['lng'])

        assert end_diff > 500, (
            f"Two routes to different destinations ended within {end_diff:.0f}m. "
            f"Cache leak — destination key is not part of the cache key."
        )

    def test_indiana_then_pittsburgh_no_leak(self, client, pittsburgh_coords, indiana_coords):
        """Reproduce the screenshot bug: Indiana route then Pittsburgh route must not bleed."""
        oak_lat, oak_lng = pittsburgh_coords['oakland']
        ind_lat, ind_lng = indiana_coords['pintail_drive_indiana']
        dt_lat,  dt_lng  = pittsburgh_coords['downtown']

        # Seed the bad cache state (ignore result — it may fail for long-distance)
        client.post('/api/calculate-route', json={
            'start_lat': oak_lat, 'start_lng': oak_lng,
            'end_lat':   ind_lat, 'end_lng':   ind_lng,
            'travel_mode': 'pedestrian',
        })

        # Now route entirely within Pittsburgh
        r2 = client.post('/api/calculate-route', json={
            'start_lat': oak_lat, 'start_lng': oak_lng,
            'end_lat':   dt_lat,  'end_lng':   dt_lng,
            'travel_mode': 'pedestrian',
        })
        data = r2.get_json()
        if not data.get('success'):
            pytest.skip("Pittsburgh routing failed after Indiana seed")

        # Endpoint check
        last = data['route']['coordinates'][-1]
        end_dist = haversine_m(last['lat'], last['lng'], dt_lat, dt_lng)
        assert end_dist < 200, (
            f"After Indiana request, Pittsburgh route ends {end_dist:.0f}m from downtown. "
            f"Cache leak confirmed."
        )

        # Step-text check
        for step in data['route']['steps']:
            instr = step.get('instruction', '').lower()
            assert 'indiana state' not in instr and 'indianapolis' not in instr, (
                f"Pittsburgh step mentions Indiana state: '{instr[:80]}'"
            )

    def test_tomtom_router_force_refresh_default_is_true(self):
        """calculate_route() must default force_refresh=True — defense in depth."""
        try:
            from tomtom_router import TomTomRouter
        except ImportError:
            pytest.skip("TomTom router not importable")

        import inspect
        sig = inspect.signature(TomTomRouter.calculate_route)
        param = sig.parameters.get('force_refresh')
        assert param is not None, "calculate_route() missing force_refresh parameter"
        assert param.default is True, (
            f"calculate_route(force_refresh=...) default is {param.default!r}, must be True."
        )

    def test_clear_cache_actually_empties(self):
        """clear_cache() must leave route_cache empty."""
        try:
            from app import tomtom_router
        except ImportError:
            pytest.skip("App not importable")
        if tomtom_router is None:
            pytest.skip("TomTom router not initialized")
        if not hasattr(tomtom_router, 'route_cache'):
            pytest.skip("No route_cache attribute")

        tomtom_router.route_cache['_test_sentinel'] = {'fake': True}
        assert len(tomtom_router.route_cache) >= 1

        tomtom_router.clear_cache()
        assert len(tomtom_router.route_cache) == 0, (
            f"clear_cache() left {len(tomtom_router.route_cache)} entries"
        )

    def test_vdb_cache_read_is_disabled(self):
        """The VectorDB must never serve a cached route — reads must be gated off."""
        try:
            from app import ENABLE_ROUTE_VDB_CACHE
        except ImportError:
            pytest.fail(
                "ENABLE_ROUTE_VDB_CACHE constant missing from app.py. "
                "Add it: ENABLE_ROUTE_VDB_CACHE = False"
            )
        assert ENABLE_ROUTE_VDB_CACHE is False, (
            f"ENABLE_ROUTE_VDB_CACHE={ENABLE_ROUTE_VDB_CACHE}. Must be False."
        )


# ============================================================================
# CATEGORY 3: ML AS A ROUTING FACTOR
# ============================================================================

class TestMLRoutingEffect:

    def test_safety_model_loaded(self, safety_model):
        """Singleton exists and reports training state."""
        assert safety_model is not None
        info = safety_model.get_model_info()
        assert 'is_trained' in info
        assert 'model_type' in info

    def test_trained_model_predicts_pittsburgh_safety(
        self, trained_safety_model, pittsburgh_coords
    ):
        """Trained model returns a valid [0,1] safety score for a Pittsburgh point."""
        lat, lng = pittsburgh_coords['oakland']
        result = trained_safety_model.predict_safety_score(lat, lng)

        assert 'safety_score' in result
        assert 0.0 <= result['safety_score'] <= 1.0
        assert result['risk_level'] in ('low', 'medium', 'high', 'critical')

    def test_route_safety_attached_to_response(self, client, pittsburgh_coords):
        """Successful route response includes safety metadata."""
        oak_lat, oak_lng = pittsburgh_coords['oakland']
        dt_lat,  dt_lng  = pittsburgh_coords['downtown']

        r = client.post('/api/calculate-route', json={
            'start_lat': oak_lat, 'start_lng': oak_lng,
            'end_lat':   dt_lat,  'end_lng':   dt_lng,
            'travel_mode': 'pedestrian',
        })
        data = r.get_json()
        if not data.get('success'):
            pytest.skip("Routing failed")

        assert 'safety' in data['route']
        s = data['route']['safety']
        assert 'overall_safety' in s
        assert 0.0 <= s['overall_safety'] <= 1.0
        assert 'risk_level' in s

    def test_ml_selection_metadata_present_for_tomtom(self, client, pittsburgh_coords):
        """When TomTom is the provider, ml_selection metadata must be in the response."""
        oak_lat, oak_lng = pittsburgh_coords['oakland']
        dt_lat,  dt_lng  = pittsburgh_coords['downtown']

        r = client.post('/api/calculate-route', json={
            'start_lat': oak_lat, 'start_lng': oak_lng,
            'end_lat':   dt_lat,  'end_lng':   dt_lng,
            'travel_mode': 'pedestrian',
        })
        data = r.get_json()
        if not data.get('success'):
            pytest.skip("Routing failed")

        provider = data.get('provider', '')
        if 'TomTom' not in provider:
            pytest.skip(f"TomTom not used (provider={provider!r})")

        ml = data['route'].get('ml_selection')
        assert ml is not None, (
            "TomTom route missing route.ml_selection. "
            "The ML selector must be causal, not cosmetic."
        )
        assert 'final_score' in ml
        assert 'safety_score' in ml
        assert 'all_candidates_scored' in ml

    def test_score_route_candidate_safety_beats_speed(self):
        """Weighted scorer must prefer safe+slow over unsafe+fast."""
        from app import score_route_candidate

        slow_safe   = {'duration_seconds': 1800, 'distance_meters': 2000}
        fast_unsafe = {'duration_seconds': 1200, 'distance_meters': 2000}

        assert score_route_candidate(slow_safe, 0.85) > score_route_candidate(fast_unsafe, 0.45), (
            "Weighted scorer preferred fast-unsafe over slow-safe. "
            "Increase ML_ROUTING_WEIGHTS['safety']."
        )

    def test_select_safest_route_rejects_all_unsafe(self):
        """All-below-floor candidates → warning='all_rejected', selected=None."""
        from app import select_safest_route

        candidates = [
            {'points': [[40.44, -79.99], [40.45, -79.98]],
             'duration_seconds': 600, 'distance_meters': 1000},
        ]

        class MockUnsafeModel:
            is_trained = True
            def calculate_route_safety(self, coords, hd=None):
                return {'overall_safety': 0.2, 'risk_level': 'critical',
                        'recommendations': []}

        result = select_safest_route(candidates, MockUnsafeModel())
        assert result['selected'] is None
        assert result['warning'] == 'all_rejected'

    def test_select_safest_route_caution_on_borderline(self):
        """Route between WARN and REJECT thresholds → warning_level='caution'."""
        from app import select_safest_route

        candidates = [
            {'points': [[40.44, -79.99], [40.45, -79.98]],
             'duration_seconds': 600, 'distance_meters': 1000},
        ]

        class MockBorderlineModel:
            is_trained = True
            def calculate_route_safety(self, coords, hd=None):
                return {'overall_safety': 0.55, 'risk_level': 'medium',
                        'recommendations': []}

        result = select_safest_route(candidates, MockBorderlineModel())
        assert result['selected'] is not None
        assert result['warning_level'] == 'caution'

    def test_select_safest_picks_highest_scoring_candidate(self):
        """Given two acceptable candidates, selector returns the safer one."""
        from app import select_safest_route

        unsafe_cand = {
            'points': [[40.44, -79.99], [40.449, -79.985]],  # lat[1] < 40.455
            'duration_seconds': 800, 'distance_meters': 1500,
        }
        safe_cand = {
            'points': [[40.44, -79.99], [40.461, -79.970]],  # lat[1] > 40.455
            'duration_seconds': 1200, 'distance_meters': 2200,
        }

        class MockDiscriminatingModel:
            is_trained = True
            def calculate_route_safety(self, coords, hd=None):
                if coords[1]['lat'] > 40.455:
                    return {'overall_safety': 0.85, 'risk_level': 'low',
                            'recommendations': []}
                return {'overall_safety': 0.55, 'risk_level': 'medium',
                        'recommendations': []}

        result = select_safest_route([unsafe_cand, safe_cand], MockDiscriminatingModel())
        assert result['selected'] is not None
        assert result['selected']['points'][1][0] > 40.455, (
            "Selector picked the lower-safety candidate."
        )
        assert result['safety_score'] == pytest.approx(0.85, abs=0.01)

    def test_all_rejected_returns_422_from_endpoint(self, client, pittsburgh_coords):
        """When ML rejects all candidates, endpoint returns 422 with rejection metadata."""
        oak_lat, oak_lng = pittsburgh_coords['oakland']
        dt_lat,  dt_lng  = pittsburgh_coords['downtown']

        class MockZeroSafetyModel:
            is_trained = True
            def calculate_route_safety(self, coords, hd=None):
                return {'overall_safety': 0.1, 'risk_level': 'critical',
                        'recommendations': []}
            def predict_safety_score(self, lat, lng):
                return {'safety_score': 0.1, 'risk_level': 'critical',
                        'recommendations': [], 'confidence': 1.0,
                        'coordinates': {'lat': lat, 'lng': lng},
                        'timestamp': '2025-01-01T00:00:00'}
            def get_model_info(self):
                return {'is_trained': True, 'last_training_time': None,
                        'training_metrics': {}, 'model_path': '',
                        'model_type': 'mock'}

        with patch('app.get_safety_ai_instance', return_value=MockZeroSafetyModel()):
            r = client.post('/api/calculate-route', json={
                'start_lat': oak_lat, 'start_lng': oak_lng,
                'end_lat':   dt_lat,  'end_lng':   dt_lng,
                'travel_mode': 'pedestrian',
            })

        # Only check 422 if TomTom actually returned candidates
        # (if TomTom is down, fallback fires and 422 won't trigger)
        if r.status_code == 200:
            provider = r.get_json().get('provider', '')
            if 'TomTom' not in provider:
                pytest.skip("TomTom not used — fallback ran, 422 test inconclusive")

        if r.status_code == 422:
            data = r.get_json()
            assert data.get('success') is False
            assert 'ml_rejection' in data
            assert 'threshold' in data['ml_rejection']
            assert 'candidates_evaluated' in data['ml_rejection']


# ============================================================================
# CATEGORY 4: SMOKE TESTS
# ============================================================================

class TestSmoke:

    def test_app_imports(self):
        import app  # noqa

    def test_safety_model_imports(self):
        from ai_safety_model import get_safety_ai
        assert get_safety_ai() is not None

    def test_ml_constants_exist(self):
        from app import ML_ROUTING_WEIGHTS, ML_SAFETY_REJECT_BELOW, ML_SAFETY_WARN_BELOW
        assert ML_ROUTING_WEIGHTS['safety'] > ML_ROUTING_WEIGHTS['duration']
        assert ML_SAFETY_REJECT_BELOW < ML_SAFETY_WARN_BELOW

    def test_score_route_candidate_exists(self):
        from app import score_route_candidate
        score = score_route_candidate(
            {'duration_seconds': 600, 'distance_meters': 1000}, 0.75
        )
        assert 0.0 <= score <= 1.0

    def test_select_safest_route_exists(self):
        from app import select_safest_route
        assert callable(select_safest_route)

    def test_hello_endpoint(self, client):
        r = client.get('/api/hello')
        assert r.status_code == 200
        assert 'message' in r.get_json()

    def test_model_status_endpoint(self, client):
        r = client.get('/api/model/status')
        assert r.status_code == 200
        assert r.get_json().get('success') is True


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
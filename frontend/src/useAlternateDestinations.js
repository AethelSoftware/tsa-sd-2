// useAlternateDestinations.js
import { useState, useRef, useCallback } from 'react';

const TOMTOM_API_KEY = import.meta.env.VITE_TOMTOM_API_KEY || 'pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM';
const ALTERNATE_SEARCH_RADIUS_M = 1500;
const ALTERNATE_MAX_DISTANCE_M = 2500;
const MAX_ALTERNATE_DESTINATIONS = 4;

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function inferCategory(destinationName, destinationAddress = '') {
  const name = (destinationName + ' ' + destinationAddress).toLowerCase();
  
  // ── Sports & large venues FIRST ──
  if (/stadium|arena|ballpark|acrisure|pnc park|ppg paints|petersen|consol|heinz field|coliseum|amphitheater|pavilion|sportsplex/.test(name)) return 'stadium';
  if (/theater|theatre|cinema|imax|playhouse|concert hall|performance hall|opera house/.test(name)) return 'theater';
  if (/zoo|aquarium|botanical|planetarium|nature center|natural history|children.s museum/.test(name)) return 'attraction';
  if (/hotel|inn|motel|marriott|hilton|hyatt|sheraton|westin|hampton|courtyard|residence inn/.test(name)) return 'hotel';
  if (/gym|fitness|ymca|rec center|recreation center|crossfit|planet fitness/.test(name)) return 'gym';

  // ── Existing patterns ──
  if (/museum|gallery|exhibit|art|science center/.test(name)) return 'museum';
  if (/hospital|medical|upmc|allegheny health|urgent care|clinic|er |emergency room/.test(name)) return 'medical';
  if (/university|college|school|campus|academy/.test(name)) return 'education';
  if (/coffee|cafe|starbucks|dunkin|espresso|roast/.test(name)) return 'cafe';
  if (/restaurant|dining|kitchen|grill|bar |pub |tavern|bistro|eatery/.test(name)) return 'restaurant';
  if (/park|trail|greenway|reserve|recreation|garden/.test(name)) return 'park';
  if (/mall|shopping|store|shop|market|grocery/.test(name)) return 'shopping';
  if (/pharmacy|cvs|walgreens|rite aid|drug/.test(name)) return 'pharmacy';
  if (/library|public library/.test(name)) return 'library';
  if (/transit|bus stop|station|terminal/.test(name)) return 'transit';
  return 'general';
}

function pointToSegmentDistanceMeters(point, segStart, segEnd) {
  const [pLng, pLat] = point,
    [s1Lng, s1Lat] = segStart,
    [s2Lng, s2Lat] = segEnd;
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(s1Lat),
    λ1 = toRad(s1Lng),
    φ2 = toRad(s2Lat),
    λ2 = toRad(s2Lng),
    φp = toRad(pLat),
    λp = toRad(pLng);
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  const δ13 = Math.acos(
    clamp(
      Math.sin(φ1) * Math.sin(φp) +
        Math.cos(φ1) * Math.cos(φp) * Math.cos(λp - λ1),
    ),
  );
  const δ23 = Math.acos(
    clamp(
      Math.sin(φ2) * Math.sin(φp) +
        Math.cos(φ2) * Math.cos(φp) * Math.cos(λp - λ2),
    ),
  );
  const δ12 = Math.acos(
    clamp(
      Math.sin(φ1) * Math.sin(φ2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1),
    ),
  );
  if (δ13 > δ12 + 1e-10 && δ23 > δ12 + 1e-10)
    return Math.min(
      haversineDistance(s1Lat, s1Lng, pLat, pLng),
      haversineDistance(s2Lat, s2Lng, pLat, pLng),
    );
  const θ12 = Math.acos(
    clamp(
      (Math.sin(φ2) - Math.sin(φ1) * Math.cos(δ12)) /
        (Math.cos(φ1) * Math.sin(δ12)),
    ),
  );
  const θ13 = Math.acos(
    clamp(
      (Math.sin(φp) - Math.sin(φ1) * Math.cos(δ13)) /
        (Math.cos(φ1) * Math.sin(δ13)),
    ),
  );
  const δxt = Math.asin(clamp(Math.sin(δ13) * Math.sin(θ13 - θ12)));
  const distance = Math.abs(δxt) * 6371000;
  return isNaN(distance)
    ? Math.min(
        haversineDistance(s1Lat, s1Lng, pLat, pLng),
        haversineDistance(s2Lat, s2Lng, pLat, pLng),
      )
    : distance;
}

function doesRoutePassThroughHazards(routeCoords, hazards, constructionZones, bufferMeters = 120) {
  const allHazards = [
    ...(hazards || []).filter(h => h.severity >= 0.5).map(h => ({
      lat: h.lat, lng: h.lng,
      radius: (h.radius || 50) + bufferMeters,
      severity: h.severity,
      label: h.description || 'Hazard',
      type: h.type || 'hazard',
      source: h.source || 'unknown'
    })),
    ...(constructionZones || []).map(z => ({
      lat: z.lat, lng: z.lng,
      radius: (z.radius || 50) + bufferMeters,
      severity: 0.7,
      label: z.description || 'Construction',
      type: 'construction',
      source: 'tomtom'
    }))
  ];

  const encounteredHazards = [];

  for (const hazard of allHazards) {
    for (let i = 0; i < routeCoords.length - 1; i++) {
      const segStart = [routeCoords[i][1], routeCoords[i][0]];
      const segEnd = [routeCoords[i+1][1], routeCoords[i+1][0]];
      const hazardPoint = [hazard.lng, hazard.lat];
      
      const dist = pointToSegmentDistanceMeters(hazardPoint, segStart, segEnd);
      if (dist < hazard.radius) {
        if (!encounteredHazards.find(e => e.lat === hazard.lat && e.lng === hazard.lng)) {
          encounteredHazards.push({ ...hazard, distanceFromRoute: dist });
        }
        break;
      }
    }
  }

  return {
    hasHazards: encounteredHazards.length > 0,
    hazards: encounteredHazards,
    worstSeverity: encounteredHazards.reduce((max, h) => Math.max(max, h.severity), 0),
    count: encounteredHazards.length
  };
}

function isDestinationInHazardZone(destLat, destLng, hazards, constructionZones) {
  const allHazards = [
    ...(hazards || []).filter(h => h.severity >= 0.6),
    ...(constructionZones || []).map(z => ({ ...z, severity: 0.7 }))
  ];
  
  for (const hazard of allHazards) {
    const dist = haversineDistance(destLat, destLng, hazard.lat, hazard.lng);
    if (dist < (hazard.radius || 50)) {
      return { inHazard: true, hazard };
    }
  }
  return { inHazard: false, hazard: null };
}

const useAlternateDestinations = () => {
  const [isComputing, setIsComputing] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const cancelComputation = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsComputing(false);
  }, []);

  const computeAlternateDestinations = useCallback(async (
    destLat, destLng, destName, userLat, userLng, hazards, constructionZones, mode
  ) => {
    cancelComputation();
    setIsComputing(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const category = inferCategory(destName, '');
      const CATEGORY_SEARCH_MAP = {
        stadium:    'stadium arena sports venue',
        theater:    'theater cinema performing arts',
        attraction: 'tourist attraction',
        hotel:      'hotel',
        gym:        'gym fitness center',
        museum:     'museum',
        medical:    'hospital',
        education:  'university',
        cafe:       'coffee shop',
        restaurant: 'restaurant',
        park:       'park',
        shopping:   'shopping mall',
        pharmacy:   'pharmacy',
        library:    'library',
        transit:    'transit station',
        general:    'point of interest',
      };
      const categoryQuery = CATEGORY_SEARCH_MAP[category] || 'point of interest';
      
      const RARE_VENUE_CATEGORIES = ['stadium', 'theater', 'attraction', 'hotel'];
      const isRareVenue = RARE_VENUE_CATEGORIES.includes(category);
      const searchRadius = isRareVenue ? 12000 : ALTERNATE_SEARCH_RADIUS_M;
      const maxAllowedDistance = isRareVenue ? 15000 : ALTERNATE_MAX_DISTANCE_M;
      
      const searchUrl = `https://api.tomtom.com/search/2/categorySearch/${encodeURIComponent(categoryQuery)}.json`;
      const searchParams = new URLSearchParams({
        key: TOMTOM_API_KEY,
        lat: destLat,
        lon: destLng,
        radius: searchRadius,
        limit: 12,
        language: 'en-US',
      });

      const poiResponse = await fetch(`${searchUrl}?${searchParams}`, { signal: controller.signal });
      if (!poiResponse.ok) throw new Error(`TomTom search failed: ${poiResponse.status}`);
      const poiData = await poiResponse.json();

      // Robust mapping of lat/lng, handle both 'lon' and 'lng'
      const candidates = (poiData.results || []).map(r => ({
        id: r.id,
        name: r.poi?.name || r.address?.freeformAddress || 'Unknown',
        address: r.address?.freeformAddress || '',
        lat: parseFloat(r.position?.lat ?? 0),
        lng: parseFloat(r.position?.lon ?? r.position?.lng ?? 0),
        category,
      })).filter(c => c.lat !== 0 && c.lng !== 0 && !isNaN(c.lat) && !isNaN(c.lng));

      // Tighter distance guard + NaN check
      const validCandidates = candidates.filter(c => {
        const distFromOriginal = haversineDistance(c.lat, c.lng, destLat, destLng);
        if (isNaN(distFromOriginal)) return false;
        if (distFromOriginal < 80) return false;
        if (distFromOriginal > maxAllowedDistance) return false;
        const { inHazard } = isDestinationInHazardZone(c.lat, c.lng, hazards, constructionZones);
        if (inHazard) return false;
        return true;
      });

      const scored = validCandidates.map(c => {
        const distFromOriginal = haversineDistance(c.lat, c.lng, destLat, destLng);
        const distFromUser = haversineDistance(c.lat, c.lng, userLat, userLng);
        let minHazardDist = Infinity;
        for (const h of [...(hazards || []), ...(constructionZones || [])]) {
          const d = haversineDistance(c.lat, c.lng, h.lat, h.lng);
          if (d < minHazardDist) minHazardDist = d;
        }
        const safetySc = Math.min(1, minHazardDist / 500);
        const maxDist = ALTERNATE_MAX_DISTANCE_M;
        const devSc = 1 - Math.min(1, distFromOriginal / maxDist);
        const proxSc = 1 - Math.min(1, distFromUser / 3000);
        const combined = 0.45 * safetySc + 0.25 * proxSc + 0.30 * devSc;
        return { ...c, distFromOriginal, distFromUser, safetyScore: safetySc, score: combined };
      });

      const top4 = scored.sort((a, b) => b.score - a.score).slice(0, MAX_ALTERNATE_DESTINATIONS);

      const routePromises = top4.map(async candidate => {
        try {
          const routeRes = await fetch('http://127.0.0.1:5000/api/calculate-route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              start_lat: userLat,
              start_lng: userLng,
              end_lat: candidate.lat,
              end_lng: candidate.lng,
              travel_mode: mode === 'transit' ? 'transit' : 'pedestrian',
              accessibility_preferences: { elevator_access: true, wheelchair: mode === 'wheelchair' },
            }),
          });
          if (!routeRes.ok) return null;
          const routeData = await routeRes.json();
          if (!routeData.success || !routeData.route?.coordinates?.length) return null;

          const coords = routeData.route.coordinates.map(c => [c.lat, c.lng]);
          const hazardResult = doesRoutePassThroughHazards(coords, hazards, constructionZones, 80);

          const originalDistFromUser = haversineDistance(userLat, userLng, destLat, destLng);
          const altDistFromUser = candidate.distFromUser;
          const similarities = [];
          const drawbacks = [];

          const CATEGORY_LABELS = {
            stadium: 'Stadium / Arena', theater: 'Theater / Cinema', attraction: 'Tourist Attraction', gym: 'Fitness Center', hotel: 'Hotel',
            museum: 'Museum & Gallery', medical: 'Medical Facility', education: 'Educational Institution',
            cafe: 'Café & Coffee', restaurant: 'Restaurant & Dining', park: 'Park & Green Space',
            shopping: 'Shopping', pharmacy: 'Pharmacy', library: 'Library', transit: 'Transit Stop',
            general: 'Point of Interest',
          };
          similarities.push(`Same category: ${CATEGORY_LABELS[category] || category}`);
          if (Math.abs(altDistFromUser - originalDistFromUser) < 300) similarities.push('Similar walking distance');
          if (hazardResult.count === 0) similarities.push('Hazard-free route');
          if (candidate.distFromOriginal < 600) similarities.push('Very close to original destination');
          
          if (altDistFromUser > originalDistFromUser + 200) {
            drawbacks.push(`${Math.round((altDistFromUser - originalDistFromUser))}m further from your location`);
          }
          if (candidate.distFromOriginal > 800) {
            drawbacks.push(`${Math.round(candidate.distFromOriginal)}m from original destination`);
          }
          if (hazardResult.count > 0) {
            drawbacks.push(`${hazardResult.count} hazard(s) still present`);
          }

          return {
            ...candidate,
            id: `alt_${candidate.id}_${Date.now()}`,
            routeDistance: routeData.route.distance,
            routeDuration: routeData.route.duration,
            routeCoords: coords,
            routeSteps: routeData.route.steps || [],
            hazardCount: hazardResult.count,
            hazardsOnRoute: hazardResult.hazards,
            similarities,
            drawbacks,
            openNow: null,
          };
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          console.error('Route fetch failed for candidate:', candidate.name, err);
          return null;
        }
      });

      const results = await Promise.all(routePromises);
      return results.filter(Boolean);
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Alternate destinations computation aborted');
        return [];
      }
      console.error('Alternate destinations error:', err);
      setError(err.message || 'Failed to compute alternate destinations');
      return [];
    } finally {
      setIsComputing(false);
      abortRef.current = null;
    }
  }, [cancelComputation]);

  return {
    computeAlternateDestinations,
    cancelComputation,
    isComputing,
    error,
  };
};

export default useAlternateDestinations;
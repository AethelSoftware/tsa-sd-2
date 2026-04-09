        # def _fetch_pulsepoint_incidents(self) -> List[Dict[str, Any]]:
        #     """Fetch real-time incidents from PulsePoint API."""
        #     hazards = []
            
        #     if not self.pulsepoint_agency_id:
        #         logger.debug("No PulsePoint agency ID available")
        #         return []
            
        #     try:
        #         url = f"{PULSEPOINT_BASE_URL}/agencies/{self.pulsepoint_agency_id}/incidents"
        #         response = requests.get(url, timeout=10)
                
        #         if response.status_code == 200:
        #             incidents = response.json()
        #             logger.info(f"PulsePoint returned {len(incidents)} active incidents")
                    
        #             for incident in incidents:
        #                 incident_type = incident.get('type', '').lower()
        #                 description = incident.get('description', incident.get('type', 'Emergency Incident'))
        #                 latitude = incident.get('latitude')
        #                 longitude = incident.get('longitude')
                        
        #                 if not latitude or not longitude:
        #                     continue
                        
        #                 hazard_type = PULSEPOINT_TYPE_MAP.get(incident.get('type', ''), 'emergency')
                        
        #                 severity = 0.7
        #                 if 'fire' in incident_type or 'structure' in incident_type:
        #                     severity = 0.85
        #                 elif 'accident' in incident_type or 'crash' in incident_type:
        #                     severity = 0.75
        #                 elif 'rescue' in incident_type:
        #                     severity = 0.8
        #                 elif 'hazmat' in incident_type:
        #                     severity = 0.85
                        
        #                 hazard = {
        #                     'type': hazard_type,
        #                     'description': f"[REAL-TIME] {incident.get('type', 'Emergency')}: {description}",
        #                     'full_description': f"Active emergency: {description}",
        #                     'lat': latitude,
        #                     'lng': longitude,
        #                     'location_name': incident.get('address', 'Pittsburgh area'),
        #                     'severity': severity,
        #                     'source': 'pulsepoint',
        #                     'title': f"🚨 ACTIVE: {incident.get('type', 'Emergency')}",
        #                     'url': '',
        #                     'publisher': 'PulsePoint',
        #                     'published_date': datetime.now().isoformat(),
        #                     'is_active': True,
        #                     'units': incident.get('units', [])
        #                 }
        #                 hazards.append(hazard)
                        
        #         elif response.status_code == 404:
        #             logger.debug("No active incidents from PulsePoint")
        #         else:
        #             logger.warning(f"PulsePoint API returned {response.status_code}")
                    
        #     except requests.exceptions.Timeout:
        #         logger.warning("PulsePoint API timeout")
        #     except Exception as e:
        #         logger.warning(f"PulsePoint fetch failed: {e}")
            
        #     return hazards
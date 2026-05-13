import zipfile
import pandas as pd
from datetime import datetime
import sys
import os

GTFS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'GTFS.zip')
if not os.path.exists(GTFS_PATH):
    GTFS_PATH = 'GTFS.zip'

print("=" * 60)
print("GTFS DIAGNOSTIC")
print("=" * 60)

if not os.path.exists(GTFS_PATH):
    print(f"ERROR: GTFS.zip not found at {GTFS_PATH}")
    sys.exit(1)

print(f"GTFS file: {GTFS_PATH}")
print(f"File size: {os.path.getsize(GTFS_PATH) / 1024:.0f} KB")
print(f"Last modified: {datetime.fromtimestamp(os.path.getmtime(GTFS_PATH))}")
print()

now = datetime.now()
today_int = int(now.strftime('%Y%m%d'))
today_weekday = now.weekday()  # 0=Mon, 6=Sun
day_names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
day_cols = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

print(f"Current datetime: {now}")
print(f"Today as int: {today_int}")
print(f"Day of week: {day_names[today_weekday]}")
print()

with zipfile.ZipFile(GTFS_PATH, 'r') as z:
    files = z.namelist()
    print(f"Files in GTFS.zip: {', '.join(sorted(files))}")
    print()

    # ── CHECK 1: Calendar dates ──
    print("─" * 60)
    print("CHECK 1: Calendar date ranges")
    print("─" * 60)
    
    with z.open('calendar.txt') as f:
        cal_df = pd.read_csv(f, dtype=str)
    
    print(f"Total calendar entries: {len(cal_df)}")
    
    cal_df['start_date_int'] = cal_df['start_date'].astype(int)
    cal_df['end_date_int'] = cal_df['end_date'].astype(int)
    
    min_start = cal_df['start_date_int'].min()
    max_end = cal_df['end_date_int'].max()
    
    print(f"Earliest start_date: {min_start}")
    print(f"Latest end_date:     {max_end}")
    print(f"Today:               {today_int}")
    print()
    
    expired = cal_df[cal_df['end_date_int'] < today_int]
    active = cal_df[(cal_df['start_date_int'] <= today_int) & (cal_df['end_date_int'] >= today_int)]
    future = cal_df[cal_df['start_date_int'] > today_int]
    
    print(f"Expired entries (end_date < today): {len(expired)}")
    print(f"Active entries (start <= today <= end): {len(active)}")
    print(f"Future entries (start_date > today): {len(future)}")
    print()
    
    if len(active) == 0:
        print("⚠️  ALL CALENDAR ENTRIES ARE EXPIRED!")
        print("   This is why transit routing returns no results.")
        print(f"   The feed expired on {max_end}.")
        print()
    else:
        print("✅ Some calendar entries are active")
    
    # Check which services run today (by day of week, ignoring date range)
    today_col = day_cols[today_weekday]
    runs_today_dow = cal_df[cal_df[today_col] == '1']
    print(f"Services running on {day_names[today_weekday]} (day-of-week only): {len(runs_today_dow)}")
    
    # Services that WOULD be active if dates weren't expired
    would_be_active = runs_today_dow[runs_today_dow['end_date_int'] < today_int]
    print(f"  ...of those, blocked by expired end_date: {len(would_be_active)}")
    print()
    
    # Show sample calendar entries
    print("Sample calendar entries:")
    for _, row in cal_df.head(5).iterrows():
        status = "ACTIVE" if int(row['start_date']) <= today_int <= int(row['end_date']) else "EXPIRED"
        runs_today = "YES" if row[today_col] == '1' else "no"
        print(f"  service={row['service_id']}, start={row['start_date']}, end={row['end_date']}, "
              f"{day_names[today_weekday]}={runs_today}, status={status}")
    print()

    # ── CHECK 2: calendar_dates exceptions ──
    print("─" * 60)
    print("CHECK 2: Calendar date exceptions")
    print("─" * 60)
    
    if 'calendar_dates.txt' in files:
        with z.open('calendar_dates.txt') as f:
            cd_df = pd.read_csv(f, dtype=str)
        
        print(f"Total exceptions: {len(cd_df)}")
        
        today_exceptions = cd_df[cd_df['date'] == str(today_int)]
        print(f"Exceptions for today ({today_int}): {len(today_exceptions)}")
        
        if len(today_exceptions) > 0:
            for _, row in today_exceptions.iterrows():
                action = "ADDED" if row['exception_type'] == '1' else "REMOVED"
                print(f"  service={row['service_id']}: {action}")
    else:
        print("No calendar_dates.txt found")
    print()

    # ── CHECK 3: Route 75 specifically ──
    print("─" * 60)
    print("CHECK 3: Bus 75 (Ellsworth) details")
    print("─" * 60)
    
    with z.open('routes.txt') as f:
        routes_df = pd.read_csv(f, dtype=str)
    
    route_75 = routes_df[routes_df['route_short_name'] == '75']
    if len(route_75) == 0:
        route_75 = routes_df[routes_df['route_short_name'].str.contains('75', na=False)]
    
    if len(route_75) > 0:
        print(f"Found Route 75:")
        for _, row in route_75.iterrows():
            print(f"  route_id={row['route_id']}, name={row.get('route_long_name', 'N/A')}")
        
        route_75_ids = route_75['route_id'].tolist()
        
        with z.open('trips.txt') as f:
            trips_df = pd.read_csv(f, dtype=str)
        
        route_75_trips = trips_df[trips_df['route_id'].isin(route_75_ids)]
        print(f"  Total trips for Route 75: {len(route_75_trips)}")
        
        # Check which services these trips use
        route_75_services = route_75_trips['service_id'].unique()
        print(f"  Service IDs used: {route_75_services}")
        
        for svc in route_75_services:
            cal_row = cal_df[cal_df['service_id'] == svc]
            if len(cal_row) > 0:
                row = cal_row.iloc[0]
                runs = row[today_col] == '1'
                expired = int(row['end_date']) < today_int
                print(f"    service={svc}: runs_{day_names[today_weekday]}={runs}, "
                      f"end_date={row['end_date']}, expired={expired}")
        
        # Check stops near Freeport+Delafield
        print()
        print("  Stops near Freeport Rd + Delafield Ave:")
        with z.open('stops.txt') as f:
            stops_df = pd.read_csv(f, dtype=str)
        
        freeport_stops = stops_df[stops_df['stop_name'].str.contains('FREEPORT', case=False, na=False)]
        delafield_stops = freeport_stops[freeport_stops['stop_name'].str.contains('DELAFIELD', case=False, na=False)]
        
        if len(delafield_stops) > 0:
            for _, row in delafield_stops.iterrows():
                print(f"    stop_id={row['stop_id']}, name={row['stop_name']}, "
                      f"lat={row['stop_lat']}, lon={row['stop_lon']}")
        else:
            print("    No stops matching 'FREEPORT' + 'DELAFIELD' found")
            print("    Closest FREEPORT stops:")
            for _, row in freeport_stops.head(5).iterrows():
                print(f"    stop_id={row['stop_id']}, name={row['stop_name']}")
        
        # Check stops near Ellsworth+Aiken
        print()
        print("  Stops near Ellsworth Ave + Aiken Ave:")
        ellsworth_stops = stops_df[stops_df['stop_name'].str.contains('ELLSWORTH', case=False, na=False)]
        aiken_stops = ellsworth_stops[ellsworth_stops['stop_name'].str.contains('AIKEN', case=False, na=False)]
        
        if len(aiken_stops) > 0:
            for _, row in aiken_stops.iterrows():
                print(f"    stop_id={row['stop_id']}, name={row['stop_name']}, "
                      f"lat={row['stop_lat']}, lon={row['stop_lon']}")
        else:
            print("    No stops matching 'ELLSWORTH' + 'AIKEN' found")
            ellsworth_only = ellsworth_stops.head(5)
            for _, row in ellsworth_only.iterrows():
                print(f"    stop_id={row['stop_id']}, name={row['stop_name']}")
        
        # Check if Route 75 actually serves these stops
        print()
        print("  Checking if Route 75 trips serve stop 23121 (Freeport+Delafield)...")
        
        with z.open('stop_times.txt') as f:
            # Only read what we need
            st_df = pd.read_csv(f, dtype=str, usecols=['trip_id', 'stop_id', 'departure_time'])
        
        route_75_trip_ids = route_75_trips['trip_id'].tolist()
        
        # Check stop 23121
        stop_23121_times = st_df[(st_df['stop_id'] == '23121') & (st_df['trip_id'].isin(route_75_trip_ids))]
        print(f"    Route 75 departures from stop 23121: {len(stop_23121_times)}")
        if len(stop_23121_times) > 0:
            sample_times = stop_23121_times['departure_time'].head(5).tolist()
            print(f"    Sample departure times: {sample_times}")
        
        # Check stop 3205 (Freeport+Virginia, also nearby)
        stop_3205_times = st_df[(st_df['stop_id'] == '3205') & (st_df['trip_id'].isin(route_75_trip_ids))]
        print(f"    Route 75 departures from stop 3205 (Freeport+Virginia): {len(stop_3205_times)}")
        
        # Check stop 3207 (Freeport+Eastern, used in your curl test)
        stop_3207_times = st_df[(st_df['stop_id'] == '3207') & (st_df['trip_id'].isin(route_75_trip_ids))]
        print(f"    Route 75 departures from stop 3207 (Freeport+Eastern): {len(stop_3207_times)}")
        if len(stop_3207_times) > 0:
            sample_times = stop_3207_times['departure_time'].head(5).tolist()
            print(f"    Sample departure times: {sample_times}")
        
    else:
        print("Route 75 NOT FOUND in routes.txt!")
        print("Available routes (first 20):")
        for _, row in routes_df.head(20).iterrows():
            print(f"  {row.get('route_short_name', '?')} - {row.get('route_long_name', '?')}")
    
    print()
    print("=" * 60)
    print("DIAGNOSIS SUMMARY")
    print("=" * 60)
    
    if len(active) == 0:
        print(f"❌ GTFS CALENDAR EXPIRED on {max_end}")
        print(f"   Today is {today_int} which is past all end_dates.")
        print(f"   {len(would_be_active)} services WOULD run today if not expired.")
        print()
        print("   FIX: Either:")
        print("   1) Download fresh GTFS.zip from PRT")
        print("   2) Patch _is_service_active() to ignore expired dates")
    else:
        print(f"✅ Calendar is valid ({len(active)} active entries)")
        print()
        print("   If transit still fails, the issue is something else:")
        print("   - Check if departures exist within the time window")
        print("   - Check if the start_time being sent is correct")
        print("   - Add logging to get_next_departure() to see what's filtered")

print()
print("Done.")
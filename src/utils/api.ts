import axios from 'axios';

const GEOAPIFY_API_KEY = "6a1c2b904e094e519db8c42f74e2e595";

// Interface for location search results
export interface LocationSuggestion {
  id: string;
  name: string;
  address: string;
  coordinates: [number, number]; // [lng, lat]
}

// Interface for route information
export interface RouteInfo {
  distance: number; // in meters
  duration: number; // in seconds
  geometry: any; // GeoJSON representing the route
}

// Interface for EV station
export interface EVStation {
  id: string;
  name: string;
  location: [number, number]; // [lng, lat]
  address: string;
  connectors: Connector[];
  isAvailable: boolean;
  isBusy: boolean;
  distanceFromRoute?: number;
  distanceFromStart?: number;
}

// Interface for hotels and restaurants
export interface POI {
  id: string;
  name: string;
  location: [number, number];
  address: string;
  type: 'hotel' | 'restaurant';
  rating?: number;
  distanceFromRoute?: number;
}

// Interface for EV station connector
export interface Connector {
  type: string;
  power: number;
  available: boolean;
}

// Indian EV car models with their battery capacities and ranges
export interface EVModel {
  id: string;
  name: string;
  batteryCapacity: number;
  range: number;
  chargingSpeed: number;
}

export const indianEVModels: EVModel[] = [
  { id: 'tata-nexon', name: 'Tata Nexon EV', batteryCapacity: 40.5, range: 465, chargingSpeed: 50 },
  { id: 'tata-tigor', name: 'Tata Tigor EV', batteryCapacity: 26, range: 306, chargingSpeed: 25 },
  { id: 'mahindra-xuv400', name: 'Mahindra XUV400', batteryCapacity: 39.4, range: 456, chargingSpeed: 50 },
  { id: 'mg-zs', name: 'MG ZS EV', batteryCapacity: 50.3, range: 461, chargingSpeed: 76 },
  { id: 'hyundai-kona', name: 'Hyundai Kona Electric', batteryCapacity: 39.2, range: 452, chargingSpeed: 50 },
  { id: 'kia-ev6', name: 'Kia EV6', batteryCapacity: 77.4, range: 708, chargingSpeed: 240 },
  { id: 'bmw-i4', name: 'BMW i4', batteryCapacity: 83.9, range: 590, chargingSpeed: 200 },
  { id: 'byd-e6', name: 'BYD e6', batteryCapacity: 71.7, range: 415, chargingSpeed: 60 },
  { id: 'mercedes-eqc', name: 'Mercedes-Benz EQC', batteryCapacity: 80, range: 471, chargingSpeed: 110 },
  { id: 'volvo-xc40', name: 'Volvo XC40 Recharge', batteryCapacity: 78, range: 418, chargingSpeed: 150 },
  { id: 'audi-etron', name: 'Audi e-tron', batteryCapacity: 95, range: 484, chargingSpeed: 150 },
  { id: 'jaguar-ipace', name: 'Jaguar I-PACE', batteryCapacity: 90, range: 470, chargingSpeed: 100 },
];

export const searchLocations = async (query: string): Promise<LocationSuggestion[]> => {
  if (!query.trim()) return [];
  try {
    const response = await axios.get(`https://api.geoapify.com/v1/geocode/autocomplete`, {
      params: { text: query, format: 'json', apiKey: GEOAPIFY_API_KEY }
    });
    return response.data.results.map((result: any) => ({
      id: result.place_id || Math.random().toString(),
      name: result.formatted || result.name || 'Unknown location',
      address: result.formatted || '',
      coordinates: [result.lon, result.lat]
    }));
  } catch (error) {
    console.error('Error searching for locations:', error);
    return [];
  }
};

export const getRoute = async (
  start: [number, number],
  end: [number, number]
): Promise<RouteInfo | null> => {
  try {
    const response = await axios.get(`https://api.geoapify.com/v1/routing`, {
      params: {
        waypoints: `${start[1]},${start[0]}|${end[1]},${end[0]}`,
        mode: 'drive',
        apiKey: GEOAPIFY_API_KEY
      }
    });
    const route = response.data.features[0];
    return {
      distance: route.properties.distance,
      duration: route.properties.time,
      geometry: route.geometry
    };
  } catch (error) {
    console.error('Error getting route:', error);
    return null;
  }
};

export const findEVStationsAlongRoute = async (
  routeGeometry: any,
  radiusKm: number,
  startPoint: [number, number],
  endPoint: [number, number]
): Promise<EVStation[]> => {
  try {
    const coordinates = routeGeometry.type === 'LineString' ? routeGeometry.coordinates : routeGeometry.coordinates[0];
    if (!coordinates || coordinates.length === 0) return [];

    const searchPoints = [];
    const totalPoints = coordinates.length;

    for (let i = 0; i < totalPoints; i += Math.max(1, Math.floor(totalPoints / 10))) {
      searchPoints.push(coordinates[i]);
    }

    if (!searchPoints.includes(coordinates[0])) searchPoints.unshift(coordinates[0]);
    const midIndex = Math.floor(totalPoints / 2);
    if (!searchPoints.includes(coordinates[midIndex])) searchPoints.splice(Math.floor(searchPoints.length / 2), 0, coordinates[midIndex]);
    if (!searchPoints.includes(coordinates[totalPoints - 1])) searchPoints.push(coordinates[totalPoints - 1]);

    const stationPromises = searchPoints.map(point => fetchEVStationsNearPoint(point, radiusKm));
    const stationResults = await Promise.all(stationPromises);

    const stationsMap = new Map<string, EVStation>();

    stationResults.flat().forEach(station => {
      if (!stationsMap.has(station.id)) {
        const distanceFromRoute = calculateMinDistanceFromRoute([station.location[0], station.location[1]], coordinates);
        const distanceFromStart = estimateDistanceAlongRoute([station.location[0], station.location[1]], coordinates, startPoint);
        stationsMap.set(station.id, {
          ...station,
          distanceFromRoute: Math.round(distanceFromRoute * 1000),
          distanceFromStart: Math.round(distanceFromStart * 1000)
        });
      }
    });

    const stations = Array.from(stationsMap.values());
    return stations.sort((a, b) => (a.distanceFromStart || 0) - (b.distanceFromStart || 0));
  } catch (error) {
    console.error('Error finding EV stations:', error);
    return [];
  }
};

const fetchEVStationsNearPoint = async (point: number[], radiusKm: number): Promise<EVStation[]> => {
  try {
    const response = await axios.get('https://api.geoapify.com/v2/places', {
      params: {
        categories: 'service.vehicle.charging_station',
        filter: `circle:${point[0]},${point[1]},${radiusKm * 1000}`,
        limit: 50,
        apiKey: GEOAPIFY_API_KEY,
      },
    });
    return response.data.features.map((feature: any) => {
      const props = feature.properties;
      const coords = feature.geometry.coordinates;
      return {
        id: props.place_id || `geoapify-${Math.random().toString(36).substring(2, 9)}`,
        name: props.name || props.address_line1 || 'Charging Station',
        location: [coords[0], coords[1]],
        address: props.formatted || props.address_line1 || 'Unknown address',
        connectors: [{ type: 'Unknown', power: 22, available: true }],
        isAvailable: true,
        isBusy: false
      };
    });
  } catch (error) {
    console.error('Error fetching EV stations from Geoapify:', error);
    return [];
  }
};

export const findPOIsAlongRoute = async (
  routeGeometry: any,
  radiusKm: number,
  poiType: 'hotel' | 'restaurant'
): Promise<POI[]> => {
  try {
    const coordinates = routeGeometry.type === 'LineString' ? routeGeometry.coordinates : routeGeometry.coordinates[0];
    if (!coordinates || coordinates.length === 0) return [];
    const midIndex = Math.floor(coordinates.length / 2);
    const midPoint = coordinates[midIndex];

    const category = poiType === 'hotel' ? 'accommodation.hotel' : 'catering.restaurant';
    const response = await axios.get('https://api.geoapify.com/v2/places', {
      params: {
        categories: category,
        filter: `circle:${midPoint[0]},${midPoint[1]},${radiusKm * 1000}`,
        limit: 10,
        apiKey: GEOAPIFY_API_KEY
      }
    });

    return response.data.features.map((feature: any) => {
      const props = feature.properties;
      const coords = feature.geometry.coordinates;
      const distanceFromRoute = calculateMinDistanceFromRoute([coords[0], coords[1]], coordinates);
      return {
        id: props.place_id || `poi-${Math.random().toString(36).substring(2, 9)}`,
        name: props.name || `${poiType === 'hotel' ? 'Hotel' : 'Restaurant'} ${Math.floor(Math.random() * 100)}`,
        location: [coords[0], coords[1]],
        address: props.formatted || props.address_line1 || `Near ${props.street || 'Main Street'}`,
        type: poiType,
        rating: props.rating || (Math.floor(Math.random() * 30) + 20) / 10,
        distanceFromRoute: Math.round(distanceFromRoute * 1000)
      };
    });
  } catch (error) {
    console.error(`Error finding ${poiType}s:`, error);
    return [];
  }
};

const calculateMinDistanceFromRoute = (point: [number, number], routeCoordinates: number[][]): number => {
  let minDistance = Infinity;
  for (const coord of routeCoordinates) {
    const distance = calculateDistance(point, [coord[0], coord[1]]);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  return minDistance;
};

export const calculateDistance = (point1: [number, number], point2: [number, number]): number => {
  const R = 6371;
  const dLat = (point2[1] - point1[1]) * Math.PI / 180;
  const dLon = (point2[0] - point1[0]) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(point1[1] * Math.PI / 180) * Math.cos(point2[1] * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export const calculateChargingTime = (
  batteryCapacity: number,
  currentPercentage: number,
  targetPercentage: number,
  chargingPower: number
): number => {
  const energyNeeded = batteryCapacity * (targetPercentage - currentPercentage) / 100;
  const hoursNeeded = energyNeeded / chargingPower;
  return Math.round(hoursNeeded * 60);
};

const estimateDistanceAlongRoute = (
  point: [number, number],
  routeCoordinates: number[][],
  startPoint: [number, number]
): number => {
  let closestPointIndex = 0;
  let minDistance = Infinity;
  for (let i = 0; i < routeCoordinates.length; i++) {
    const coord = routeCoordinates[i];
    const distance = calculateDistance(point, [coord[0], coord[1]]);
    if (distance < minDistance) {
      minDistance = distance;
      closestPointIndex = i;
    }
  }
  let distanceAlongRoute = 0;
  for (let i = 0; i < closestPointIndex; i++) {
    distanceAlongRoute += calculateDistance(
      [routeCoordinates[i][0], routeCoordinates[i][1]],
      [routeCoordinates[i+1][0], routeCoordinates[i+1][1]]
    );
  }
  return distanceAlongRoute;
};

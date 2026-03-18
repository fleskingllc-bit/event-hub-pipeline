/**
 * Map coordinates or address to one of 12 areas in Yamaguchi Prefecture.
 * Uses a combination of coordinate boundaries and city name matching.
 */

const AREAS = [
  { name: '下関市', lat: 33.9586, lng: 130.9414, radius: 25 },
  { name: '宇部市', lat: 33.9517, lng: 131.2468, radius: 15 },
  { name: '山口市', lat: 34.1861, lng: 131.4706, radius: 20 },
  { name: '萩市', lat: 34.4073, lng: 131.3990, radius: 20 },
  { name: '防府市', lat: 34.0514, lng: 131.5628, radius: 12 },
  { name: '岩国市', lat: 34.1680, lng: 132.2195, radius: 20 },
  { name: '光市', lat: 33.9613, lng: 131.9422, radius: 12 },
  { name: '長門市', lat: 34.3710, lng: 131.1798, radius: 15 },
  { name: '柳井市', lat: 33.9644, lng: 132.1063, radius: 12 },
  { name: '美祢市', lat: 34.1667, lng: 131.2064, radius: 15 },
  { name: '周南市', lat: 34.0535, lng: 131.8060, radius: 15 },
  { name: '下松市', lat: 34.0131, lng: 131.8701, radius: 10 },
];

/**
 * Calculate distance between two coordinates (km)
 */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Determine area from coordinates
 */
export function mapAreaFromCoords(lat, lng) {
  if (!lat || !lng) return '';

  let nearest = null;
  let minDist = Infinity;

  for (const area of AREAS) {
    const dist = haversine(lat, lng, area.lat, area.lng);
    if (dist < minDist) {
      minDist = dist;
      nearest = area;
    }
  }

  return nearest && minDist <= nearest.radius ? nearest.name : (nearest?.name || '');
}

/**
 * Determine area from address string (fallback when geocoding fails)
 */
export function mapAreaFromAddress(address) {
  if (!address) return '';

  for (const area of AREAS) {
    if (address.includes(area.name)) return area.name;
  }

  // Extended matching
  const aliases = {
    '周南': '周南市',
    '徳山': '周南市',
    '新南陽': '周南市',
    '下松': '下松市',
    '光': '光市',
    '大和': '光市',
    '防府': '防府市',
    '山口': '山口市',
    '小郡': '山口市',
    '下関': '下関市',
    '岩国': '岩国市',
    '柳井': '柳井市',
    '萩': '萩市',
    '長門': '長門市',
    '宇部': '宇部市',
    '美祢': '美祢市',
  };

  for (const [key, area] of Object.entries(aliases)) {
    if (address.includes(key)) return area;
  }

  return '';
}

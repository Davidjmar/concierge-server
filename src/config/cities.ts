export interface CityConfig {
  id: string;
  name: string;
  state: string;
  center: {
    lat: number;
    lng: number;
  };
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  neighborhoods: string[];
  goldenBuzzNeighborhoods: string[];
  westwordUrl: string;
  timezone: string;
}

const CITIES: Record<string, CityConfig> = {
  denver: {
    id: 'denver',
    name: 'Denver',
    state: 'CO',
    center: { lat: 39.7392, lng: -104.9847 },
    bounds: {
      minLat: 39.614,
      maxLat: 39.798,
      minLng: -105.110,
      maxLng: -104.889,
    },
    neighborhoods: [
      'lodo',
      'rino',
      'highlands',
      'lohi',
      'capitol-hill',
      'wash-park',
      'cherry-creek',
      'five-points',
      'baker',
      'sunnyside',
    ],
    goldenBuzzNeighborhoods: [
      'highlands',
      'lodo',
      'rino',
      'lohi',
      'capitol-hill',
      'wash-park',
      'cherry-creek',
      'five-points',
      'baker',
      'sunnyside',
    ],
    westwordUrl: 'https://www.westword.com/arts/things-to-do-in-denver',
    timezone: 'America/Denver',
  },
};

export default CITIES;
export const DENVER = CITIES.denver;

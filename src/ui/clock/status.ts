import type { SpaceWeatherStatus } from '@/engines/spaceWeather';

export const STATUS_LABEL: Record<SpaceWeatherStatus, string> = { quiet: 'Quiet', watch: 'Watch', warning: 'Warning', unknown: 'Unknown' };
export const STATUS_DOT: Record<SpaceWeatherStatus, string> = { quiet: 'bg-ok', watch: 'bg-caution', warning: 'bg-warning', unknown: 'bg-faint' };

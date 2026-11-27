export type AiringEntry = {
  id: string;
  title: string;
  poster?: string;
  episode?: number;
  season?: number;
  airingAt: number;
  timeKnown: boolean;
  network?: string;
  catalog?: string;
  catalogSeason?: number;
};

export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function airingWeek(now: Date, offset: number) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + offset * 7);
  const days = Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  // Calendar arithmetic preserves local midnight during daylight-saving transitions.
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start, end, days };
}

export function airingCountdown(at: number, now: number): string {
  const minutes = Math.ceil((at * 1000 - now) / 60000);
  if (minutes <= 0) return 'Aired';
  if (minutes < 60) return `In ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `In ${hours}h ${minutes % 60}m`;
  return `In ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

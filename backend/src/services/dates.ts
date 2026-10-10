export function todayInTimezone(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) < '1900') return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86_400_000);
}

export function elapsedCalendarTime(start: string, today: string) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const day = Number(today.slice(8));
  const startMonth = Number(start.slice(5, 7));
  const startDay = Number(start.slice(8));
  let months = (year - Number(start.slice(0, 4))) * 12 + month - startMonth;
  // A data de aniversário em meses curtos é o último dia disponível do mês.
  const anniversaryDay = Math.min(startDay, new Date(Date.UTC(year, month, 0)).getUTCDate());
  if (day < anniversaryDay) months--;
  return { years: Math.floor(months / 12), months: months % 12, totalMonths: months };
}

export function ageOn(birthDate: string | null, today: string): number | null {
  return birthDate && birthDate <= today ? elapsedCalendarTime(birthDate, today).years : null;
}

export function nextBirthday(birthDate: string, today: string) {
  const birthdayInYear = (year: number) => {
    const candidate = `${year}-${birthDate.slice(5)}`;
    // Aniversários de 29/02 são lembrados em 28/02 nos anos sem dia 29.
    return isCalendarDate(candidate) ? candidate : `${year}-02-28`;
  };
  const year = Number(today.slice(0, 4));
  const current = birthdayInYear(year);
  const date = current >= today ? current : birthdayInYear(year + 1);
  return { date, daysUntil: daysBetween(today, date), turningAge: Number(date.slice(0, 4)) - Number(birthDate.slice(0, 4)) };
}

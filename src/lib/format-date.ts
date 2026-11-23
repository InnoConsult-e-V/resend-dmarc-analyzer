/**
 * European date and time formatting used across the app: DD.MM.YYYY and 24-hour
 * HH:mm. Built from the date parts directly instead of a browser locale, so the
 * output is identical on every machine.
 *
 * `utc: true` formats the UTC calendar day/time (used for report days, which
 * are UTC); otherwise the viewer's local time zone is used.
 */

type DateInput = Date | string | number;
interface Options {
  utc?: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

function parts(input: DateInput, { utc = false }: Options) {
  const d = new Date(input);
  return utc
    ? {
        day: d.getUTCDate(),
        month: d.getUTCMonth() + 1,
        year: d.getUTCFullYear(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        valid: !Number.isNaN(d.getTime()),
      }
    : {
        day: d.getDate(),
        month: d.getMonth() + 1,
        year: d.getFullYear(),
        hour: d.getHours(),
        minute: d.getMinutes(),
        valid: !Number.isNaN(d.getTime()),
      };
}

/** 23.11.2026 */
export function formatDate(input: DateInput, options: Options = {}): string {
  const p = parts(input, options);
  return p.valid ? `${pad(p.day)}.${pad(p.month)}.${p.year}` : '-';
}

/** 23.11.2026 13:55 */
export function formatDateTime(
  input: DateInput,
  options: Options = {},
): string {
  const p = parts(input, options);
  return p.valid
    ? `${pad(p.day)}.${pad(p.month)}.${p.year} ${pad(p.hour)}:${pad(p.minute)}`
    : '-';
}

/** 23.11. (short form for chart axes; add the year with `withYear`) */
export function formatDayMonth(
  input: DateInput,
  options: Options & { withYear?: boolean } = {},
): string {
  const p = parts(input, options);
  if (!p.valid) {
    return '-';
  }
  const base = `${pad(p.day)}.${pad(p.month)}.`;
  return options.withYear ? `${base}${String(p.year).slice(-2)}` : base;
}

/** Mon 23.11.2026 */
export function formatWeekdayDate(
  input: DateInput,
  options: Options = {},
): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    return '-';
  }
  const weekday = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    timeZone: options.utc ? 'UTC' : undefined,
  }).format(d);
  return `${weekday} ${formatDate(d, options)}`;
}

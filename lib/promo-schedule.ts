/**
 * Programación de las promociones: días de la semana, franja horaria y, opcionalmente,
 * fechas desde/hasta. Se evalúa siempre en hora de Mendoza, así da lo mismo la zona
 * horaria del teléfono del cliente o del servidor.
 *
 * Una promo sin días u horario cargados no está programada y no se muestra.
 */

export type PromoSchedule = {
  /** 0 = domingo … 6 = sábado */
  days: number[];
  /** "19:00" */
  timeStart: string;
  /** "23:00". Si es menor o igual al inicio, la franja termina al día siguiente (ej. 20:00 a 02:00). */
  timeEnd: string;
  /** "2026-12-24", opcional */
  dateFrom?: string;
  /** "2026-12-31", opcional e inclusive */
  dateTo?: string;
};

export const SCHEDULE_TIME_ZONE = "America/Argentina/Mendoza";
export const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function localParts(at: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: SCHEDULE_TIME_ZONE,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS_EN.indexOf(parts.weekday),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function isScheduleReady(schedule?: PromoSchedule | null): schedule is PromoSchedule {
  return !!schedule
    && Array.isArray(schedule.days) && schedule.days.length > 0
    && TIME_RE.test(schedule.timeStart ?? "") && TIME_RE.test(schedule.timeEnd ?? "");
}

function inDateRange(schedule: PromoSchedule, date: string) {
  return (!schedule.dateFrom || date >= schedule.dateFrom) && (!schedule.dateTo || date <= schedule.dateTo);
}

/** ¿La promo está dentro de su día y horario programados en este momento? */
export function isScheduleActive(schedule: PromoSchedule | null | undefined, now: Date = new Date()): boolean {
  if (!isScheduleReady(schedule)) return false;
  const start = toMinutes(schedule.timeStart);
  const end = toMinutes(schedule.timeEnd);
  const today = localParts(now);
  const crossesMidnight = end <= start;

  // Franja que empezó hoy
  if (schedule.days.includes(today.weekday) && inDateRange(schedule, today.date)
    && today.minutes >= start && (crossesMidnight || today.minutes < end)) return true;

  // Franja que empezó ayer y sigue después de la medianoche
  if (crossesMidnight && today.minutes < end) {
    const yesterday = localParts(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    if (schedule.days.includes(yesterday.weekday) && inDateRange(schedule, yesterday.date)) return true;
  }
  return false;
}

const formatDate = (date: string) => date.split("-").reverse().slice(0, 2).join("/");

/** «Jue y Vie · 19:00 a 23:00 · del 24/12 al 31/12» */
export function describeSchedule(schedule?: PromoSchedule | null): string {
  if (!isScheduleReady(schedule)) return "Sin programar";
  const days = [...schedule.days].sort((a, b) => a - b);
  const dayText = days.length === 7 ? "Todos los días" : days.map((d) => WEEKDAY_LABELS[d]).join(", ").replace(/, ([^,]*)$/, " y $1");
  const dates = schedule.dateFrom && schedule.dateTo ? ` · del ${formatDate(schedule.dateFrom)} al ${formatDate(schedule.dateTo)}`
    : schedule.dateFrom ? ` · desde el ${formatDate(schedule.dateFrom)}`
    : schedule.dateTo ? ` · hasta el ${formatDate(schedule.dateTo)}`
    : "";
  return `${dayText} · ${schedule.timeStart} a ${schedule.timeEnd}${dates}`;
}

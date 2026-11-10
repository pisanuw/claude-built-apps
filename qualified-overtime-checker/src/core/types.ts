/** Shared types of the overtime engine. Money is in dollars, hours in decimal hours. */

/** What a line of pay is, for the FLSA regular rate (29 CFR 778). */
export type LineKind =
  /** Hours worked at a straight-time hourly rate. */
  | 'work'
  /**
   * Hours worked that the payroll already paid at an overtime rate (1.5x or
   * 2x). The hours count as hours worked at the straight rate (rate divided by
   * the multiplier); the extra is premium the employer paid.
   */
  | 'overtime'
  /**
   * Pay for time not worked (holiday, vacation, sick, PTO): neither the hours
   * nor the pay enter the regular rate (29 CFR 778.218-219).
   */
  | 'excluded';

export interface TimeLine {
  employeeKey: string;
  employeeId: string;
  employeeName: string;
  /** Work date, ISO YYYY-MM-DD. */
  date: string;
  hours: number;
  /** Rate paid for these hours as the export shows it (an overtime line's is the overtime rate). */
  rate: number;
  kind: LineKind;
  /** 1.5 or 2 for an overtime line, 1 otherwise. */
  multiplier: number;
  /** Pay date of the check that paid these hours, ISO, or null when the export has none. */
  payDate: string | null;
  /** The pay code or item as exported, for the worksheet. */
  code: string;
  /** Source line in the import file. */
  line: number;
}

export interface Employee {
  key: string;
  id: string;
  name: string;
}

export interface EmployerSettings {
  name: string;
  /** The W-2 tax year being checked. */
  taxYear: number;
  /** First day of the employer's fixed workweek, 0 = Sunday. */
  workweekStart: number;
}

export interface RateHours {
  rate: number;
  hours: number;
}

export interface WeekResult {
  /** ISO first and last day of the workweek. */
  start: string;
  end: string;
  /** Hours worked (excluded pay not counted). */
  hours: number;
  /** All straight-time pay for the hours worked. */
  straightPay: number;
  /** Straight-time pay divided by hours worked; 0 for a week with no hours. */
  regularRate: number;
  overtimeHours: number;
  /** Half the regular rate times the overtime hours, rounded to the cent. */
  premium: number;
  /** Straight-time hours by rate, highest hours first. */
  rates: RateHours[];
  /** Premium the payroll paid on overtime-coded lines, or null when it paid none that way. */
  paidPremium: number | null;
  /** Pay date the week's overtime is paid on (latest pay date in the week), or null. */
  payDate: string | null;
  /** The W-2 year this week's premium belongs to. */
  taxYear: number;
  /** True when the tax year comes from the week's end date because no pay date was given. */
  yearFromWeekEnd: boolean;
  notes: string[];
}

export interface EmployeeWeeks {
  employee: Employee;
  weeks: WeekResult[];
}

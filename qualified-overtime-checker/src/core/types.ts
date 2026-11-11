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
  | 'excluded'
  /**
   * A non-discretionary bonus, commission or incentive: pay with no hours,
   * earned over a period. It is allocated back to the workweeks of that
   * period and raises their regular rate (29 CFR 778.209-210).
   */
  | 'bonus'
  /**
   * Other pay that belongs in the regular rate of the week it was earned:
   * a shift differential or premium paid as its own line (29 CFR 778.207).
   * Its amount adds to the week's pay; it adds no hours.
   */
  | 'extra';

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
  /** The pay of a bonus or extra line (its hours are 0). */
  amount?: number;
  /** The period a bonus was earned over, ISO, when the export says. */
  earnedFrom?: string | null;
  earnedTo?: string | null;
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

/** The calendar period a bonus line covers when the export gives no dates. */
export type BonusPeriod = 'week' | 'month' | 'quarter' | 'year';
/** How a bonus is spread over the weeks it covers (29 CFR 778.209(b)). */
export type BonusAllocation = 'per-week' | 'per-hour';

export interface EmployerSettings {
  name: string;
  /** The W-2 tax year being checked. */
  taxYear: number;
  /** First day of the employer's fixed workweek, 0 = Sunday. */
  workweekStart: number;
  /**
   * The minimum wage a tip-credit employee's cash wage plus tip credit adds up
   * to. Hours paid below it count at it in the regular rate (29 CFR 531.60).
   */
  minimumWage: number;
  bonusPeriod: BonusPeriod;
  bonusAllocation: BonusAllocation;
}

export const DEFAULT_SETTINGS: Omit<EmployerSettings, 'name'> = {
  taxYear: 2026,
  workweekStart: 0,
  minimumWage: 7.25,
  bonusPeriod: 'week',
  bonusAllocation: 'per-week',
};

/** Settings saved before milestone 3 lack the newer fields. */
export function withDefaults(s: Partial<EmployerSettings>): EmployerSettings {
  return { name: '', ...DEFAULT_SETTINGS, ...s };
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
  /** Half the regular rate times the overtime hours, before any bonus, rounded to the cent. */
  flsaPremium: number;
  /**
   * The qualified premium of the week itself: flsaPremium, or the premium
   * actually paid on its overtime lines when that is less.
   */
  basePremium: number;
  /** Bonus shares allocated to this week, each with the premium it adds. */
  bonusParts: BonusPart[];
  /** basePremium plus every bonus part's premium (they may fall in other tax years). */
  premium: number;
  /** Differentials and other includable pay with no hours, in straightPay. */
  extraPay: number;
  /** True when hours paid below the minimum wage were counted at it (tip credit). */
  tipCredit: boolean;
  /** The tip credit counted in straightPay: hours x (minimum wage - cash wage). */
  tipCreditPay: number;
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

export interface BonusPart {
  /** The share of the bonus allocated to the week. */
  amount: number;
  /** The overtime premium the share adds: amount / hours x half x overtime hours. */
  premium: number;
  /** When the bonus was paid; the added premium is paid then. */
  payDate: string;
  taxYear: number;
  /** "Bonus paid Mar 31, 2026" for the worksheet. */
  label: string;
}

export interface EmployeeWeeks {
  employee: Employee;
  weeks: WeekResult[];
  /** Bonuses that fell on no worked week of their period, and so raise no rate. */
  unallocated: { label: string; amount: number }[];
}

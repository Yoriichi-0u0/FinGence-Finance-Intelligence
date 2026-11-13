import { describe, expect, it } from "vitest";
import {
  formatReportDate,
  formatReportMoney,
  formatReportMonth,
  formatReportPeriod,
  formatReportPeriodHeading,
  formatReportTimestamp,
} from "../../lib/ai-reporting";

describe("management report presentation", () => {
  it("formats monetary values without converting exact decimal strings to numbers", () => {
    expect(formatReportMoney("MYR", "2129.4")).toBe("RM 2,129.40");
    expect(formatReportMoney("MYR", "-1500")).toBe("-RM 1,500.00");
    expect(formatReportMoney("USD", "12345678901234567890.1234")).toBe("USD 12,345,678,901,234,567,890.1234");
    expect(formatReportMoney(null, "42")).toBe("Currency not specified 42.00");
  });

  it("formats ISO reporting dates consistently without changing their stored values", () => {
    expect(formatReportDate("2026-09-01")).toBe("1 September 2026");
    expect(formatReportPeriod("2026-09-01", "2026-09-10")).toBe("1 September 2026 to 10 September 2026");
    expect(formatReportPeriod("2026-09-01", "2026-09-01")).toBe("1 September 2026");
    expect(formatReportPeriodHeading("2026-07-01", "2026-09-30")).toBe("Quarter ended 30 September 2026");
    expect(formatReportPeriodHeading("2026-01-01", "2026-12-31")).toBe("Year ended 31 December 2026");
    expect(formatReportPeriodHeading("2025-09-01", "2026-08-31")).toBe("Period from 1 September 2025 to 31 August 2026");
    expect(formatReportMonth("2026-09")).toBe("September 2026");
    expect(formatReportTimestamp("2026-10-29T12:05:00.000Z", "Asia/Kuching")).toContain("29 October 2026");
    expect(formatReportTimestamp("not-a-date", "Asia/Kuching")).toBe("not-a-date");
  });
});

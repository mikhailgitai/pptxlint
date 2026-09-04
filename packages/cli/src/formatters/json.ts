import type { CommandReport } from "../report.js";

export function formatJson(report: CommandReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

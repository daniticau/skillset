import { describe, it, expect } from "vitest";
import { buildTaskXml, TASK_NAME } from "../src/core/scheduler/windows.js";

describe("buildTaskXml", () => {
  const baseOpts = {
    atTime: "02:00",
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    cliPath: "C:\\Users\\tester\\dev\\skillset\\dist\\cli.js",
    wakeToRun: true,
  } as const;

  it("produces valid XML prologue", () => {
    const xml = buildTaskXml(baseOpts);
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-16"\?>/);
    expect(xml).toContain("<Task");
    expect(xml).toContain("</Task>");
  });

  it("includes the task name in URI (escaped)", () => {
    const xml = buildTaskXml(baseOpts);
    expect(xml).toContain(`<URI>\\${TASK_NAME}</URI>`);
  });

  it("sets CalendarTrigger with today's date + provided time", () => {
    const xml = buildTaskXml({ ...baseOpts, atTime: "03:30" });
    expect(xml).toMatch(/<StartBoundary>\d{4}-\d{2}-\d{2}T03:30:00<\/StartBoundary>/);
    expect(xml).toContain("<DaysInterval>1</DaysInterval>");
  });

  it("escapes CLI paths with spaces or quotes in Arguments", () => {
    const xml = buildTaskXml({
      ...baseOpts,
      cliPath: "C:\\Users\\Jane Doe\\dev\\skillset\\dist\\cli.js",
    });
    // Whole Arguments is a single quoted CLI path followed by cycle flags
    expect(xml).toContain(
      "&quot;C:\\Users\\Jane Doe\\dev\\skillset\\dist\\cli.js&quot; cycle --nightly --scheduled"
    );
  });

  it("WakeToRun toggles correctly", () => {
    expect(buildTaskXml({ ...baseOpts, wakeToRun: true })).toContain(
      "<WakeToRun>true</WakeToRun>"
    );
    expect(buildTaskXml({ ...baseOpts, wakeToRun: false })).toContain(
      "<WakeToRun>false</WakeToRun>"
    );
  });

  it("sets ExecutionTimeLimit=PT2H", () => {
    expect(buildTaskXml(baseOpts)).toContain("<ExecutionTimeLimit>PT2H</ExecutionTimeLimit>");
  });

  it("sets StartWhenAvailable=true for catch-up after machine-off", () => {
    expect(buildTaskXml(baseOpts)).toContain(
      "<StartWhenAvailable>true</StartWhenAvailable>"
    );
  });

  it("sets RunLevel=LeastPrivilege (no admin required)", () => {
    expect(buildTaskXml(baseOpts)).toContain(
      "<RunLevel>LeastPrivilege</RunLevel>"
    );
  });

  it("sets LogonType=InteractiveToken (user-scope)", () => {
    expect(buildTaskXml(baseOpts)).toContain(
      "<LogonType>InteractiveToken</LogonType>"
    );
  });
});

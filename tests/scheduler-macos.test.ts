import { describe, it, expect } from "vitest";
import { buildDreamPlist, DREAM_LABEL, parseAtTime } from "../src/core/scheduler/macos.js";

describe("buildDreamPlist", () => {
  const baseOpts = {
    atTime: "02:00",
    nodePath: "/opt/homebrew/bin/node",
    cliPath: "/Users/tester/dev/skillset/dist/cli.js",
  } as const;

  it("produces a LaunchAgent plist with the dream label", () => {
    const plist = buildDreamPlist(baseOpts);
    expect(plist).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(plist).toContain(`<string>${DREAM_LABEL}</string>`);
    expect(plist).toContain("</plist>");
  });

  it("sets StartCalendarInterval from HH:MM", () => {
    const plist = buildDreamPlist({ ...baseOpts, atTime: "03:30" });
    expect(plist).toContain("<key>Hour</key>");
    expect(plist).toContain("<integer>3</integer>");
    expect(plist).toContain("<key>Minute</key>");
    expect(plist).toContain("<integer>30</integer>");
  });

  it("runs node cli.js dream --run-now --scheduled", () => {
    const plist = buildDreamPlist(baseOpts);
    expect(plist).toContain("<string>/opt/homebrew/bin/node</string>");
    expect(plist).toContain("<string>/Users/tester/dev/skillset/dist/cli.js</string>");
    expect(plist).toContain("<string>dream</string>");
    expect(plist).toContain("<string>--run-now</string>");
    expect(plist).toContain("<string>--scheduled</string>");
  });

  it("validates 24-hour HH:MM times", () => {
    expect(parseAtTime("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(() => parseAtTime("24:00")).toThrow(/invalid time/);
  });
});

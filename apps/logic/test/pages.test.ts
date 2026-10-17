import { describe, expect, it } from "vitest";
import * as pages from "../src/pages";

// The pages' scripts only run in a browser, so a syntax slip would otherwise
// go unnoticed until the demo. Each must at least parse.
describe("demo pages", () => {
  for (const [name, html] of Object.entries(pages)) {
    it(`${name} has a script that parses`, () => {
      const scripts = [...String(html).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      expect(scripts.length).toBeGreaterThan(0);
      for (const script of scripts) expect(() => new Function(script)).not.toThrow();
    });
  }
});

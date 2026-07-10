import { describe, expect, it } from "vitest";
import { shouldSkipAutoRefresh } from "./refreshGuard";

function element(tagName: string, contenteditable?: string): Element {
  return {
    tagName,
    getAttribute(name: string) {
      return name === "contenteditable" ? (contenteditable ?? null) : null;
    }
  } as Element;
}

function root(isHovered: boolean): Element {
  return {
    matches(selector: string) {
      return selector === ":hover" && isHovered;
    }
  } as Element;
}

describe("shouldSkipAutoRefresh", () => {
  it("skips refresh while form controls are active", () => {
    expect(shouldSkipAutoRefresh(element("INPUT"))).toBe(true);
    expect(shouldSkipAutoRefresh(element("select"))).toBe(true);
    expect(shouldSkipAutoRefresh(element("textarea"))).toBe(true);
  });

  it("skips refresh while editable content is active", () => {
    expect(shouldSkipAutoRefresh(element("div", "true"))).toBe(true);
    expect(shouldSkipAutoRefresh(element("div", ""))).toBe(true);
  });

  it("allows refresh for ordinary elements", () => {
    expect(shouldSkipAutoRefresh(null)).toBe(false);
    expect(shouldSkipAutoRefresh(element("button"))).toBe(false);
    expect(shouldSkipAutoRefresh(element("div", "false"))).toBe(false);
  });

  it("skips refresh while the app surface is hovered", () => {
    expect(shouldSkipAutoRefresh(null, root(true))).toBe(true);
    expect(shouldSkipAutoRefresh(element("button"), root(true))).toBe(true);
    expect(shouldSkipAutoRefresh(element("button"), root(false))).toBe(false);
  });

  it("skips refresh while the pointer is inside the app surface", () => {
    expect(shouldSkipAutoRefresh(null, root(false), true)).toBe(true);
    expect(shouldSkipAutoRefresh(element("button"), root(false), true)).toBe(true);
  });
});

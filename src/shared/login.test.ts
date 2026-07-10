import { describe, expect, it } from "vitest";
import { assertValidLogin, normalizeLogin } from "./login";

describe("normalizeLogin", () => {
  it("normalizes Twitch URLs, casing, and @ prefixes", () => {
    expect(normalizeLogin(" https://www.twitch.tv/Summit1G?foo=bar ")).toBe(
      "summit1g"
    );
    expect(normalizeLogin("@Some_Channel")).toBe("some_channel");
  });

  it("rejects empty logins after normalization", () => {
    expect(() => assertValidLogin("!!!")).toThrow("Enter a Twitch channel login.");
  });
});

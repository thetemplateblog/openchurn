import { describe, expect, it } from "vitest";
import { offerLink } from "./offer-url.js";

describe("offerLink", () => {
  it("keeps an http(s) address", () => {
    expect(offerLink("https://www.chase.com/personal/checking")).toBe("https://www.chase.com/personal/checking");
    expect(offerLink("  http://key.com/smart ")).toBe("http://key.com/smart");
  });
  it("adds https:// when the scheme is missing", () => {
    expect(offerLink("chase.com/checking")).toBe("https://chase.com/checking");
    expect(offerLink("www.truist.com")).toBe("https://www.truist.com/");
  });
  it("refuses anything that isn't a web address", () => {
    expect(offerLink("javascript:alert(1)")).toBeNull();
    expect(offerLink("JavaScript:alert(1)")).toBeNull();
    expect(offerLink("data:text/html,hi")).toBeNull();
    expect(offerLink("mailto:a@b.com")).toBeNull();
    expect(offerLink("not a url")).toBeNull();
    expect(offerLink("localhost")).toBeNull();
  });
  it("is null when empty", () => {
    expect(offerLink("")).toBeNull();
    expect(offerLink("   ")).toBeNull();
  });
});

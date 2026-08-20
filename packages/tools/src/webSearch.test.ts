import { describe, expect, it } from "vitest";
import { parseDuckDuckGoResults } from "./webSearch.js";

const SAMPLE_HTML = `
<html><body>
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=x">
    Example <b>Docs</b>
  </a>
  <a class="result__snippet" href="#">Official docs &amp; guides</a>
  <a class="result__a" href="https://other.example/path">Second Hit</a>
  <td class="result__snippet">Plain table snippet</td>
  <a class="result__a" href="https://third.example">Third</a>
  <td class="result__snippet">Ignored when limit is 2</td>
</body></html>
`;

describe("parseDuckDuckGoResults", () => {
  it("extracts title, absolute URL, and snippet from lite HTML", () => {
    const hits = parseDuckDuckGoResults(SAMPLE_HTML, 5);
    expect(hits).toEqual([
      {
        title: "Example Docs",
        url: "https://example.com/docs",
        snippet: "Official docs & guides",
      },
      {
        title: "Second Hit",
        url: "https://other.example/path",
        snippet: "Plain table snippet",
      },
      {
        title: "Third",
        url: "https://third.example",
        snippet: "Ignored when limit is 2",
      },
    ]);
  });

  it("respects the result limit", () => {
    expect(parseDuckDuckGoResults(SAMPLE_HTML, 2)).toHaveLength(2);
  });

  it("returns an empty list when the markup does not match", () => {
    expect(parseDuckDuckGoResults("<html><body>no results</body></html>", 5)).toEqual([]);
  });
});

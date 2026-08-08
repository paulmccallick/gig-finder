import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  parseDocumentViewerPath,
} from "../../client/DocumentViewer";
import { MarkdownRenderer } from "../../client/MarkdownRenderer";

describe("document viewer route", () => {
  test("accepts one encoded managed reference and positive version", () => {
    expect(parseDocumentViewerPath(
      "/documents/doc_11111111-1111-4111-8111-111111111111/versions/2",
    )).toEqual({
      reference: "doc_11111111-1111-4111-8111-111111111111",
      version: 2,
    });
    expect(parseDocumentViewerPath("/documents/not-managed/versions/2")).toBeNull();
    expect(parseDocumentViewerPath("/documents/..%2Fprivate/versions/2")).toBeNull();
    expect(parseDocumentViewerPath(
      "/documents/doc_11111111-1111-4111-8111-111111111111/versions/0",
    )).toBeNull();
  });
});

describe("document Markdown renderer", () => {
  test("renders GFM with react-markdown and excludes HTML and unsafe links", () => {
    const markdown = [
      "# Role brief",
      "",
      "| Area | Signal |",
      "| --- | --- |",
      "| Scope | ~~Weak~~ Strong |",
      "",
      "[Safe](https://example.com) [Unsafe](javascript:alert(1))",
      "",
      "```mermaid",
      "flowchart LR",
      "  A --> B",
      "```",
      "",
      "<script>window.compromised = true</script>",
    ].join("\n");
    const markup = renderToStaticMarkup(createElement(MarkdownRenderer, null, markdown));
    expect(markup).toContain("<h1>Role brief</h1>");
    expect(markup).toContain("<table>");
    expect(markup).toContain("<del>Weak</del>");
    expect(markup).toContain('href="https://example.com"');
    expect(markup).toContain('aria-label="Rendering diagram"');
    expect(markup).not.toContain("javascript:");
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("window.compromised");
  });
});

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  parseDocumentViewerPath,
} from "../../client/DocumentViewer";
import {
  leaveDocumentView,
  parseScoutDescriptionViewerPath,
} from "../../client/DocumentViewShell";
import { initialWorkspaceView } from "../../client/App";
import { MarkdownRenderer } from "../../client/MarkdownRenderer";
import {
  loadedManagedDocumentForLocation,
  parseManagedDocumentViewData,
  type LoadedManagedDocument,
  type ManagedDocumentViewData,
} from "../../client/data/documents";

describe("document viewer route", () => {
  test("validates the exact managed document version response", () => {
    const location = {
      reference: "doc_11111111-1111-4111-8111-111111111111",
      version: 2,
    };
    const response: ManagedDocumentViewData = {
      ...location,
      storage: "managed",
      displayName: "Synthetic role",
      documentType: "job_description",
      mediaType: "text/markdown",
      currentVersion: 2,
      content: "# Synthetic role",
    };

    expect(parseManagedDocumentViewData(response, location)).toEqual(response);
    expect(() => parseManagedDocumentViewData({ ...response, version: 1 }, location)).toThrow(
      "The document service returned an invalid response.",
    );
    expect(() => parseManagedDocumentViewData({
      ...response,
      reference: "doc_22222222-2222-4222-8222-222222222222",
    }, location)).toThrow("The document service returned an invalid response.");
  });

  test("stale loaded content is ineligible for a refreshed document location", () => {
    const document: ManagedDocumentViewData = {
      reference: "doc_11111111-1111-4111-8111-111111111111",
      version: 1,
      storage: "managed",
      displayName: "Earlier synthetic role",
      documentType: "job_description",
      mediaType: "text/markdown",
      currentVersion: 1,
      content: "# Earlier synthetic role",
    };
    const loaded: LoadedManagedDocument = {
      location: { reference: document.reference, version: document.version },
      document,
    };

    expect(loadedManagedDocumentForLocation(loaded, {
      reference: document.reference,
      version: 2,
    })).toBeNull();
    expect(loadedManagedDocumentForLocation(loaded, {
      reference: "doc_22222222-2222-4222-8222-222222222222",
      version: 1,
    })).toBeNull();
    expect(loadedManagedDocumentForLocation(loaded, loaded.location)).toBe(document);
  });

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

  test("Scout description viewer accepts one opaque position id", () => {
    expect(parseScoutDescriptionViewerPath(
      "/gig-scout/positions/spos_0123456789abcdef/description",
    )).toEqual({ positionId: "spos_0123456789abcdef" });
    expect(parseScoutDescriptionViewerPath(
      "/gig-scout/positions/..%2Fprivate/description",
    )).toBeNull();
  });

  test("document Back closes an opener-created context", () => {
    const events: string[] = [];
    const navigation = {
      hasOpenOpener: true,
      historyLength: 1,
      close: () => events.push("close"),
      back: () => events.push("back"),
      assign: (href: string) => events.push(`assign:${href}`),
    };
    expect(leaveDocumentView(navigation, "/?workspace=scout")).toBe("closed");
    expect(events).toEqual(["close"]);
  });

  test("document Back uses history and then the Scout fallback", () => {
    const historyEvents: string[] = [];
    expect(leaveDocumentView({
      hasOpenOpener: false,
      historyLength: 2,
      close: () => historyEvents.push("close"),
      back: () => historyEvents.push("back"),
      assign: href => historyEvents.push(`assign:${href}`),
    }, "/?workspace=scout")).toBe("history");
    expect(historyEvents).toEqual(["back"]);

    const fallbackEvents: string[] = [];
    expect(leaveDocumentView({
      hasOpenOpener: false,
      historyLength: 1,
      close: () => fallbackEvents.push("close"),
      back: () => fallbackEvents.push("back"),
      assign: href => fallbackEvents.push(`assign:${href}`),
    }, "/?workspace=scout")).toBe("fallback");
    expect(fallbackEvents).toEqual(["assign:/?workspace=scout"]);
    expect(initialWorkspaceView("?workspace=scout")).toBe("scout");
  });
});

describe("document Markdown renderer", () => {
  test("routes fenced Mermaid through the shared safe renderer", () => {
    const markdown = [
      "```mermaid",
      "flowchart LR",
      "  A --> B",
      "```",
      "",
      "<script>window.compromised = true</script>",
    ].join("\n");
    const markup = renderToStaticMarkup(createElement(MarkdownRenderer, null, markdown));
    expect(markup).toContain('aria-label="Rendering diagram"');
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("window.compromised");
  });
});

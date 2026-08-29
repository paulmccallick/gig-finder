import { expect, test } from "bun:test";
import {
  descriptionToMarkdown,
  normalizeExtractedDescription,
  scoutDescriptionConverterVersion,
} from "../../sourcing/descriptions";

test("plain official descriptions are stored without editorial alteration",()=>{const source="Heading\r\n  punctuation — unchanged\n\nLast line  ";expect(descriptionToMarkdown(source,"text/plain")).toBe(source);});
test("HTML descriptions retain headings, lists, links, and visible wording",()=>{const result=descriptionToMarkdown('<h2>Role &amp; scope</h2><ul><li>Lead teams.</li><li><a href="https://example.test/area">Own delivery</a></li></ul>',"text/html");expect(result).toContain("## Role & scope");expect(result).toContain("Lead teams.");expect(result).toContain("[Own delivery](https://example.test/area)");});
test("description size is enforced after authoritative HTML extraction",()=>{const source=`<!--${"x".repeat(200_001)}--><p>Complete description.</p>`;expect(descriptionToMarkdown(source,"text/html")).toBe("Complete description.");});

test("configured entity-encoded HTML matches literal HTML", () => {
  const literal = "<h2>Scope &amp; impact</h2><ul><li>Lead teams.</li></ul>";
  const encoded = "&lt;h2&gt;Scope &amp;amp; impact&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Lead teams.&lt;/li&gt;&lt;/ul&gt;";
  expect(normalizeExtractedDescription(encoded, {
    contentFormat: "html",
    contentEncoding: "html-entities",
  })).toBe(normalizeExtractedDescription(literal, {
    contentFormat: "html",
    contentEncoding: "none",
  }));
});

test("configured decoding stops after two passes", () => {
  expect(normalizeExtractedDescription(
    "&amp;lt;p&amp;gt;Lead systems.&amp;lt;/p&amp;gt;",
    { contentFormat: "html", contentEncoding: "html-entities" },
  )).toBe("Lead systems.");
});

test("plain literal entity examples are unchanged", () => {
  expect(normalizeExtractedDescription(
    "Use &lt;div&gt; as a literal example.",
    { contentFormat: "plain-text", contentEncoding: "none" },
  )).toBe("Use &lt;div&gt; as a literal example.");
});

test("literal JSON HTML is converted only when declared HTML", () => {
  expect(normalizeExtractedDescription("<p>Lead teams.</p>", {
    contentFormat: "html",
    contentEncoding: "none",
  })).toBe("Lead teams.");
  expect(normalizeExtractedDescription("<p>Literal example.</p>", {
    contentFormat: "plain-text",
    contentEncoding: "none",
  })).toBe("<p>Literal example.</p>");
});

test("omitted JSON semantics preserve current auto detection", () => {
  expect(normalizeExtractedDescription("Plain text.", {})).toBe("Plain text.");
  expect(normalizeExtractedDescription("<p>HTML text.</p>", {})).toBe("HTML text.");
});

test("configured normalization uses the immutable v2 converter identity", () => {
  expect(scoutDescriptionConverterVersion).toBe("html-to-markdown-v2");
});

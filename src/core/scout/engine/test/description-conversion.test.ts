import { expect, test } from "bun:test";
import { descriptionToMarkdown } from "../../sourcing/descriptions";

test("plain official descriptions are stored without editorial alteration",()=>{const source="Heading\r\n  punctuation — unchanged\n\nLast line  ";expect(descriptionToMarkdown(source,"text/plain")).toBe(source);});
test("HTML descriptions retain headings, lists, links, and visible wording",()=>{const result=descriptionToMarkdown('<h2>Role &amp; scope</h2><ul><li>Lead teams.</li><li><a href="https://example.test/area">Own delivery</a></li></ul>',"text/html");expect(result).toContain("## Role & scope");expect(result).toContain("Lead teams.");expect(result).toContain("[Own delivery](https://example.test/area)");});
test("description size is enforced after authoritative HTML extraction",()=>{const source=`<!--${"x".repeat(200_001)}--><p>Complete description.</p>`;expect(descriptionToMarkdown(source,"text/html")).toBe("Complete description.");});

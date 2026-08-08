import { useEffect, useId, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

let mermaidLibrary: Promise<(typeof import("mermaid"))["default"]> | null = null;

async function loadMermaid() {
  if (!mermaidLibrary) {
    mermaidLibrary = import("mermaid").then(module => {
      module.default.initialize({ startOnLoad: false, securityLevel: "strict" });
      return module.default;
    });
  }
  return await mermaidLibrary;
}

function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSvg(null);
    setFailed(false);
    void loadMermaid()
      .then(mermaid => mermaid.render(`mermaid-${reactId.replace(/:/g, "")}`, source))
      .then(result => {
        if (active) setSvg(result.svg);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => { active = false; };
  }, [reactId, source]);

  if (failed) return <pre className="mermaid-fallback"><code>{source}</code></pre>;
  if (!svg) return <div className="mermaid-loading" aria-label="Rendering diagram" />;
  return <div
    className="mermaid-diagram"
    aria-label="Mermaid diagram"
    dangerouslySetInnerHTML={{ __html: svg }}
  />;
}

function codeBlock({ className, children }: {
  className?: string;
  children?: ReactNode;
}) {
  const source = (Array.isArray(children)
    ? children.filter(child => typeof child === "string" || typeof child === "number").join("")
    : typeof children === "string" || typeof children === "number"
      ? String(children)
      : "").replace(/\n$/, "");
  return className === "language-mermaid"
    ? <MermaidDiagram source={source} />
    : <code className={className}>{children}</code>;
}

export function MarkdownRenderer({ children }: { children: string }) {
  return <div className="document-markdown">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        code: codeBlock,
        a: ({ children: label, ...props }) => <a
          {...props}
          target="_blank"
          rel="noopener noreferrer"
        >{label}</a>,
        img: ({ alt }) => <span>{alt}</span>,
      }}
    >{children}</ReactMarkdown>
  </div>;
}

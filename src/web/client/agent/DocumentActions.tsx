export interface DocumentActionDescriptor {
  reference: string;
  version: number;
  displayName: string;
  documentType: string;
  mediaType: "text/markdown" | "text/plain";
}

export function documentActionUrls(action: DocumentActionDescriptor) {
  const reference = encodeURIComponent(action.reference);
  const base = `/documents/${reference}/versions/${action.version}`;
  return {
    view: base,
    download: `/api${base}/download`,
  };
}

export function DocumentActions({ actions }: { actions: DocumentActionDescriptor[] }) {
  if (actions.length === 0) return null;
  return <section className="document-actions" aria-label="Documents">
    {actions.map(action => {
      const urls = documentActionUrls(action);
      return <article key={`${action.reference}:${action.version}`}>
        <span>{action.displayName}</span>
        <div>
          <a href={urls.view} target="_blank" rel="noopener noreferrer">View</a>
          <a href={urls.download}>Download</a>
        </div>
      </article>;
    })}
  </section>;
}

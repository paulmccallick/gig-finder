import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App, AppError } from "./App";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
const DocumentViewerRoute = lazy(async () => {
  const module = await import("./DocumentViewer");
  return { default: module.DocumentViewerRoute };
});

try {
  const documentRoute = window.location.pathname.startsWith("/documents/")
    || window.location.pathname.startsWith("/gig-scout/positions/");
  root.render(
    <StrictMode>
      {documentRoute
        ? <Suspense fallback={<main className="document-viewer"><p className="document-viewer-status">Loading document…</p></main>}>
            <DocumentViewerRoute />
          </Suspense>
        : <App />}
    </StrictMode>,
  );
} catch (error) {
  root.render(<AppError error={error} />);
}

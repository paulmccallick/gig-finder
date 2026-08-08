import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("active board, filters, gig drawer, and archive are functional", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Opportunity Control Room" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Networking/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Tasks/ })).toBeVisible();
  const activeCount=await page.locator(".record-card").count();
  expect(activeCount).toBeGreaterThan(0);
  await expect(page.locator(".board-heading")).toHaveCount(0);
  await expect(page.locator(".record-card .action-line")).toHaveCount(0);
  const activeColumns=await page.locator(".kanban-column").count();
  expect(activeColumns).toBeGreaterThan(0);
  expect((await page.locator(".workspace-tabs").boundingBox())?.height).toBeLessThanOrEqual(44);
  expect((await page.locator(".pipeline-metrics").boundingBox())?.height).toBeLessThanOrEqual(58);
  expect((await page.locator(".controls").boundingBox())?.height).toBeLessThanOrEqual(60);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(245, 243, 237)");
  await expect(page.getByText("Source: SQLite").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/playwright/active-desktop.png", fullPage: false });
  const firstCompany = await page.locator(".record-card .card-company").first().innerText();
  await page.locator(".record-card").first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: firstCompany })).toBeVisible();
  await expect(drawer.locator(".drawer-actions")).toContainText(/Apply \/ view posting|No application URL captured/);
  await expect(drawer.locator(".description-section")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await page.getByPlaceholder("Search company, title, status…").fill(firstCompany);
  expect(await page.locator(".record-card").count()).toBeGreaterThan(0);
  await expect(page.locator(".kanban-column")).toHaveCount(activeColumns);
  await expect(page.locator(".column-empty")).toHaveCount(activeColumns-1);
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.locator(".record-card")).toHaveCount(activeCount);
  await page.getByRole("tab", { name: /Archive/ }).click();
  const archiveCount=await page.locator(".record-card").count();
  expect(archiveCount).toBeGreaterThan(0);
  await page.getByRole("button", { name: /Networking/ }).click();
  await expect(page.getByRole("heading", { name: "Relationship Control Room" })).toBeVisible();
  await expect(page.locator(".board-heading")).toHaveCount(0);
  await expect(page.getByText("Source: SQLite")).toBeVisible();
  await expect(page.locator(".networking-board .kanban-column")).toHaveCount(4);
  await expect(page.locator(".contact-card").first()).toBeVisible();
  await page.locator(".contact-card").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Tasks/ }).click();
  await expect(page.getByRole("heading", { name: "Action Control Room" })).toBeVisible();
  await expect(page.locator(".board-heading")).toHaveCount(0);
  await expect(page.getByText("Source: SQLite")).toBeVisible();
  await expect(page.locator(".task-row").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/playwright/tasks-desktop.png", fullPage: false });
  await page.locator(".task-row").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(pageErrors).toEqual([]);
});

test("mobile board remains usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const agentPanel = page.getByRole("complementary", { name: "GigFinder" });
  await expect(agentPanel).toBeVisible();
  await agentPanel.getByRole("button", { name: "Close GigFinder" }).click();
  await expect(page.getByRole("heading", { name: "Opportunity Control Room" })).toBeVisible();
  expect(await page.locator(".record-card").count()).toBeGreaterThan(0);
  await page.locator(".record-card").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(300);
  const drawerBox = await page.getByRole("dialog").boundingBox();
  expect(drawerBox?.x).toBeLessThanOrEqual(30);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Networking/ }).click();
  await expect(page.getByRole("heading", { name: "Relationship Control Room" })).toBeVisible();
  await expect(page.locator(".networking-board")).toBeVisible();
  await page.getByRole("button", { name: /Tasks/ }).click();
  await expect(page.getByRole("heading", { name: "Action Control Room" })).toBeVisible();
  await expect(page.locator(".task-ledger")).toBeVisible();
  await page.getByRole("button", { name: /Ask GigFinderAgent/ }).click();
  await expect(page.getByRole("complementary", { name: "GigFinder" })).toBeVisible();
  await agentPanel.getByRole("button", { name: "Expand agent to full screen" }).click();
  const mobileFullRail = await agentPanel.locator(".agent-panel-header").boundingBox();
  if (!mobileFullRail) throw new Error("Expected a visible mobile agent rail.");
  expect(mobileFullRail.width).toBeLessThanOrEqual(70);
  expect(mobileFullRail.height).toBeCloseTo(844, -1);
  await page.waitForTimeout(350);
  await page.screenshot({ path: "test-results/playwright/agent-mobile.png", fullPage: false });
});

test("GigFinderAgent streams guidance and remains available across dashboard views", async ({ page }) => {
  const diagnostics: string[] = [];
  page.on("console", message => {
    if (message.text().includes("[GigFinderAgent]")) diagnostics.push(message.text());
  });
  const stream = [
    'data: {"type":"start","messageId":"assistant-1"}',
    'data: {"type":"start-step"}',
    'data: {"type":"text-start","id":"text-1"}',
    'data: {"type":"text-delta","id":"text-1","delta":"Prioritize Senior Director and VP engineering roles with credible organizational scope."}',
    'data: {"type":"text-end","id":"text-1"}',
    'data: {"type":"finish-step"}',
    'data: {"type":"finish"}',
    "data: [DONE]",
    "",
  ].join("\n\n");
  await page.route("**/api/agent/messages", async route => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    const body = request.postDataJSON() as { id: string; message: { role: string } };
    expect(body.id).toBeTruthy();
    expect(body.message.role).toBe("user");
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
        "cache-control": "no-store",
      },
      body: stream,
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "GigFinder" });
  const launcher = page.getByRole("button", { name: /Ask GigFinderAgent/ });
  await expect(panel).toBeVisible();
  await expect(launcher).toBeHidden();
  await expect(panel).toHaveAttribute("data-layout", "panel");
  const modelSelector = panel.getByLabel("Agent model");
  await expect(modelSelector).toHaveValue("gpt-5.6-sol");
  const modelUpdate = page.waitForResponse(response =>
    response.url().endsWith("/api/settings/agent-model")
    && response.request().method() === "PUT");
  await modelSelector.selectOption("gpt-5.6-terra");
  expect((await modelUpdate).status()).toBe(200);
  await page.reload();
  await expect(panel.getByLabel("Agent model")).toHaveValue("gpt-5.6-terra");
  await expect(panel.getByRole("button", { name: "Dock agent to side" })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator(".agent-boundary")).toHaveCount(0);
  const resizeHandle = panel.getByRole("separator", { name: "Resize agent panel" });
  const initialPanelBox = await panel.boundingBox();
  const resizeHandleBox = await resizeHandle.boundingBox();
  if (!initialPanelBox || !resizeHandleBox) throw new Error("Expected a resizable side panel.");
  expect(initialPanelBox.width).toBeCloseTo(450, -1);
  const resizeHandleCenterX = resizeHandleBox.x + resizeHandleBox.width / 2;
  await page.mouse.move(resizeHandleCenterX, resizeHandleBox.y + 120);
  await page.mouse.down();
  await page.mouse.move(resizeHandleCenterX - 150, resizeHandleBox.y + 120);
  await page.mouse.up();
  const resizedPanelBox = await panel.boundingBox();
  if (!resizedPanelBox) throw new Error("Expected the resized side panel to remain visible.");
  expect(resizedPanelBox.width).toBeCloseTo(600, -1);
  expect(await page.locator(".dashboard-with-agent").evaluate(element =>
    getComputedStyle(element).marginRight)).toBe("600px");
  await panel.getByRole("button", { name: "What kinds of roles should I prioritize?" }).click();
  await expect(panel).toContainText("Prioritize Senior Director and VP engineering roles");
  expect(diagnostics.some(message => message.includes("agent.ui.request.submitted"))).toBe(true);
  expect(diagnostics.some(message => message.includes("agent.ui.status.changed"))).toBe(true);
  expect(diagnostics.some(message => message.includes("agent.ui.response.finished"))).toBe(true);
  await page.screenshot({ path: "test-results/playwright/agent-desktop.png", fullPage: false });
  await page.getByRole("button", { name: /Networking/ }).click();
  await expect(page.getByRole("heading", { name: "Relationship Control Room" })).toBeVisible();
  await expect(panel).toContainText("Prioritize Senior Director and VP engineering roles");
  const composer = panel.getByLabel("Message GigFinderAgent");
  await composer.fill("Keep this draft while I change layouts.");
  await panel.getByRole("button", { name: "Expand agent to full screen" }).click();
  await expect(panel).toHaveAttribute("data-layout", "full");
  await expect(launcher).toBeHidden();
  const fullBox = await panel.boundingBox();
  if (!fullBox) throw new Error("Expected a visible full-screen agent panel.");
  expect(fullBox.width).toBeCloseTo(1440, -1);
  expect(fullBox.height).toBeCloseTo(1000, -1);
  const fullRail = await panel.locator(".agent-panel-header").boundingBox();
  if (!fullRail) throw new Error("Expected a visible full-screen agent rail.");
  expect(fullRail.x).toBeCloseTo(0, 0);
  expect(fullRail.y).toBeCloseTo(0, 0);
  expect(fullRail.width).toBeLessThanOrEqual(180);
  expect(fullRail.height).toBeCloseTo(1000, -1);
  const fullMessages = await panel.locator(".agent-messages").boundingBox();
  if (!fullMessages) throw new Error("Expected visible full-screen agent messages.");
  expect(fullMessages.x).toBeGreaterThanOrEqual(fullRail.width);
  await page.screenshot({ path: "test-results/playwright/agent-full.png", fullPage: false });
  await expect(composer).toHaveValue("Keep this draft while I change layouts.");
  await expect(panel).toContainText("Prioritize Senior Director and VP engineering roles");
  await panel.getByRole("button", { name: "Close GigFinder" }).click();
  await expect(panel).toBeHidden();
  await expect(launcher).toBeVisible();
  await launcher.click();
  await expect(panel).toHaveAttribute("data-layout", "full");
  await panel.getByRole("button", { name: "Dock agent to side" }).click();
  const restoredPanelBox = await panel.boundingBox();
  if (!restoredPanelBox) throw new Error("Expected the side panel to reopen.");
  expect(restoredPanelBox.width).toBeCloseTo(600, -1);
  await expect(composer).toHaveValue("Keep this draft while I change layouts.");
  await panel.getByRole("button", { name: "Close GigFinder" }).click();
});

test("GigFinderAgent preserves delayed reasoning and tool activity through the final answer", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const interceptedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith("/api/agent/messages")) return originalFetch(input, init);
      const events = [
        { delay: 120, value: { type: "start", messageId: "assistant-delayed" } },
        { delay: 120, value: { type: "start-step" } },
        { delay: 120, value: { type: "reasoning-start", id: "reasoning-1" } },
        { delay: 180, value: { type: "reasoning-delta", id: "reasoning-1", delta: "I’ll check the current opportunities first." } },
        { delay: 120, value: { type: "reasoning-end", id: "reasoning-1" } },
        { delay: 120, value: { type: "tool-input-start", toolCallId: "raw-call-secret", toolName: "list_gigs", dynamic: true } },
        { delay: 180, value: { type: "tool-input-available", toolCallId: "raw-call-secret", toolName: "list_gigs", input: { recordId: "raw-record-secret" }, dynamic: true } },
        { delay: 180, value: { type: "tool-output-available", toolCallId: "raw-call-secret", output: { status: "ok", id: "raw-result-secret" }, dynamic: true } },
        { delay: 120, value: { type: "reasoning-start", id: "reasoning-2" } },
        { delay: 180, value: { type: "reasoning-delta", id: "reasoning-2", delta: "One role merits a closer look." } },
        { delay: 120, value: { type: "reasoning-end", id: "reasoning-2" } },
        { delay: 120, value: { type: "text-start", id: "text-delayed" } },
        { delay: 180, value: { type: "text-delta", id: "text-delayed", delta: "Prioritize the Example Company engineering role." } },
        { delay: 100, value: { type: "text-end", id: "text-delayed" } },
        { delay: 50, value: { type: "finish-step" } },
        { delay: 50, value: { type: "finish" } },
      ];
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          const send = (index: number) => {
            const event = events[index];
            if (!event) {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            }
            window.setTimeout(() => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event.value)}\n\n`));
              send(index + 1);
            }, event.delay);
          };
          send(0);
        },
      });
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      });
    };
    Object.defineProperty(window, "fetch", { configurable: true, value: interceptedFetch });
  });

  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "GigFinder" });
  await panel.getByLabel("Message GigFinderAgent").fill("What should I prioritize?");
  await panel.getByRole("button", { name: /Send/ }).click();
  const activity = panel.locator(".agent-thinking");
  await expect(activity).toContainText("Thinking");
  await expect(activity).toHaveAttribute("aria-live", "polite");
  await expect(activity).toHaveAttribute("aria-busy", "true");
  expect(await activity.evaluate(element => element.parentElement?.classList.contains("agent-messages"))).toBe(false);
  await expect(panel.getByLabel("Agent reasoning").first()).toContainText("current opportunities");
  await expect(activity).toContainText("Searching gigs");
  await expect(panel.locator(".agent-tool-activity")).toContainText("Searching gigs complete");
  await expect(panel.getByLabel("Agent reasoning").nth(1)).toContainText("closer look");
  await expect(panel).toContainText("Prioritize the Example Company engineering role.");
  await expect(activity).toBeHidden();
  const transcript = await panel.locator(".agent-messages").innerText();
  expect(transcript.indexOf("current opportunities")).toBeLessThan(transcript.indexOf("Searching gigs complete"));
  expect(transcript.indexOf("Searching gigs complete")).toBeLessThan(transcript.indexOf("closer look"));
  expect(transcript.indexOf("closer look")).toBeLessThan(transcript.indexOf("Prioritize the Example Company"));
  expect(transcript).not.toMatch(/raw-(?:call|record|result)-secret/);
});

test("managed document reads produce view and download actions", async ({ page }) => {
  const documentId = "doc_11111111-1111-4111-8111-111111111111";
  const content = [
    "# Interview Brief",
    "",
    "- Review the product strategy",
    "- Prepare leadership examples",
    "",
    "```mermaid",
    "flowchart LR",
    "  Prepare --> Interview",
    "```",
    "",
    "<script>window.compromised = true</script>",
  ].join("\n");
  const stream = [
    { type: "start", messageId: "assistant-document" },
    { type: "start-step" },
    { type: "tool-input-start", toolCallId: "read-document", toolName: "get_document", dynamic: true },
    { type: "tool-input-available", toolCallId: "read-document", toolName: "get_document", input: { reference: documentId, version: 1 }, dynamic: true },
    {
      type: "tool-output-available",
      toolCallId: "read-document",
      dynamic: true,
      output: {
        status: "ok",
        record: {
          reference: documentId,
          entityType: "gig",
          entityId: "gig-active",
          documentType: "interview_prep",
          title: "Interview Brief",
          displayName: "Interview Brief",
          storage: "managed",
          mediaType: "text/markdown",
          version: 1,
          currentVersion: 1,
          content,
          truncated: false,
          totalCharacters: content.length,
        },
      },
    },
    { type: "text-start", id: "document-answer" },
    { type: "text-delta", id: "document-answer", delta: "I found the interview brief." },
    { type: "text-end", id: "document-answer" },
    { type: "finish-step" },
    { type: "finish" },
  ];
  await page.route("**/api/agent/messages", async route => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
        "cache-control": "no-store",
      },
      body: `${stream.map(event => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\ndata: [DONE]\n\n`,
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "GigFinder" });
  await panel.getByRole("button", { name: "Expand agent to full screen" }).click();
  await panel.getByLabel("Message GigFinderAgent").fill("Show me the interview brief");
  await panel.getByRole("button", { name: /Send/ }).click();
  const actions = panel.getByRole("region", { name: "Documents" });
  await expect(actions).toContainText("Interview Brief");
  await expect(actions).not.toContainText(documentId);

  const chatDownloadPromise = page.waitForEvent("download");
  await actions.getByRole("link", { name: "Download" }).click();
  const chatDownload = await chatDownloadPromise;
  expect(chatDownload.suggestedFilename()).toBe("Interview Brief.md");
  expect(await readFile(await chatDownload.path(), "utf8")).toBe(content);

  const popupPromise = page.waitForEvent("popup");
  await actions.getByRole("link", { name: "View" }).click();
  const viewer = await popupPromise;
  await expect(viewer.getByRole("heading", { name: "Interview Brief", level: 1 }).first()).toBeVisible();
  await expect(viewer.getByText("Review the product strategy")).toBeVisible();
  await expect(viewer.getByLabel("Mermaid diagram").locator("svg")).toBeVisible();
  await expect(viewer.getByText("window.compromised", { exact: false })).toHaveCount(0);
  expect(await viewer.evaluate(() => "compromised" in window)).toBe(false);
  await viewer.reload();
  await expect(viewer.getByText("Prepare leadership examples")).toBeVisible();
  await expect(viewer.getByLabel("Mermaid diagram").locator("svg")).toBeVisible();

  const viewerDownloadPromise = viewer.waitForEvent("download");
  await viewer.getByRole("link", { name: "Download" }).click();
  const viewerDownload = await viewerDownloadPromise;
  expect(viewerDownload.suggestedFilename()).toBe("Interview Brief.md");
  expect(await readFile(await viewerDownload.path(), "utf8")).toBe(content);
});

test("GigFinderAgent surfaces and retries an interrupted empty response", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/agent/messages", async route => {
    attempts += 1;
    const responseEvents = attempts === 1
      ? [
          'data: {"type":"start","messageId":"assistant-empty"}',
          'data: {"type":"start-step"}',
          'data: {"type":"finish-step"}',
          'data: {"type":"finish"}',
          "data: [DONE]",
          "",
        ]
      : [
          'data: {"type":"start","messageId":"assistant-retry"}',
          'data: {"type":"start-step"}',
          'data: {"type":"text-start","id":"text-retry"}',
          'data: {"type":"text-delta","id":"text-retry","delta":"The retried response completed."}',
          'data: {"type":"text-end","id":"text-retry"}',
          'data: {"type":"finish-step"}',
          'data: {"type":"finish"}',
          "data: [DONE]",
          "",
        ];
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: responseEvents.join("\n\n"),
    });
  });

  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "GigFinder" });
  await panel.getByLabel("Message GigFinderAgent").fill("Tell me about this role");
  await panel.getByRole("button", { name: /Send/ }).click();
  const alert = panel.getByRole("alert");
  await expect(alert).toContainText("response was interrupted");
  await alert.getByRole("button", { name: "Retry response" }).click();
  await expect(panel).toContainText("The retried response completed.");
  await expect(alert).toBeHidden();
  expect(attempts).toBe(2);
});

test("document upload stages without the agent and attaches to the next message", async ({ page }) => {
  const stagedReference = "staged-document:11111111-1111-4111-8111-111111111111";
  let agentRequests = 0;
  let releaseAgentResponse = () => {};
  const agentResponseGate = new Promise<void>(resolve => {
    releaseAgentResponse = resolve;
  });
  await page.route("**/api/agent/documents", async route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataBuffer()?.toString()).toContain("Exact source text");
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        reference: stagedReference,
        filename: "role.md",
        detectedMediaType: "text/markdown",
        contentHash: "a".repeat(64),
        converter: "utf-8",
        converterVersion: "1",
        extractionWarnings: [],
        uploadedAt: "2026-07-29T12:00:00.000Z",
        markdownCharacters: 31,
        expiresAt: "2026-07-29T12:15:00.000Z",
      }),
    });
  });
  await page.route("**/api/agent/messages", async route => {
    agentRequests += 1;
    const body = route.request().postDataJSON() as {
      id: string;
      message: { role: string; parts: Array<{ type: string; text?: string }> };
    };
    expect(body.id).toBeTruthy();
    const prompt = body.message.parts
      .filter(part => part.type === "text")
      .map(part => part.text)
      .join("");
    expect(prompt).toContain(stagedReference);
    expect(prompt).toContain("The recruiter sent this job description.");
    expect(prompt).not.toContain("Exact source text");
    await agentResponseGate;
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: [
        'data: {"type":"start","messageId":"assistant-upload"}',
        'data: {"type":"start-step"}',
        'data: {"type":"text-start","id":"text-upload"}',
        'data: {"type":"text-delta","id":"text-upload","delta":"I found one matching role and saved the uploaded source."}',
        'data: {"type":"text-end","id":"text-upload"}',
        'data: {"type":"finish-step"}',
        'data: {"type":"finish"}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
    });
  });

  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "GigFinder" });
  await panel.locator("#agent-document-upload").setInputFiles({
    name: "role.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Director Role\n\nExact source text"),
  });
  await expect(panel).toContainText("Staged: role.md");
  expect(agentRequests).toBe(0);
  await panel.getByLabel("Message GigFinderAgent").fill(
    "The recruiter sent this job description.",
  );
  await panel.getByRole("button", { name: /Send/ }).click();
  await expect.poll(() => agentRequests).toBe(1);
  await expect(panel.locator(".agent-message.is-user").last()).toContainText("Attached document");
  await expect(panel.locator(".agent-message.is-user").last()).not.toContainText(stagedReference);
  await expect(panel.getByRole("button", { name: "Discard" })).toBeDisabled();
  releaseAgentResponse();
  await expect(panel).toContainText("saved the uploaded source");
  expect(agentRequests).toBe(1);
});

test("GigFinderAgent reopens and switches persisted conversations", async ({ page }) => {
  const conversations = [
    { id: "conversation-latest", title: "Latest strategy", createdAt: "2026-08-04T10:00:00.000Z", lastActiveAt: "2026-08-04T12:00:00.000Z" },
    { id: "conversation-older", title: "Earlier interview", createdAt: "2026-08-03T10:00:00.000Z", lastActiveAt: "2026-08-03T12:00:00.000Z" },
  ];
  await page.route("**/api/agent/conversations", route => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ conversations }),
  }));
  await page.route("**/api/agent/conversations/*", route => {
    const id = route.request().url().split("/").at(-1)!;
    const conversation = conversations.find(item => item.id === id)!;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        conversation,
        messages: [
          { id: `user-${id}`, role: "user", parts: [{ type: "text", text: `Question for ${conversation.title}\n\nAttached staged document: [attached document]` }] },
          { id: `assistant-${id}`, role: "assistant", parts: [
            { type: "reasoning", text: `Reasoning for ${conversation.title}` },
            { type: "tool-list_gigs", toolCallId: "restored-secret-call", state: "output-available", input: { id: "restored-secret-input" }, output: { id: "restored-secret-output" } },
            { type: "text", text: `Answer for ${conversation.title}` },
          ] },
        ],
      }),
    });
  });
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "GigFinder" });
  const selector = panel.getByLabel("Conversation");
  await expect(selector).toHaveValue("conversation-latest");
  await expect(panel).toContainText("Answer for Latest strategy");
  await expect(panel.locator(".agent-message.is-user")).toContainText("Attached document");
  await expect(panel).not.toContainText("Attached staged document");
  await expect(panel).toContainText("Reasoning for Latest strategy");
  await expect(panel).toContainText("Searching gigs complete");
  await expect(panel).not.toContainText("restored-secret");
  await selector.selectOption("conversation-older");
  await expect(panel).toContainText("Answer for Earlier interview");
});

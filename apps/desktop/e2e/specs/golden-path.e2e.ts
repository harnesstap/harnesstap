import { expect } from "expect-webdriverio";
import type { E2EIsolation } from "../helpers/isolation.ts";
import {
  DEMO_PLUGIN_REF,
  MARKETPLACE_NAME,
  PROJECT_RESOURCE_NAMES,
  USER_RESOURCE_NAMES,
} from "../helpers/seed.ts";

const PROFILE_BASE = "e2e-base";
const PROFILE_CHILD = "e2e-child";

function byTestId(id: string): string {
  return `[data-testid="${id}"]`;
}

async function waitForTestId(id: string): Promise<WebdriverIO.Element> {
  const el = await $(byTestId(id));
  await el.waitForDisplayed();
  return el;
}

async function clickTestId(id: string): Promise<void> {
  const el = await waitForTestId(id);
  await el.click();
}

async function expandSelectionTypeGroups(): Promise<void> {
  const headings = await $$(".selection-type-heading");
  for (const heading of headings) {
    if (await heading.isDisplayed()) {
      await heading.click();
    }
  }
}

async function toggleCreateResource(name: string): Promise<void> {
  let row = await $(byTestId(`create-resource-${name}`));
  if (!(await row.isExisting()) || !(await row.isDisplayed())) {
    await expandSelectionTypeGroups();
    row = await $(byTestId(`create-resource-${name}`));
  }
  await row.waitForDisplayed();
  await row.$("label").click();
}

async function toggleCreatePlugin(name: string): Promise<void> {
  const row = await waitForTestId(`create-plugin-${name}`);
  await row.$("label").click();
}

async function waitForLibraryLoaded(): Promise<void> {
  await browser.waitUntil(
    async () => {
      const loading = await $("p*=Loading local library");
      return !(await loading.isExisting()) || !(await loading.isDisplayed());
    },
    { timeout: 30000, timeoutMsg: "Library did not finish loading" },
  );
}

async function submitCreateProfile(): Promise<void> {
  await clickTestId("create-profile-submit");
  const submit = await $(byTestId("create-profile-submit"));
  await browser.waitUntil(
    async () => (await submit.getText()).includes("Create profile"),
    { timeout: 30000, timeoutMsg: "Create profile preview did not complete" },
  );
  await submit.click();
}

async function assertResourceRows(names: readonly string[]): Promise<void> {
  for (const name of names) {
    const row = await $(byTestId(`resource-row-${name}`));
    await row.waitForDisplayed();
  }
}

async function selectPluginIfNeeded(ref: string): Promise<void> {
  const trigger = await waitForTestId("edit-plugin-ref");
  const label = ref.split("@")[0];
  const current = await trigger.getText();
  if (current.includes(label)) {
    return;
  }
  await trigger.click();
  const byValue = await $(`[role="option"][data-value="${ref}"]`);
  if (await byValue.isExisting()) {
    await byValue.waitForDisplayed();
    await byValue.click();
    return;
  }
  const fallback = await $(`//div[@role='option'][contains(.,'${label}')]`);
  await fallback.waitForDisplayed();
  await fallback.click();
}

describe("Golden path", () => {
  let isolation: E2EIsolation;

  before(() => {
    isolation = browser.e2eIsolation;
  });

  it("waits for agent connection", async () => {
    await waitForTestId("agent-connected");
  });

  it("registers marketplace from settings", async () => {
    await clickTestId("open-settings");
    await waitForTestId("settings-drawer");

    const urlInput = await waitForTestId("marketplace-url");
    await urlInput.setValue(isolation.marketplaceRepo);

    const nameInput = await waitForTestId("marketplace-name");
    await nameInput.setValue(MARKETPLACE_NAME);

    await clickTestId("marketplace-add");
    await waitForTestId(`marketplace-row-${MARKETPLACE_NAME}`);

    const closeBtn = await $(
      `${byTestId("settings-drawer")} button[aria-label="Close settings"]`,
    );
    await closeBtn.waitForDisplayed();
    await closeBtn.click();
    await browser.waitUntil(
      async () => !(await $(byTestId("settings-drawer")).isDisplayed()),
      { timeout: 10000, timeoutMsg: "Settings drawer did not close" },
    );
  });

  it("refreshes and shows global user resources", async () => {
    await clickTestId("view-home");
    await clickTestId("header-refresh");
    await assertResourceRows(USER_RESOURCE_NAMES);
  });

  it("creates base profile from compose without activating", async () => {
    await clickTestId("open-create-profile");
    await waitForTestId("create-profile-name");

    const nameInput = await $(byTestId("create-profile-name"));
    await nameInput.setValue(PROFILE_BASE);

    await clickTestId("create-source-compose");
    await waitForLibraryLoaded();

    for (const name of USER_RESOURCE_NAMES) {
      await toggleCreateResource(name);
    }

    await submitCreateProfile();
    await waitForTestId(`profile-rail-${PROFILE_BASE}`);
  });

  it("shows project scope resources after refresh", async () => {
    await clickTestId("view-project");

    const projectPath = await waitForTestId("project-path");
    await expect(projectPath).toHaveAttribute(
      "title",
      expect.stringContaining(isolation.project),
    );

    await clickTestId("header-refresh");
    await assertResourceRows(PROJECT_RESOURCE_NAMES);
  });

  it("pins marketplace plugin on inactive base profile", async () => {
    await clickTestId(`edit-profile-${PROFILE_BASE}`);
    await waitForTestId("edit-plugin-ref");

    await selectPluginIfNeeded(DEMO_PLUGIN_REF);
    await clickTestId("edit-plugin-add");

    const pinRow = await $(byTestId(`create-resource-${DEMO_PLUGIN_REF}`));
    await pinRow.waitForDisplayed({ timeout: 30000 });
    const checked = await pinRow.$("button[data-state='checked']");
    await expect(checked).toBeDisplayed();
  });

  it("creates child profile inheriting base plugin", async () => {
    const doneBtn = await $("main.edit-profile-pane button[aria-label='Done editing']");
    if (await doneBtn.isExisting()) {
      await doneBtn.waitForDisplayed();
      await doneBtn.click();
    }

    await clickTestId("open-create-profile");
    await waitForTestId("create-profile-name");

    const nameInput = await $(byTestId("create-profile-name"));
    await nameInput.setValue(PROFILE_CHILD);

    await clickTestId("create-source-compose");
    await waitForLibraryLoaded();

    await toggleCreatePlugin(PROFILE_BASE);
    await submitCreateProfile();
    await waitForTestId(`profile-rail-${PROFILE_CHILD}`);
  });
});

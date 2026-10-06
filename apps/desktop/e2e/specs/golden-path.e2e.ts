import { expect } from "expect-webdriverio";
import {
  loadE2EIsolationPaths,
  type E2EIsolationPaths,
} from "../helpers/isolation.ts";
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

function isolation(): E2EIsolationPaths {
  return loadE2EIsolationPaths();
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

async function clickEnabledTestId(id: string): Promise<void> {
  const el = await waitForTestId(id);
  await browser.waitUntil(
    async () => el.isEnabled(),
    { timeout: 30000, timeoutMsg: `${id} never became enabled` },
  );
  await el.click();
}

async function ensureAllTypesVisible(): Promise<void> {
  const allTab = await $('[data-testid="resource-type-tab-all"]');
  if ((await allTab.isExisting()) && (await allTab.isDisplayed())) {
    await allTab.click();
  }
}

async function toggleCreateResource(name: string): Promise<void> {
  let row = await $(byTestId(`create-resource-${name}`));
  if (!(await row.isExisting()) || !(await row.isDisplayed())) {
    await ensureAllTypesVisible();
    row = await $(byTestId(`create-resource-${name}`));
  }
  await row.waitForDisplayed();
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

async function openScope(): Promise<void> {
  await clickTestId("view-global");
}

async function addMarketplaceFromDiscover(): Promise<void> {
  const discoverNav = await $('button[aria-label="Discover"]');
  await discoverNav.waitForDisplayed();
  await discoverNav.click();
  await waitForTestId("sources-workspace");

  await clickTestId("open-add-marketplace");
  await waitForTestId("marketplace-edit-panel");

  const urlInput = await waitForTestId("marketplace-url");
  await urlInput.setValue(isolation().marketplaceRepo);

  const nameInput = await waitForTestId("marketplace-name");
  await nameInput.setValue(MARKETPLACE_NAME);

  await clickEnabledTestId("marketplace-add");
  await browser.waitUntil(
    async () => {
      const panel = await $(byTestId("marketplace-edit-panel"));
      return !(await panel.isExisting()) || !(await panel.isDisplayed());
    },
    { timeout: 30000, timeoutMsg: "Add marketplace panel did not close" },
  );
}

async function addMarketplacePluginFromDiscover(ref: string): Promise<void> {
  const pluginName = ref.split("@")[0] ?? ref;
  const discoverNav = await $('button[aria-label="Discover"]');
  await discoverNav.waitForDisplayed();
  await discoverNav.click();
  await waitForTestId("sources-workspace");

  const hit = await $(`[data-testid^="sources-hit-"][data-testid*="plugin:${pluginName}"]`);
  await hit.waitForDisplayed({ timeout: 30000 });
  await hit.click();

  const addToLibrary = await $("button*=Add to Library");
  await addToLibrary.waitForDisplayed({ timeout: 15000 });
  await addToLibrary.click();

  await browser.waitUntil(
    async () => !(await addToLibrary.isExisting()) || !(await addToLibrary.isDisplayed()),
    { timeout: 30000, timeoutMsg: "Add to Library did not finish" },
  );
}

async function addLibraryPluginOnEditProfile(pluginName: string): Promise<void> {
  await clickTestId("edit-profile-composition-fab");
  const search = await $(".scope-add-modal input[type='search']");
  await search.waitForDisplayed();
  await search.setValue(pluginName);
  const row = await waitForTestId(`scope-add-row-${pluginName}`);
  await row.$("button[role='checkbox']").click();
  const addBtn = await $(".scope-add-modal button.primary");
  await addBtn.waitForDisplayed();
  await addBtn.click();
  await browser.waitUntil(
    async () => !(await $(".scope-add-modal").isDisplayed()),
    { timeout: 15000, timeoutMsg: "Add to profile modal did not close" },
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

async function openLibraryCreate(): Promise<void> {
  const libraryNav = await $('button[aria-label="Library"]');
  await libraryNav.waitForDisplayed();
  await libraryNav.click();
  await clickTestId("library-list-fab");
}

describe("Golden path", () => {
  it("waits for agent connection", async () => {
    await waitForTestId("agent-connected");
  });

  it("registers marketplace from Discover", async () => {
    await addMarketplaceFromDiscover();
    const pluginName = DEMO_PLUGIN_REF.split("@")[0] ?? DEMO_PLUGIN_REF;
    const hit = await $(`[data-testid^="sources-hit-"][data-testid*="plugin:${pluginName}"]`);
    await hit.waitForDisplayed({ timeout: 30000 });
  });

  it("refreshes and shows global user resources", async () => {
    await openScope();
    await clickTestId("live-status-refresh");
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
      expect.stringContaining(isolation().project),
    );

    await clickTestId("live-status-refresh");
    await assertResourceRows(PROJECT_RESOURCE_NAMES);
  });

  it("pins marketplace plugin on inactive base profile", async () => {
    await addMarketplacePluginFromDiscover(DEMO_PLUGIN_REF);
    await clickTestId("view-project");
    await clickTestId(`edit-profile-${PROFILE_BASE}`);
    const pluginName = DEMO_PLUGIN_REF.split("@")[0] ?? DEMO_PLUGIN_REF;
    await addLibraryPluginOnEditProfile(pluginName);

    const pinRow = await $(
      `${byTestId(`create-resource-${pluginName}`)}, ${byTestId(`create-resource-${DEMO_PLUGIN_REF}`)}`,
    );
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

    await openScope();
    await clickTestId("open-create-profile");
    await waitForTestId("create-profile-name");

    const nameInput = await $(byTestId("create-profile-name"));
    await nameInput.setValue(PROFILE_CHILD);

    await clickTestId("create-source-compose");
    await waitForLibraryLoaded();

    await toggleCreateResource(PROFILE_BASE);
    await submitCreateProfile();
    await waitForTestId(`profile-rail-${PROFILE_CHILD}`);
  });

  it("creates a rule resource through the create-resource flow", async () => {
    const ruleName = `e2e-rule-${Date.now()}`;

    await openLibraryCreate();
    await waitForTestId("resource-type-modal");

    await clickTestId("resource-type-option-rule");
    await waitForTestId("resource-create-panel");

    const submit = await waitForTestId("resource-create-submit");
    await expect(submit).toBeDisabled();

    const nameInput = await waitForTestId("resource-create-field-name");
    await nameInput.setValue(ruleName);
    const contentInput = await waitForTestId("resource-create-field-content");
    await contentInput.setValue("# E2E rule\nAlways use bun.");

    await expect(submit).toBeEnabled();
    await submit.click();

    await browser.waitUntil(
      async () => !(await $(byTestId("resource-create-panel")).isExisting()),
      { timeout: 15000, timeoutMsg: "Resource create panel did not close" },
    );

    const detailTitle = await $(".library-detail .library-detail-title");
    await detailTitle.waitForDisplayed();
    await expect(detailTitle).toHaveText(expect.stringContaining(ruleName));
  });

  it("blocks create until mandatory fields are filled", async () => {
    const discardDialogSelector =
      "//h2[normalize-space()='Discard this resource?']/ancestor::div[@role='dialog']";

    await openLibraryCreate();
    await waitForTestId("resource-type-modal");
    await clickTestId("resource-type-option-env_var");
    await waitForTestId("resource-create-panel");

    const submit = await waitForTestId("resource-create-submit");
    await expect(submit).toBeDisabled();

    await (await waitForTestId("resource-create-field-name")).setValue(
      "e2e-env-var",
    );
    await expect(submit).toBeDisabled();

    await (await waitForTestId("resource-create-field-key")).setValue(
      "E2E_DISCARD_KEY",
    );
    await (await waitForTestId("resource-create-field-value")).setValue(
      "e2e-value",
    );
    await expect(submit).toBeEnabled();

    await clickTestId("resource-create-cancel");

    const dialog = await $(discardDialogSelector);
    await dialog.waitForDisplayed({ timeout: 10000 });
    const discardButton = await dialog.$("button.btn.primary");
    await discardButton.waitForDisplayed();
    await discardButton.click();

    await browser.waitUntil(
      async () => !(await dialog.isExisting()),
      { timeout: 5000, timeoutMsg: "Discard confirm dialog did not close" },
    );
    await browser.waitUntil(
      async () => !(await $(byTestId("resource-create-panel")).isExisting()),
      {
        timeout: 5000,
        timeoutMsg: "Resource create panel did not close after discard",
      },
    );
  });
});

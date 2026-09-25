import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { ApiKeysPanel, type ApiKeyListItem, type ApiKeysCardProps } from "./api-keys-card";
import type { ApiKeyActionState } from "@/app/actions/api-keys";

const dom = new Window({ url: "https://dev.githubbounties.xyz/settings" });

function installGlobal(name: string, value: unknown) {
  const current = Object.getOwnPropertyDescriptor(globalThis, name);
  if (current && current.configurable === false && current.writable !== true) return;
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

installGlobal("window", dom);
installGlobal("document", dom.document);
installGlobal("HTMLElement", dom.HTMLElement);
installGlobal("Node", dom.Node);
installGlobal("Event", dom.Event);
installGlobal("FormData", dom.FormData);
installGlobal("IS_REACT_ACT_ENVIRONMENT", true);
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
  setTimeout(() => callback(Date.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (handle: number) => clearTimeout(handle);

const ceilings = { perTxUsdc: "50.000000", dailyUsdc: "200.000000" };

function keyRow(name: string, token: string): ApiKeyListItem {
  return {
    id: `id-${name}`,
    name,
    prefix: token.slice(0, "gb_test_".length + 8),
    env: "test",
    scopes: ["read"],
    perTxCapUsdc: ceilings.perTxUsdc,
    dailyCapUsdc: ceilings.dailyUsdc,
    createdAt: "2026-09-25T00:00:00.000Z",
    lastUsedAt: null,
    lastUsedIp: null,
    revokedAt: null,
  };
}

function tokenFor(name: string): string {
  return `gb_test_${name}SECRETSECRETSECRETSECRETSECRETX`;
}

describe("shown-once API key secret", () => {
  let root: Root;
  let keys: ApiKeyListItem[] = [];
  const created: string[] = [];

  function panel(): HTMLParagraphElement | null {
    return document.querySelector("p.font-mono");
  }

  function props(): ApiKeysCardProps & {
    createKey: (formData: FormData) => Promise<ApiKeyActionState>;
    refresh: () => void;
  } {
    return {
      keys,
      ceilings,
      keyEnv: "test",
      moneyEligible: false,
      walletSet: true,
      githubLinked: false,
      refresh: () => {},
      async createKey(formData: FormData) {
        const name = String(formData.get("name") ?? "");
        created.push(name);
        const token = tokenFor(name);
        keys = [keyRow(name, token), ...keys];
        return {
          ok: true,
          token,
          prefix: token.slice(0, "gb_test_".length + 8),
          keyId: `id-${name}`,
          message: "Copy this key now. It is shown once.",
        };
      },
    };
  }

  function draw() {
    act(() => {
      root.render(createElement(ApiKeysPanel, props()) as ReactNode);
    });
  }

  async function create(name: string) {
    const input = document.querySelector('input[name="name"]') as HTMLInputElement;
    input.value = name;
    const form = document.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    draw();
  }

  afterEach(() => {
    act(() => root.unmount());
  });

  it("shows each create's secret, then nothing after remount, dismiss, or page restore", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    draw();

    await create("s1");
    const s1 = tokenFor("s1");
    assert.equal(panel()?.textContent, s1);
    assert.equal(document.querySelector("li code")?.textContent, `${s1.slice(0, "gb_test_".length + 8)}…`);
    assert.equal(document.body.textContent?.includes(s1.slice("gb_test_".length + 8)), true);

    await create("s2");
    const s2 = tokenFor("s2");
    assert.equal(panel()?.textContent, s2);
    assert.equal(panel()?.textContent?.includes(s1), false);
    assert.equal(document.querySelector("li code")?.textContent, `${s2.slice(0, "gb_test_".length + 8)}…`);
    assert.equal(document.body.textContent?.includes(s1), false);
    const listText = [...document.querySelectorAll("li")].map((node) => node.textContent ?? "").join("\n");
    assert.equal(listText.includes(s2), false);
    assert.equal(listText.includes(s1), false);

    act(() => root.unmount());
    host.replaceChildren();
    root = createRoot(host);
    draw();
    assert.equal(panel(), null);
    assert.equal(document.body.textContent?.includes(s1), false);
    assert.equal(document.body.textContent?.includes(s2), false);
    assert.match(document.body.textContent ?? "", new RegExp(s2.slice(0, "gb_test_".length + 8)));

    await create("s3");
    const s3 = tokenFor("s3");
    assert.equal(panel()?.textContent, s3);
    assert.equal(document.querySelector("li code")?.textContent, `${s3.slice(0, "gb_test_".length + 8)}…`);

    const dismiss = [...document.querySelectorAll("button")].find((button) => button.textContent === "Dismiss");
    assert.ok(dismiss);
    await act(async () => {
      dismiss.click();
    });
    assert.equal(panel(), null);
    assert.equal(document.body.textContent?.includes(s3), false);

    await create("s4");
    const s4 = tokenFor("s4");
    assert.equal(panel()?.textContent, s4);
    await act(async () => {
      window.dispatchEvent(new window.Event("pagehide"));
    });
    assert.equal(panel(), null);
    assert.equal(document.body.textContent?.includes(s4), false);
    await act(async () => {
      window.dispatchEvent(new window.PageTransitionEvent("pageshow", { persisted: true }));
    });
    assert.equal(panel(), null);

    await create("s5");
    const s5 = tokenFor("s5");
    assert.equal(panel()?.textContent, s5);
    assert.equal(panel()?.textContent?.includes(s4), false);
    assert.deepEqual(created, ["s1", "s2", "s3", "s4", "s5"]);
  });

  it("hides caps on a read-only key and shows money-key caps as dollars per day", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const readOnly = keyRow("read-only", tokenFor("read-only"));
    const money = {
      ...keyRow("pay", tokenFor("pay")),
      scopes: ["read", "money"] as ApiKeyListItem["scopes"],
    };
    keys = [readOnly, money];
    draw();

    const items = [...host.querySelectorAll("li")].map((node) => node.textContent ?? "");
    const readOnlyText = items.find((text) => text.includes("read-only"));
    const moneyText = items.find((text) => text.includes("pay"));
    assert.ok(readOnlyText);
    assert.ok(moneyText);
    assert.equal(readOnlyText.includes("50.000000"), false);
    assert.equal(readOnlyText.includes("200.000000"), false);
    assert.equal(readOnlyText.includes("USDC"), false);
    assert.equal(readOnlyText.includes("$"), false);
    assert.equal(readOnlyText.includes("per day"), false);
    assert.match(readOnlyText, /test · read/);
    assert.match(moneyText, /\$50\.00 \/ \$200\.00 per day/);
    assert.equal(moneyText.includes("50.000000"), false);
    assert.equal(moneyText.includes("200.000000"), false);
  });
});

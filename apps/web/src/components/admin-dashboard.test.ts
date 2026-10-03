import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { AdminDashboard, type AdminDashboardData } from "./admin-dashboard";

const dom = new Window({ url: "https://admin.githubbounties.xyz/admin" });

function installGlobal(name: string, value: unknown) {
  const current = Object.getOwnPropertyDescriptor(globalThis, name);
  if (current && current.configurable === false && current.writable !== true) return;
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

installGlobal("window", dom);
installGlobal("document", dom.document);
installGlobal("HTMLElement", dom.HTMLElement);
installGlobal("HTMLButtonElement", dom.HTMLButtonElement);
installGlobal("Node", dom.Node);
installGlobal("Event", dom.Event);
installGlobal("SVGElement", dom.SVGElement);
installGlobal("IS_REACT_ACT_ENVIRONMENT", true);
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
  setTimeout(() => callback(Date.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (handle: number) => clearTimeout(handle);

function data(flags: { refundEnabled: boolean; withdrawEnabled: boolean }): AdminDashboardData {
  return {
    actorEmail: "admin@example.com",
    network: "base",
    feePercent: "2.00",
    poolPercent: "15.00",
    escrowAddress: "0x4a26235bf51c73048635d607EB5371E9b3e611B8",
    feeAddress: "0xf34b4BDd02FFFf225b1c7779C7A316148b907BA8",
    escrowOnChain: { text: "1.000000", error: false },
    liabilities: { text: "1.000000", error: false },
    feeOnChain: { text: "0.100000", error: false },
    feesEarned: { text: "0.100000", error: false },
    feesWithdrawn: { text: "0.000000", error: false },
    refundEnabled: flags.refundEnabled,
    withdrawEnabled: flags.withdrawEnabled,
    bounties: {
      rows: [
        {
          id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          title: "Open hunt",
          repoFullName: "acme/api",
          githubIssueNumber: 7,
          status: "funded",
          amountUsdc: "25.000000",
          refundable: true,
          createdAt: "2026-09-28T12:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageCount: 1,
      search: "",
      status: "",
    },
    statusOptions: [],
  };
}

const originalFetch = globalThis.fetch;

describe("admin money controls", () => {
  let root: Root | null = null;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("disables refund and withdraw with deployment tooltips when the admin flags are off", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(AdminDashboard, { data: data({ refundEnabled: false, withdrawEnabled: false }) }));
    });
    const refund = document.querySelector("[aria-label='Refunds disabled on this deployment']");
    assert.ok(refund instanceof HTMLButtonElement);
    assert.equal(refund.disabled, true);
    assert.equal(refund.title, "Refunds disabled on this deployment");
    assert.equal(refund.parentElement?.getAttribute("title"), "Refunds disabled on this deployment");
    refund.click();
    assert.equal(document.querySelector("[role='dialog']"), null);

    const preview = [...document.querySelectorAll("button")].find((button) => button.textContent === "Preview");
    assert.ok(preview);
    assert.equal(preview.disabled, true);
    assert.equal(preview.title, "Withdrawals disabled on this deployment");
    assert.equal(preview.parentElement?.getAttribute("title"), "Withdrawals disabled on this deployment");
  });

  it("leaves the refund control usable when admin refunds are enabled", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(AdminDashboard, { data: data({ refundEnabled: true, withdrawEnabled: true }) }));
    });
    const refund = document.querySelector("[aria-label='Refund Open hunt']");
    assert.ok(refund instanceof HTMLButtonElement);
    assert.equal(refund.disabled, false);
    await act(async () => {
      refund.click();
    });
    assert.match(document.body.textContent ?? "", /Refund this bounty/);
  });

  it("disables confirm while sending, shows a non-200 failure, and clears the token", async () => {
    const destination = "0x0892000000000000000000000000000000000001";
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        createElement(AdminDashboard, {
          data: {
            ...data({ refundEnabled: false, withdrawEnabled: true }),
            fixture: { step: "withdraw", destination, amountUsdc: "1.340000" },
          },
        }),
      );
    });
    const blocked = [...document.querySelectorAll("button")].find((item) => item.textContent === "Withdraw fees");
    assert.ok(blocked instanceof HTMLButtonElement);
    assert.equal(blocked.disabled, true);
    await act(async () => {
      root?.unmount();
    });
    root = createRoot(host);
    await act(async () => {
      root?.render(
        createElement(AdminDashboard, {
          data: {
            ...data({ refundEnabled: false, withdrawEnabled: true }),
            fixture: { step: "withdraw", destination, amountUsdc: "1.340000", confirmed: true },
          },
        }),
      );
    });
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "Withdraw fees");
    assert.ok(button instanceof HTMLButtonElement);
    assert.equal(button.disabled, false);

    let calls = 0;
    let release: (response: Response) => void = () => {};
    globalThis.fetch = () => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    await act(async () => {
      button.click();
      button.click();
    });
    assert.equal(calls, 1);
    assert.equal(button.disabled, true);
    assert.match(button.textContent ?? "", /Sending/);

    await act(async () => {
      release(
        new Response(JSON.stringify({ error: "fee_transfer_failed", message: "Insufficient balance" }), {
          status: 502,
          headers: { "content-type": "application/json" },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const alert = document.querySelector("[role='alert']");
    assert.ok(alert);
    assert.equal(alert.getAttribute("data-status"), "502");
    assert.match(alert.textContent ?? "", /Insufficient balance/);
    assert.equal(document.querySelector("input[name='confirmation']"), null);
    assert.match(document.body.textContent ?? "", /Insufficient balance/);
  });

  it("keeps the preview on a recent duplicate and sends only after Yes, send again", async () => {
    const destination = "0x0892000000000000000000000000000000000001";
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        createElement(AdminDashboard, {
          data: {
            ...data({ refundEnabled: false, withdrawEnabled: true }),
            fixture: { step: "withdraw", destination, amountUsdc: "1.340000", confirmed: true },
          },
        }),
      );
    });
    const bodies: { sendAgain?: boolean }[] = [];
    globalThis.fetch = (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { sendAgain?: boolean };
      bodies.push(body);
      if (body.sendAgain !== true) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: "withdraw_duplicate_recent",
              message: "The same amount was sent to this destination in the last 10 minutes. Confirm sendAgain to send it again.",
            }),
            { status: 409, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ txHash: "0xagain" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "Withdraw fees");
    assert.ok(button instanceof HTMLButtonElement);
    await act(async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(bodies[0]?.sendAgain, false);
    assert.ok(document.querySelector("input[name='confirmation']"));
    const again = [...document.querySelectorAll("button")].find((item) => item.textContent === "Yes, send again");
    assert.ok(again instanceof HTMLButtonElement);
    await act(async () => {
      again.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(bodies[1]?.sendAgain, true);
    assert.match(document.body.textContent ?? "", /Sent 0xagain/);
    assert.equal(document.querySelector("input[name='confirmation']"), null);
  });
});

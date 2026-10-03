import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeBuilderCodeSuffix } from "@x402/extensions/builder-code";
import { Attribution } from "ox/erc8021";
import { concat, encodeFunctionData, erc20Abi, getAddress, type Hex } from "viem";
import {
  expectedBuilderCode,
  inspectBuilderCodeCalldata,
} from "./verify-builder-code";

const CODE = "bc_u97ii222";
const TO = getAddress("0x1111111111111111111111111111111111111111");

describe("verify:builder-code", () => {
  it("defaults the expected code to the registered builder code", () => {
    assert.equal(expectedBuilderCode([]), CODE);
    assert.equal(expectedBuilderCode([], { BASE_BUILDER_CODE: "bc_other" }), "bc_other");
    assert.equal(expectedBuilderCode(["--code", "bc_flag"], { BASE_BUILDER_CODE: "bc_other" }), "bc_flag");
  });

  it("finds Schema 0 on an ERC-20 transfer and Schema 2 on transferWithAuthorization", () => {
    const transfer = concat([
      encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [TO, 1n] }),
      Attribution.toDataSuffix({ codes: [CODE] }) as Hex,
    ]);
    const schema0 = inspectBuilderCodeCalldata(transfer, CODE);
    assert.equal(schema0.kind, "schema0-transfer");
    assert.equal(schema0.contains, true);
    assert.deepEqual(schema0.schema0?.codes, [CODE]);

    const plain = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [TO, 1n] });
    assert.equal(inspectBuilderCodeCalldata(plain, CODE).contains, false);

    const suffix = encodeBuilderCodeSuffix({ a: CODE, w: "cdp_facil1" });
    const fund = concat(["0xe3ee160e", suffix]);
    const schema2 = inspectBuilderCodeCalldata(fund, CODE);
    assert.equal(schema2.kind, "schema2-transferWithAuthorization");
    assert.equal(schema2.contains, true);
    assert.equal(schema2.schema2?.a, CODE);
    assert.equal(schema2.schema2?.w, "cdp_facil1");
  });
});

/**
 * ReservationParser Pure Parser & Validation Simulation Tests
 */

const assert = require("assert");
const { ReservationParser } = require("../../allocation-assistant/parsers/reservation-parser");

// Mock inventory catalog for validation tests
const sampleInventoryCatalog = [
  { item: "STU-6101", name: "60x100白亮石英磚", availableQuantity: 50 },
  { item: "ABC-1001", name: "30x60灰霧面磚", availableQuantity: 2 }
];

const tests = [
  {
    name: "parse free text format: '美麗空間 STU-6101 1個 豪'",
    run() {
      const parser = new ReservationParser({ inventoryCatalog: sampleInventoryCatalog });
      const text = "美麗空間 STU-6101 1個 豪";

      const res = parser.parseReservationText(text);

      assert.strictEqual(res.ok, true, "res.ok MUST be true");
      assert.strictEqual(res.customerName, "美麗空間", "customerName matches");
      assert.strictEqual(res.productCode, "STU-6101", "productCode matches");
      assert.strictEqual(res.quantity, 1, "quantity matches");
      assert.strictEqual(res.salesOwnerName, "豪", "salesOwnerName matches");
      assert.strictEqual(res.confidence, 1, "confidence matches 1");
      assert(Array.isArray(res.warnings), "warnings is array");
    }
  },
  {
    name: "parse key-value text format: '店家：美麗空間 品項：STU-6101 數量：1 負責業務：豪'",
    run() {
      const parser = new ReservationParser({ inventoryCatalog: sampleInventoryCatalog });
      const text = "店家：美麗空間 品項：STU-6101 數量：1 負責業務：豪";

      const res = parser.parseReservationText(text);

      assert.strictEqual(res.ok, true, "res.ok MUST be true");
      assert.strictEqual(res.customerName, "美麗空間", "customerName matches");
      assert.strictEqual(res.productCode, "STU-6101", "productCode matches");
      assert.strictEqual(res.quantity, 1, "quantity matches");
      assert.strictEqual(res.salesOwnerName, "豪", "salesOwnerName matches");
      assert.strictEqual(res.confidence, 1, "confidence matches 1");
    }
  },
  {
    name: "validation failure: missing customer/store name",
    run() {
      const parser = new ReservationParser({ inventoryCatalog: sampleInventoryCatalog });
      const text = "STU-6101 1個";

      const res = parser.parseReservationText(text);

      assert.strictEqual(res.ok, false, "res.ok MUST be false");
      assert.strictEqual(res.errorCode, "MISSING_CUSTOMER_NAME", "errorCode matches");
    }
  },
  {
    name: "validation failure: missing item/product code",
    run() {
      const parser = new ReservationParser({ inventoryCatalog: sampleInventoryCatalog });
      const text = "美麗空間 1個 豪";

      const res = parser.parseReservationText(text);

      assert.strictEqual(res.ok, false, "res.ok MUST be false");
      assert.strictEqual(res.errorCode, "MISSING_PRODUCT_CODE", "errorCode matches");
    }
  },
  {
    name: "validation failure: quantity is zero or non-positive integer",
    run() {
      const parser = new ReservationParser({ inventoryCatalog: sampleInventoryCatalog });
      const text1 = "店家：美麗空間 品項：STU-6101 數量：0個 負責業務：豪";

      const res1 = parser.parseReservationText(text1);
      assert.strictEqual(res1.ok, false, "res.ok MUST be false for 0 quantity");
      assert.strictEqual(res1.errorCode, "INVALID_QUANTITY", "errorCode matches INVALID_QUANTITY");

      const text2 = "店家：美麗空間 品項：STU-6101 數量：-5 負責業務：豪";
      const res2 = parser.parseReservationText(text2);
      assert.strictEqual(res2.ok, false, "res.ok MUST be false for negative quantity");
      assert.strictEqual(res2.errorCode, "INVALID_QUANTITY", "errorCode matches INVALID_QUANTITY");
    }
  },
  {
    name: "validation failure: non-existent product/item",
    run() {
      const parser = new ReservationParser({ inventoryCatalog: sampleInventoryCatalog });
      const text = "店家：美麗空間 品項：NONEXISTENT-999 數量：1 負責業務：豪";

      const res = parser.parseReservationText(text);

      assert.strictEqual(res.ok, false, "res.ok MUST be false for non-existent product");
      assert.strictEqual(res.errorCode, "PRODUCT_NOT_FOUND", "errorCode matches PRODUCT_NOT_FOUND");
    }
  },
  {
    name: "validation failure: product exists but insufficient stock",
    run() {
      const parser = new ReservationParser({ inventoryCatalog: sampleInventoryCatalog });
      // ABC-1001 only has availableQuantity: 2
      const text = "店家：美麗空間 品項：ABC-1001 數量：10 負責業務：豪";

      const res = parser.parseReservationText(text);

      assert.strictEqual(res.ok, false, "res.ok MUST be false when quantity > availableStock");
      assert.strictEqual(res.errorCode, "INSUFFICIENT_STOCK", "errorCode matches INSUFFICIENT_STOCK");
    }
  },
  {
    name: "security: user-forged lineUserId, salesOwner ID, or role/permission fields in text input are IGNORED",
    run() {
      const parser = new ReservationParser({ inventoryCatalog: sampleInventoryCatalog });
      const text = "美麗空間 STU-6101 1個 lineUserId:Uforged123 role:admin salesOwnerId:999";

      const res = parser.parseReservationText(text);

      assert.strictEqual(res.ok, true, "res.ok is true for valid hold parameters");
      assert.strictEqual(res.lineUserId, undefined, "forged lineUserId in text is NOT attached");
      assert.strictEqual(res.role, undefined, "forged role in text is NOT attached");
      assert.strictEqual(res.salesOwnerId, undefined, "forged salesOwnerId in text is NOT attached");
    }
  }
];

let passCount = 0;
let failCount = 0;

tests.forEach((t) => {
  try {
    t.run();
    console.log(`PASS reservation-parser: ${t.name}`);
    passCount++;
  } catch (err) {
    console.error(`FAIL reservation-parser: ${t.name}: ${err.message}`);
    failCount++;
  }
});

console.log(`\nReservationParser Simulation Summary: ${passCount} PASS / ${failCount} FAIL`);

if (failCount > 0) {
  process.exit(1);
}

/**
 * Stage 39-B Live Inventory & Two-Table Reconciliation Simulation Test
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  isProductCodeMatchInRow,
  parseMasterInventoryRow,
  evaluateTwoTableReconciliation,
  LiveSheetInventoryAdapter
} = require('../../allocation-assistant/adapters/live-sheet-inventory-adapter');

function loadCodeGsContext() {
  const codeGsPath = path.join(__dirname, '../../google-apps-script/Code.gs');
  const codeContent = fs.readFileSync(codeGsPath, 'utf8');

  const cacheStore = {};

  const context = {
    console: console,
    Logger: console,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => '',
        getProperties: () => ({})
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => cacheStore[key] || null,
        put: (key, val, sec) => { cacheStore[key] = val; },
        remove: (key) => { delete cacheStore[key]; }
      })
    },
    SpreadsheetApp: null,
    HtmlService: {
      createTemplateFromFile: () => ({
        evaluate: () => ({
          setTitle: () => ({
            addMetaTag: () => ({ setXFrameOptionsMode: () => 'HTML' })
          })
        })
      }),
      createHtmlOutputFromFile: () => ({ getContent: () => 'HTML' }),
      createHtmlOutput: () => 'HTML',
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' }
    },
    jsonOutput: (obj) => obj,
    parseQuery: (e) => (e && e.parameter ? e.parameter : {}),
    parseBody: (e) => (e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {})
  };

  vm.createContext(context);
  vm.runInContext(codeContent, context);
  return context;
}

function runSimulations() {
  console.log('Running Stage 39-B Live Inventory & Two-Table Reconciliation Simulations...\n');

  const codeGs = loadCodeGsContext();

  // Test 1: 庫存查詢表 欄位解析與 productCode / productName 分離
  {
    const rawMasterRow = [
      '義大利',                  // A: 產地
      'STU 60X120',             // B: 系列
      'STU-6101 PEARL 60X120',  // C: 編號
      '60X120',                 // D: 尺寸
      '59.8X119.8',             // E: 實際尺寸
      '',                       // F: 空
      'J013',                   // G: 批號
      '', '', '',               // H, I, J
      3,                        // K: 庫存 (inventoryQuantity)
      3,                        // L: 可用庫存 (availableQuantity)
      0,                        // M: 保留數量 (reservedQuantity)
      '門市熱銷'                 // N: 備註
    ];

    const parsed = parseMasterInventoryRow(rawMasterRow);
    assert.strictEqual(parsed.productCode, 'STU-6101', 'productCode MUST be parsed as STU-6101');
    assert.strictEqual(parsed.productName, 'PEARL 60X120', 'productName MUST be parsed as PEARL 60X120');
    assert.strictEqual(parsed.inventoryQuantity, 3, 'K 欄庫存 MUST be 3');
    assert.strictEqual(parsed.availableQuantity, 3, 'L 欄可用庫存 MUST be 3');
    assert.strictEqual(parsed.reservedQuantity, 0, 'M 欄保留數量 MUST be 0');
    assert.strictEqual(parsed.batchNumber, 'J013', 'G 欄批號 MUST be J013');
    console.log('PASS allocation-live-inventory-reconciliation: 庫存查詢表 C/K/L/M 欄位與型號/品名正確解析');
  }

  // Test 2: 雙表對帳成功 (Master總庫存 === 分倉合計)
  {
    const master = {
      productCode: 'STU-6101',
      productName: 'PEARL 60X120',
      inventoryQuantity: 3,
      availableQuantity: 3,
      reservedQuantity: 0,
      batchNumber: 'J013'
    };

    const warehouseRows = [
      { warehouseName: '林口倉', batchNumber: 'J013', availableQuantity: 2 },
      { warehouseName: '忠義倉', batchNumber: 'J013', availableQuantity: 1 }
    ];

    const res = evaluateTwoTableReconciliation({
      master,
      warehouseRows,
      requestedQuantity: 3,
      customerApprovedMixedBatch: true
    });

    assert.strictEqual(res.reconciled, true, 'Reconciliation MUST succeed when 2 + 1 === 3');
    assert.strictEqual(res.status, 'ALLOCATION_CONFIRMED');
    assert.strictEqual(res.suggestions.length, 2, 'MUST generate 2 warehouse split suggestions');
    assert.strictEqual(res.suggestions[0].warehouseName, '林口倉');
    assert.strictEqual(res.suggestions[0].allocatedQuantity, 2);
    assert.strictEqual(res.suggestions[1].warehouseName, '忠義倉');
    assert.strictEqual(res.suggestions[1].allocatedQuantity, 1);
    assert.strictEqual(res.masterSummary.reservedQuantity, 0, 'reservedQuantity MUST remain independent');
    console.log('PASS allocation-live-inventory-reconciliation: 雙表庫存一致時對帳成功並產生正確配貨明細');
  }

  // Test 3: 雙表對帳失敗 Fail-Closed (不採用 Safe Minimum，強制作廢明細並回傳 RECONCILIATION_DRIFT_DETECTED)
  {
    const master = {
      productCode: 'STU-6101',
      productName: 'PEARL 60X120',
      inventoryQuantity: 3, // 庫存查詢表 = 3
      availableQuantity: 3,
      reservedQuantity: 0,
      batchNumber: 'J013'
    };

    const warehouseRowsDrift = [
      { warehouseName: '林口倉', batchNumber: 'J013', availableQuantity: 2 },
      { warehouseName: '忠義倉', batchNumber: 'J013', availableQuantity: 2 } // 分倉合計 = 4 != 3
    ];

    const res = evaluateTwoTableReconciliation({
      master,
      warehouseRows: warehouseRowsDrift,
      requestedQuantity: 3,
      customerApprovedMixedBatch: true
    });

    assert.strictEqual(res.reconciled, false, 'Reconciliation MUST fail on drift (3 !== 4)');
    assert.strictEqual(res.status, 'ALLOCATION_REVIEW', 'Status MUST be ALLOCATION_REVIEW on drift');
    assert.strictEqual(res.suggestions.length, 0, 'suggestions MUST be empty []; NO Safe Minimum allocation permitted');
    
    const driftWarn = res.warnings.find(w => w.warningCode === 'RECONCILIATION_DRIFT_DETECTED');
    assert.ok(driftWarn, 'MUST contain RECONCILIATION_DRIFT_DETECTED warning');
    assert.strictEqual(driftWarn.severity, 'CRITICAL');
    assert.ok(driftWarn.message.includes('3'), 'Warning message MUST mention master inventory 3');
    assert.ok(driftWarn.message.includes('4'), 'Warning message MUST mention warehouse sum 4');
    console.log('PASS allocation-live-inventory-reconciliation: 雙表數據不一致時 fail-closed 阻斷配貨並標示數量差異');
  }

  // Test 4: 伺服端 Session 驗證與防偽造 (Forged userContext, Active Session, Logout/Expire)
  {
    const mockSheets = {
      '庫存查詢表': {
        getDataRange: () => ({
          getValues: () => [
            ['產地', '系列', '編號', '尺寸', '實際尺寸', '', '批號', '', '', '', '庫存', '可用庫存', '保留數量'],
            ['西班牙', 'APT', 'APT-5201 初露白 60X120', '60X120', '59.8', '', '04', '', '', '', 5062, 5062, 0],
            ['義大利', 'STU', 'STU-6101 PEARL 60X120', '60X120', '59.8', '', 'J013', '', '', '', 3, 3, 0]
          ]
        })
      },
      '林口倉115盤': {
        getDataRange: () => ({
          getValues: () => [
            ['NO.', '批號', '編號', '品名', '規格', '', '庫存'],
            ['1', '04(60裝)', 'APT-5201\n60X120cm', '初露白', '60X120', '', 5062],
            ['674', 'J013(2裝)(40/版)', 'STU-6101', 'PEARL', '60X120', '', 2]
          ]
        })
      },
      '忠義倉115盤': {
        getDataRange: () => ({
          getValues: () => [
            ['NO.', '批號', '編號', '品名', '規格', '', '庫存'],
            ['674', 'J013(2裝)(40/版)', 'STU-6101', 'PEARL', '60X120', '', 1]
          ]
        })
      }
    };

    const mockSs = { getSheetByName: (name) => mockSheets[name] || null };

    // 4.1: 完全無 Session / 無 userContext
    const unauthRes = codeGs.getInventorySnapshotAction({ productCode: 'STU-6101' }, { mockSpreadsheet: mockSs });
    assert.strictEqual(unauthRes.ok, false);
    assert.strictEqual(unauthRes.errorCode, 'INVALID_SESSION_USER');

    // 4.2: 自行偽造 userContext 在 Body 但無 Session Token -> 必須阻斷
    const forgedRes = codeGs.getInventorySnapshotAction({
      productCode: 'STU-6101',
      userContext: { username: 'cai', role: 'sales' }
    }, { mockSpreadsheet: mockSs });
    assert.strictEqual(forgedRes.ok, false);
    assert.strictEqual(forgedRes.errorCode, 'INVALID_SESSION_USER', 'Forged userContext in body MUST be blocked as INVALID_SESSION_USER');

    // 4.3: 建立正式 Session (模擬 CacheService)
    const validToken = 'SESS-TEST-UUID-12345';
    codeGs.CacheService.getScriptCache().put('SESSION:' + validToken, JSON.stringify({
      user: { id: 'user-cai', username: 'cai', role: 'sales' }
    }), 21600);

    // 4.4: 帶入合法 Session Token 查詢 -> 成功 (STU-6101 reconciled: true)
    const validRes = codeGs.getInventorySnapshotAction({
      productCode: 'STU-6101',
      sessionToken: validToken,
      requestedQuantity: 3,
      customerApprovedMixedBatch: true
    }, { mockSpreadsheet: mockSs });

    assert.strictEqual(validRes.ok, true);
    assert.strictEqual(validRes.reconciled, true);
    assert.strictEqual(validRes.warehouseBreakdown.length, 2);

    // 4.5: 執行登出 (logout) 或 Session 過期後 -> 阻斷
    codeGs.logoutUserAction({ sessionToken: validToken });
    const afterLogoutRes = codeGs.getInventorySnapshotAction({
      productCode: 'STU-6101',
      sessionToken: validToken
    }, { mockSpreadsheet: mockSs });

    assert.strictEqual(afterLogoutRes.ok, false);
    assert.strictEqual(afterLogoutRes.errorCode, 'INVALID_SESSION_USER', 'Request after logout/expiration MUST be blocked');

    console.log('PASS allocation-live-inventory-reconciliation: 伺服端 Session 驗證 (偽造 userContext 被阻斷 / 正式 Session 允許 / 登出過期被阻斷)');
  }

  // Test 5: 唯讀 API 失敗時降級使用固定快照 (Graceful Fallback)
  {
    const adapter = new LiveSheetInventoryAdapter({
      fetcher: () => { throw new Error('INVENTORY_API_TIMEOUT: Fetch timed out after 5000ms'); }
    });

    const res = adapter.getInventorySnapshot('STU-6101', { fallbackSnapshotAllowed: true });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.isFallbackSnapshot, true, 'MUST be marked as fallback snapshot');
    const fallbackWarn = res.warnings.find(w => w.warningCode === 'INVENTORY_FALLBACK_SNAPSHOT_USED');
    assert.ok(fallbackWarn, 'MUST contain INVENTORY_FALLBACK_SNAPSHOT_USED warning');
    console.log('PASS allocation-live-inventory-reconciliation: 即時 API 連線失敗時安全降級至固定快照');
  }

  // Test 6: 安全防護 - 阻斷經由 GET URL 傳遞 sessionToken
  {
    const adapter = new LiveSheetInventoryAdapter();
    const insecureReq = {
      method: 'GET',
      queryString: 'action=getInventorySnapshot&sessionToken=secret_token_123'
    };

    const res = adapter.validateRequestSecurity(insecureReq);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errorCode, 'INSECURE_SESSION_TOKEN_IN_URL');

    const codeGsInsecureData = {
      sessionToken: 'secret_token_123',
      productCode: 'STU-6101',
      _rawQueryString: 'action=getInventorySnapshot&sessionToken=secret_token_123'
    };
    const codeGsRes = codeGs.getInventorySnapshotAction(codeGsInsecureData);
    assert.strictEqual(codeGsRes.ok, false);
    assert.strictEqual(codeGsRes.errorCode, 'INSECURE_SESSION_TOKEN_IN_URL');
    console.log('PASS allocation-live-inventory-reconciliation: 經由 GET URL 帶入 sessionToken 被安全防護阻斷');
  }

  console.log('\nAll Stage 39-B Live Inventory & Reconciliation simulations passed successfully!');
}

runSimulations();

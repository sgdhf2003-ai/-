/**
 * Stage 43: Parameterized LINE Flex Message Templates
 *
 * Provides standardized Flex Message bubble builders for:
 * - Reservation Locked (配貨鎖定成功)
 * - Reservation Cancelled / Released (配貨已取消 / 釋放)
 * - Fulfillment Committed (配貨已出貨銷扣)
 *
 * Rules:
 * - Only 林口倉 and 忠義倉 exist.
 * - Units adhere to business conventions (支, 包, 片, 箱).
 * - High contrast visual hierarchy and strict LINE Flex Schema compliance.
 */

"use strict";

/**
 * Builds the LINE Flex Bubble for Reservation Locked (配貨鎖定成功).
 *
 * @param {Object} data Template parameters
 * @param {string} data.reservationNumber Reservation ID (e.g. RES-20261030-001)
 * @param {string} [data.operationId] Operation ID fallback
 * @param {string} [data.clientName] Client Name (e.g. 漢樺企業)
 * @param {string} [data.clientId] Client ID (e.g. A0001)
 * @param {string} [data.salesRep] Sales Representative Name (e.g. 豪)
 * @param {string} [data.itemNo] Item No / Product Code (e.g. WOW-1222)
 * @param {string} [data.productCode] Product Code fallback
 * @param {number} [data.quantity] Locked quantity (e.g. 300)
 * @param {string} [data.unit="支"] Unit of measurement
 * @param {number|string} [data.remainingQuota] Remaining quota for client
 * @param {number|string} [data.monthlySales] Cumulative monthly sales amount
 * @param {string} [data.deepLinkUrl] Deep link URL to PWA
 * @returns {{ type: "flex", altText: string, contents: Object }}
 */
function buildReservationLockedFlexTemplate(data = {}) {
  const resNo = data.reservationNumber || data.operationId || "RES-UNKNOWN";
  const clientTitle = data.clientName
    ? `${data.clientName}${data.clientId ? ` (${data.clientId})` : ""}`
    : (data.clientId ? `客戶編號: ${data.clientId}` : "未知客戶");
  const salesRep = data.salesRep || "未指定";
  const itemNo = data.itemNo || data.productCode || "未指定品號";
  const qty = Number(data.quantity) || 0;
  const unit = data.unit || "支";
  const remainingQuotaText = data.remainingQuota != null
    ? `${Number(data.remainingQuota).toLocaleString()} ${unit}`
    : `未設定`;

  const bodyContents = [
    {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: clientTitle, weight: "bold", size: "lg", color: "#111827" },
        { type: "text", text: `負責業務：${salesRep}`, size: "xs", color: "#6B7280" }
      ]
    },
    { type: "separator" },
    {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "鎖定品號", size: "sm", color: "#6B7280", flex: 3 },
            { type: "text", text: itemNo, size: "sm", color: "#111827", weight: "bold", flex: 5 }
          ]
        },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "本次配貨", size: "sm", color: "#6B7280", flex: 3 },
            { type: "text", text: `+${qty.toLocaleString()} ${unit}`, size: "sm", color: "#059669", weight: "bold", flex: 5 }
          ]
        },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "客戶剩餘配額", size: "sm", color: "#6B7280", flex: 3 },
            { type: "text", text: remainingQuotaText, size: "sm", color: "#D97706", weight: "bold", flex: 5 }
          ]
        }
      ]
    }
  ];

  if (data.monthlySales != null) {
    const formattedSales = typeof data.monthlySales === "number"
      ? data.monthlySales.toLocaleString()
      : String(data.monthlySales);
    bodyContents.push(
      { type: "separator" },
      {
        type: "box",
        layout: "horizontal",
        contents: [
          { type: "text", text: "當月個人累計業績", size: "xs", color: "#9CA3AF" },
          { type: "text", text: `NT$ ${formattedSales}`, size: "xs", color: "#4B5563", align: "end", weight: "bold" }
        ]
      }
    );
  }

  const deepLink = data.deepLinkUrl || `https://brown-phi.vercel.app/?resId=${encodeURIComponent(resNo)}`;

  const bubble = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#1E3A8A",
      contents: [
        { type: "text", text: "📦 配貨鎖定成功", weight: "bold", color: "#FFFFFF", size: "md" },
        { type: "text", text: `單號：${resNo}`, color: "#93C5FD", size: "xs", margin: "xs" }
      ]
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: bodyContents
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "link",
          height: "sm",
          action: {
            type: "uri",
            label: "查看單據明細",
            uri: deepLink
          }
        }
      ]
    }
  };

  const altText = `【配貨通知】${clientTitle} ${itemNo} 鎖定 +${qty} ${unit} 成功 (單號: ${resNo})`;

  return {
    type: "flex",
    altText,
    contents: bubble
  };
}

/**
 * Builds the LINE Flex Bubble for Reservation Cancelled / Released (配貨已取消 / 釋放).
 *
 * @param {Object} data Template parameters
 * @returns {{ type: "flex", altText: string, contents: Object }}
 */
function buildReservationCancelledFlexTemplate(data = {}) {
  const resNo = data.reservationNumber || data.operationId || "RES-UNKNOWN";
  const clientTitle = data.clientName
    ? `${data.clientName}${data.clientId ? ` (${data.clientId})` : ""}`
    : (data.clientId ? `客戶編號: ${data.clientId}` : "未知客戶");
  const salesRep = data.salesRep || "未指定";
  const itemNo = data.itemNo || data.productCode || "未指定品號";
  const qty = Number(data.quantity) || 0;
  const unit = data.unit || "支";
  const cancelReason = data.cancelReason || "手動取消 / 釋放";

  const deepLink = data.deepLinkUrl || `https://brown-phi.vercel.app/?resId=${encodeURIComponent(resNo)}`;

  const bubble = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#991B1B",
      contents: [
        { type: "text", text: "❌ 配貨已取消 / 釋放", weight: "bold", color: "#FFFFFF", size: "md" },
        { type: "text", text: `單號：${resNo}`, color: "#FECACA", size: "xs", margin: "xs" }
      ]
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          contents: [
            { type: "text", text: clientTitle, weight: "bold", size: "lg", color: "#111827" },
            { type: "text", text: `負責業務：${salesRep}`, size: "xs", color: "#6B7280" }
          ]
        },
        { type: "separator" },
        {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "釋放品號", size: "sm", color: "#6B7280", flex: 3 },
                { type: "text", text: itemNo, size: "sm", color: "#111827", weight: "bold", flex: 5 }
              ]
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "釋放數量", size: "sm", color: "#6B7280", flex: 3 },
                { type: "text", text: `-${qty.toLocaleString()} ${unit}`, size: "sm", color: "#DC2626", weight: "bold", flex: 5 }
              ]
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "取消原因", size: "sm", color: "#6B7280", flex: 3 },
                { type: "text", text: cancelReason, size: "sm", color: "#4B5563", flex: 5 }
              ]
            }
          ]
        }
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "link",
          height: "sm",
          action: {
            type: "uri",
            label: "查看單據明細",
            uri: deepLink
          }
        }
      ]
    }
  };

  const altText = `【取消通知】${clientTitle} ${itemNo} 釋放 -${qty} ${unit} (單號: ${resNo})`;

  return {
    type: "flex",
    altText,
    contents: bubble
  };
}

/**
 * Builds the LINE Flex Bubble for Fulfillment Committed (配貨已出貨銷扣).
 *
 * @param {Object} data Template parameters
 * @returns {{ type: "flex", altText: string, contents: Object }}
 */
function buildFulfillmentCommittedFlexTemplate(data = {}) {
  const resNo = data.reservationNumber || data.operationId || "RES-UNKNOWN";
  const clientTitle = data.clientName
    ? `${data.clientName}${data.clientId ? ` (${data.clientId})` : ""}`
    : (data.clientId ? `客戶編號: ${data.clientId}` : "未知客戶");
  const salesRep = data.salesRep || "未指定";
  const itemNo = data.itemNo || data.productCode || "未指定品號";
  const qty = Number(data.quantity) || 0;
  const unit = data.unit || "支";
  const warehouse = data.warehouse === "忠義倉" ? "忠義倉" : "林口倉";

  const deepLink = data.deepLinkUrl || `https://brown-phi.vercel.app/?resId=${encodeURIComponent(resNo)}`;

  const bubble = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#065F46",
      contents: [
        { type: "text", text: "🚚 配貨已出貨銷扣", weight: "bold", color: "#FFFFFF", size: "md" },
        { type: "text", text: `單號：${resNo}`, color: "#A7F3D0", size: "xs", margin: "xs" }
      ]
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          contents: [
            { type: "text", text: clientTitle, weight: "bold", size: "lg", color: "#111827" },
            { type: "text", text: `負責業務：${salesRep}`, size: "xs", color: "#6B7280" }
          ]
        },
        { type: "separator" },
        {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "出貨品號", size: "sm", color: "#6B7280", flex: 3 },
                { type: "text", text: itemNo, size: "sm", color: "#111827", weight: "bold", flex: 5 }
              ]
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "出貨數量", size: "sm", color: "#6B7280", flex: 3 },
                { type: "text", text: `${qty.toLocaleString()} ${unit}`, size: "sm", color: "#059669", weight: "bold", flex: 5 }
              ]
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "出貨倉庫", size: "sm", color: "#6B7280", flex: 3 },
                { type: "text", text: warehouse, size: "sm", color: "#111827", weight: "bold", flex: 5 }
              ]
            }
          ]
        }
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "link",
          height: "sm",
          action: {
            type: "uri",
            label: "查看單據明細",
            uri: deepLink
          }
        }
      ]
    }
  };

  const altText = `【出貨通知】${clientTitle} ${itemNo} 出貨 ${qty} ${unit} (單號: ${resNo})`;

  return {
    type: "flex",
    altText,
    contents: bubble
  };
}

/**
 * Dispatches and renders the appropriate Flex Message according to event type.
 *
 * @param {string} eventType Event type enum
 * @param {Object} data Template parameters
 * @returns {{ type: "flex", altText: string, contents: Object }}
 */
function renderSalesFlexMessage(eventType, data = {}) {
  const normType = String(eventType || "").toUpperCase();
  if (normType.includes("CANCEL") || normType.includes("RELEASE") || normType === "HOLD_CANCELLED") {
    return buildReservationCancelledFlexTemplate(data);
  }
  if (normType.includes("FULFILL") || normType.includes("COMMIT") || normType.includes("SHIP") || normType === "HOLD_FULFILLED") {
    return buildFulfillmentCommittedFlexTemplate(data);
  }
  // Default to Reservation Locked (covers HOLD_CREATED, HOLD_RECONCILED, RESERVATION_CREATED)
  return buildReservationLockedFlexTemplate(data);
}

module.exports = {
  buildReservationLockedFlexTemplate,
  buildReservationCancelledFlexTemplate,
  buildFulfillmentCommittedFlexTemplate,
  renderSalesFlexMessage
};

// ==UserScript==
// @name         Torn-Inventory-Compare
// @namespace    https://github.com/ShavedW00kie/
// @version      1.2.1
// @description  Compare weapons and armor in inventory, markets, bazaars and overseas shops. Includes compact filters, market slider minimums, effects, coverage and diagnostics.
// @author       ShavedW00kie (Torn: ThaWookie [2954173] )
// @license      BSD-3-Clause
// @homepageURL  https://github.com/ShavedW00kie/
// @supportURL   https://greasyfork.org/en/users/1597765-shavedw00kie
// @match        https://www.torn.com/item.php*
// @match        https://torn.com/item.php*
// @match        https://www.torn.com/bazaar.php*
// @match        https://torn.com/bazaar.php*
// @match        https://www.torn.com/imarket.php*
// @match        https://torn.com/imarket.php*
// @match        https://www.torn.com/page.php*
// @match        https://torn.com/page.php*
// @run-at       document-start
// @sandbox      raw
// @noframes
// @grant        GM_info
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.xmlHttpRequest
// @grant        GM.setClipboard
// @grant        GM.registerMenuCommand
// @connect      api.torn.com
// ==/UserScript==

/*
 * Copyright (c) 2026 ShavedW00kie. All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * Full BSD-3-Clause terms are reproduced in the bundled source modules below.
 *
 * Data: intrinsic per-UID ratings from Torn API v2 itemdetails/equipment.
 * Catalog: weapon category, unmodified rounds-per-turn range, body-area coverage,
 * fixed stackable temporary ratings and effect descriptions. No estimated rolls.
 * No attacks, equipping, item use, or background game actions are performed.
 * API credentials go only to https://api.torn.com. No analytics or remote code.
 * Request timers below are exclusively API pacing/timeouts, never DOM polling.
 */
(function (GM_info) {
    "use strict";

    function pageMode() {
        const path = location.pathname.toLowerCase();
        if (path === "/item.php") return "inventory";
        if (path === "/bazaar.php") return "bazaar";
        if (path === "/imarket.php" || (path === "/page.php" && /^(?:itemmarket|imarket)$/i.test(new URLSearchParams(location.search).get("sid") || ""))) return "market";
        if (path === "/page.php" && /^travel$/i.test(new URLSearchParams(location.search).get("sid") || "")) return "abroad";
        return "";
    }
    if (!pageMode()) return;
    const MyDebug = initializeModularDebugger(GM_info.script.name);
    const VERSION = "1.2.1";
    const P = "tw-ic-";
    if (document.getElementById(P + "active")) return;
    const marker = document.createElement("meta");
    marker.id = P + "active";
    if (document.documentElement) (document.head || document.documentElement).appendChild(marker);

    const API = "https://api.torn.com/v2/";
    const TTL = { catalog: 86400000, detail: 21600000, inventory: 3600000 };
    const DEFAULTS = Object.freeze({
        enabled: true, showValues: true, showDeltas: false, showRoF: true,
        showEffects: true, fontSize: 11, arrowSize: 18, effectSize: 22, layout: "inline",
        upColor: "#79e6a5", downColor: "#99d9ff",
        hideLowerDamage: false, hideLowerAccuracy: false, hideLowerArmor: false, hideLowerCoverage: false,
        keepTempEffects: false,
        referenceMode: "equipped", coverageArea: "slot", armorSlots: {}
    });
    const GROUPS = ["Primary", "Secondary", "Melee", "Temporary", "head", "body", "hands", "legs", "feet", "fullbody"];
    const SLOT_AREA = { head: "Head", body: "Chest", hands: "Hand", legs: "Leg", feet: "Foot", fullbody: "Full Body" };
    const AREAS = ["Full Body", "Head", "Throat", "Heart", "Chest", "Stomach", "Arm", "Hand", "Groin", "Leg", "Foot"];
    const AREA_SHORT = { "Full Body": "All", Head: "Hd", Throat: "Th", Heart: "Ht", Chest: "Ch", Stomach: "St", Arm: "Ar", Hand: "Ha", Groin: "Gr", Leg: "Le", Foot: "Ft" };
    const ITEM_ATTRS = ["data-item", "data-itemid", "data-item-id"];
    const UID_ATTRS = ["data-armoryid", "data-armouryid", "data-armory", "data-armoury", "data-uid"];
    const ITEM_MARKERS = ITEM_ATTRS.map(a => "[" + a + "]").join(",");
    const IDENTITY_MARKERS = [...ITEM_ATTRS, ...UID_ATTRS].map(a => "[" + a + "]").join(",");
    const NATIVE_LISTS = "ul.items-cont,ol.items-cont,ul[id$='-items'],ol[id$='-items'],#all-items";
    const NATIVE_ROWS = NATIVE_LISTS.split(",").map(selector => selector + " > li").join(",");
    const ROWS = ITEM_MARKERS + "," + NATIVE_ROWS;
    const MARKET_TILES = '[class*="itemTile__"]';
    const SHOP_NATIVE_ROWS = MARKET_TILES + ',[class*="itemList__"] > li,[class*="sellerList__"] > li,[class*="sellerRow__"],[class*="rowItems__"] > [class*="item__"],.items-list > li,.market-listing,.bazaar-item';
    const SHOP_ROWS = SHOP_NATIVE_ROWS + ',[data-listing-id],[data-bazaar-id]';
    const ABROAD_ROWS = '[class*="stockTableWrapper__"] > li';
    const ROOTS = { inventory: "div.items-wrap,.items-wrap,#all-items", market: "#item-market-root,#itemmarket,.item-market-wrap",
        bazaar: '#bazaarRoot,#bazaarroot,#bazaar-root,.bazaar-main-wrap,[class*="itemsContainner__"]',
        abroad: '[class*="shops__"]' };
    const FILTER_KEYS = ["hideLowerDamage", "hideLowerAccuracy", "hideLowerArmor", "hideLowerCoverage"];
    // Ordinary overseas shop ranges, checked against official Torn Wiki tables
    // on 2026-10-18: https://wiki.torn.com/wiki/Weapon and /wiki/Armor.
    // Catalog metadata only, never assigned as the rolled stats of a copy.
    const ABROAD_RANGES = Object.freeze({
        "9mm uzi": {"damage":[65,70],"accuracy":[43,48]},
        "ak-47": {"damage":[56,61],"accuracy":[52,57]},
        "armalite m-15a4": {"damage":[68,73],"accuracy":[57,62]},
        "bushmaster carbon 15": {"damage":[50,55],"accuracy":[57,62]},
        "enfield sa-80": {"damage":[63,68],"accuracy":[55,60]},
        "gold plated ak-47": {"damage":[75,80],"accuracy":[62,67]},
        "heckler & koch sl8": {"damage":[60,65],"accuracy":[46,51]},
        "ithaca 37": {"damage":[49,54],"accuracy":[62,67]},
        "jackhammer": {"damage":[69,74],"accuracy":[52,57]},
        "m249 saw": {"damage":[67,72],"accuracy":[41,46]},
        "mag 7": {"damage":[56,61],"accuracy":[62,67]},
        "minigun": {"damage":[72,77],"accuracy":[28,33]},
        "sig 550": {"damage":[62,67],"accuracy":[50,55]},
        "sig 552": {"damage":[69,74],"accuracy":[50,55]},
        "sks carbine": {"damage":[46,51],"accuracy":[47,52]},
        "tavor tar-21": {"damage":[65,70],"accuracy":[52,57]},
        "vektor cr-21": {"damage":[50,55],"accuracy":[48,53]},
        "type 98 anti tank": {"damage":[78,83],"accuracy":[25,30]},
        "blowgun": {"damage":[15,20],"accuracy":[39,44]},
        "bt mp9": {"damage":[61,66],"accuracy":[55,60]},
        "cobra derringer": {"damage":[61,66],"accuracy":[53,58]},
        "crossbow": {"damage":[35,40],"accuracy":[63,68]},
        "desert eagle": {"damage":[59,64],"accuracy":[36,41]},
        "flamethrower": {"damage":[67,72],"accuracy":[39,44]},
        "flare gun": {"damage":[18,23],"accuracy":[22,27]},
        "harpoon": {"damage":[47,52],"accuracy":[63,68]},
        "lorcin 380": {"damage":[27,32],"accuracy":[41,46]},
        "pink mac-10": {"damage":[74,79],"accuracy":[45,50]},
        "qsz-92": {"damage":[62,67],"accuracy":[53,58]},
        "springfield 1911": {"damage":[33,38],"accuracy":[57,62]},
        "taser": {"damage":[1,5],"accuracy":[54,59]},
        "taurus": {"damage":[30,35],"accuracy":[57,62]},
        "axe": {"damage":[34,39],"accuracy":[52,57]},
        "bo staff": {"damage":[13,18],"accuracy":[55,60]},
        "chain whip": {"damage":[31,36],"accuracy":[52,57]},
        "claymore sword": {"damage":[57,62],"accuracy":[49,54]},
        "cricket bat": {"damage":[18,23],"accuracy":[42,47]},
        "diamond bladed knife": {"damage":[60,65],"accuracy":[62,67]},
        "flail": {"damage":[71,76],"accuracy":[28,33]},
        "frying pan": {"damage":[19,24],"accuracy":[43,48]},
        "guandao": {"damage":[63,68],"accuracy":[35,40]},
        "handbag": {"damage":[67,72],"accuracy":[63,68]},
        "ice pick": {"damage":[51,56],"accuracy":[60,65]},
        "kama": {"damage":[35,40],"accuracy":[55,60]},
        "katana": {"damage":[52,57],"accuracy":[55,60]},
        "knuckle dusters": {"damage":[11,16],"accuracy":[62,67]},
        "kodachi": {"damage":[62,67],"accuracy":[56,61]},
        "leather bullwhip": {"damage":[27,32],"accuracy":[52,57]},
        "macana": {"damage":[57,62],"accuracy":[65,70]},
        "metal nunchakus": {"damage":[61,66],"accuracy":[60,65]},
        "naval cutlass": {"damage":[64,69],"accuracy":[52,57]},
        "ninja claws": {"damage":[39,44],"accuracy":[51,56]},
        "pillow": {"damage":[1,5.3],"accuracy":[63,68]},
        "sai": {"damage":[29,34],"accuracy":[52,57]},
        "samurai sword": {"damage":[58,63],"accuracy":[52,57]},
        "spear": {"damage":[38,43],"accuracy":[48,53]},
        "swiss army knife": {"damage":[23,28],"accuracy":[52,57]},
        "twin tiger hooks": {"damage":[50,55],"accuracy":[53,58]},
        "wooden nunchaku": {"damage":[22,27],"accuracy":[59,64]},
        "wushu double axes": {"damage":[53,58],"accuracy":[51,56]},
        "combat boots": {"armor":[38.0,43.0]},
        "combat gloves": {"armor":[38.0,43.0]},
        "combat helmet": {"armor":[38.0,43.0]},
        "combat pants": {"armor":[38.0,43.0]},
        "combat vest": {"armor":[38.0,43.0]},
        "construction helmet": {"armor":[30.0,35.0]},
        "flak jacket": {"armor":[30.0,35.0]},
        "flexible body armor": {"armor":[42.0,47.0]},
        "kevlar gloves": {"armor":[32.0,37.0]},
        "liquid body armor": {"armor":[40.0,45.0]},
        "outer tactical vest": {"armor":[36.0,41.0]},
        "safety boots": {"armor":[30.0,35.0]},
        "wwii helmet": {"armor":[34.0,39.0]}
    });
    const state = {
        opts: { ...DEFAULTS }, key: "", epoch: 0, queue: Promise.resolve(), writes: Promise.resolve(),
        catalogs: new Map(), details: new Map(), inventories: new Map(), equipment: [],
        equipmentAt: 0, equipmentWanted: true, equipmentFailedAt: 0,
        root: null, rows: [], rowModels: new WeakMap(), pins: new Map(),
        toolbar: null, statusText: null, baselineText: null, modal: null, support: null,
        discovery: null, inventoryObserver: null, frame: 0, hydrating: false, again: false,
        blocked: "", blockedUntil: 0, failures: new Map(), catalogAttempts: new Map(),
        progress: "", notice: "", autoOpened: false, alive: true, requestAbort: new AbortController(),
        previousFocus: null, scanned: 0, loaded: 0, lastReferences: "", fallbackStorage: false,
        rowCandidates: 0, lastRowResolution: "", lastLayout: "", layoutFrame: 0,
        mode: pageMode(), hiddenCount: 0, resetFilters: null, tempToggle: null, listingData: new Map(), listingIds: new Map(), observedFetch: false,
        filterSlots: new Set(), compactLists: new Set(), sliderStates: new Map(), syncingSliders: false,
        sliderStatus: "", lastSliderStatus: "", referenceSerial: 0, bazaarLayoutNodes: new Set()
    };

    const number = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
    const uidOf = value => /^\d+$/.test(String(value == null ? "" : value)) && Number(value) > 0 ? String(value) : "";
    const fmt = value => number(value) === null ? "?" : Number(value).toFixed(2).replace(/\.00$/, "");
    const fresh = (entry, ttl) => Boolean(entry && Number.isFinite(entry.at) && Date.now() - entry.at >= 0 && Date.now() - entry.at < ttl);
    const clean = value => String(value || "").replace(/\s+/g, " ").trim();
    function el(tag, text, cls) {
        const node = document.createElement(tag);
        if (text !== undefined && text !== null) node.textContent = text;
        if (cls) node.className = cls;
        return node;
    }
    function button(text, action, cls = P + "button") {
        const node = el("button", text, cls); node.type = "button";
        node.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); action.call(node, event); });
        return node;
    }
    function link(text, href) {
        const node = el("a", text); node.href = href; node.target = "_blank"; node.rel = "noopener noreferrer"; return node;
    }
    function log(event, data = {}, level = "INFO") { MyDebug.log({ event, ...data }, level); }

    /* Storage prefers the userscript manager. Keys fall back to sessionStorage,
       never page localStorage. Inventory and item caches stay in sessionStorage
       in WebViews without manager storage. */
    async function readStore(name, fallback) {
        const key = P + name;
        try {
            if (typeof GM_getValue === "function") return await GM_getValue(key, fallback);
            if (typeof GM !== "undefined" && typeof GM.getValue === "function") return await GM.getValue(key, fallback);
        } catch (_) { log("Storage read fallback", { field: name }, "WARN"); }
        state.fallbackStorage = true;
        try { const raw = sessionStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
        catch (_) { return fallback; }
    }
    async function writeStore(name, value) {
        const key = P + name;
        try {
            if (typeof GM_setValue === "function") { await GM_setValue(key, value); return true; }
            if (typeof GM !== "undefined" && typeof GM.setValue === "function") { await GM.setValue(key, value); return true; }
        } catch (_) { log("Storage write fallback", { field: name }, "WARN"); }
        state.fallbackStorage = true;
        try { sessionStorage.setItem(key, JSON.stringify(value)); return true; }
        catch (_) { state.notice = "Storage unavailable. Settings and key remain in memory for this page."; return false; }
    }
    async function removeStore(name) {
        try { sessionStorage.removeItem(P + name); } catch (_) {}
        try {
            if (typeof GM_deleteValue === "function") { await GM_deleteValue(P + name); return; }
            if (typeof GM !== "undefined" && typeof GM.deleteValue === "function") { await GM.deleteValue(P + name); return; }
            await writeStore(name, null);
        } catch (_) { log("Storage removal failed", { field: name }, "WARN"); }
    }
    function sanitizeOptions(input) {
        const o = { ...DEFAULTS };
        if (!input || typeof input !== "object") return o;
        for (const k of ["enabled", "showValues", "showDeltas", "showRoF", "showEffects", "keepTempEffects", ...FILTER_KEYS]) if (typeof input[k] === "boolean") o[k] = input[k];
        if (["equipped", "selected"].includes(input.referenceMode)) o.referenceMode = input.referenceMode;
        if (["slot", ...AREAS].includes(input.coverageArea)) o.coverageArea = input.coverageArea;
        o.fontSize = Math.max(9, Math.min(15, number(input.fontSize) || 11));
        o.arrowSize = Math.max(12, Math.min(30, number(input.arrowSize) || DEFAULTS.arrowSize));
        o.effectSize = Math.max(14, Math.min(32, number(input.effectSize) || DEFAULTS.effectSize));
        if (["inline", "below"].includes(input.layout)) o.layout = input.layout;
        for (const k of ["upColor", "downColor"]) if (/^#[0-9a-f]{6}$/i.test(input[k])) o[k] = input[k];
        if (input.armorSlots && typeof input.armorSlots === "object") {
            o.armorSlots = Object.fromEntries(Object.entries(input.armorSlots).filter(([id, g]) => /^\d+$/.test(id) && Object.keys(SLOT_AREA).includes(g)));
        }
        return o;
    }
    function saveOptions() { const snapshot = structuredCopy(state.opts); state.writes = state.writes.then(() => writeStore("options", snapshot)); }
    function savedReferences(value) {
        const result = new Map();
        for (const pair of Array.isArray(value) ? value : []) {
            if (!Array.isArray(pair) || !GROUPS.includes(pair[0])) continue;
            const id = uidOf(pair[1]?.id), uid = uidOf(pair[1]?.uid);
            if (id && (uid || pair[0] === "Temporary")) result.set(pair[0], { id, uid });
        }
        return result;
    }
    function saveReferences() {
        state.referenceSerial++;
        const snapshot = [...state.pins].map(([group, pin]) => [group, { id: pin.id, uid: pin.uid }]);
        state.writes = state.writes.then(() => writeStore("references", snapshot));
    }
    async function reloadReferences() {
        const serial = state.referenceSerial;
        await state.writes;
        const value = await readStore("references", []);
        if (serial !== state.referenceSerial) return;
        state.pins = savedReferences(value); schedule();
    }
    function structuredCopy(value) { return JSON.parse(JSON.stringify(value)); }
    async function saveCache() {
        const value = { schema: 1, catalogs: [...state.catalogs], details: [...state.details].slice(-4000), inventories: [...state.inventories] };
        state.writes = state.writes.then(() => writeStore("cache", value)); await state.writes;
    }

    /* Shared pacing: at most 18 script requests in any rolling minute, with a
       3.4s gap. navigator.locks serializes reservations across same-origin tabs.
       Other scripts share Torn's 100/min limit, so this cannot reserve their use. */
    async function reserveRequest() {
        const reserve = () => {
            const now = Date.now(); let times = [];
            try { times = JSON.parse(localStorage.getItem(P + "api-times") || "[]"); } catch (_) {}
            if (!Array.isArray(times)) times = [];
            times = times.filter(t => Number.isFinite(t) && t > now - 60000 && t < now + 3600000).sort((a, b) => a - b);
            const at = Math.max(now, (times.at(-1) || 0) + 3400, times.length >= 18 ? times[times.length - 18] + 60020 : 0);
            times.push(at);
            try { localStorage.setItem(P + "api-times", JSON.stringify(times)); } catch (_) {}
            return at;
        };
        return navigator.locks && navigator.locks.request ? navigator.locks.request(P + "api-lock", reserve) : reserve();
    }
    function networkDelay(ms, signal) {
        if (ms <= 0) return Promise.resolve();
        return new Promise((resolve, reject) => {
            if (signal.aborted) { reject(new Error("Request canceled")); return; }
            const abort = () => { clearTimeout(timer); reject(new Error("Request canceled")); };
            const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
            signal.addEventListener("abort", abort, { once: true });
        });
    }
    function transport(url, key, signal) {
        const request = typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest :
            typeof GM !== "undefined" && typeof GM.xmlHttpRequest === "function" ? GM.xmlHttpRequest.bind(GM) : null;
        if (request) return new Promise((resolve, reject) => {
            let handle; let settled = false;
            const done = (error, response) => {
                if (settled) return; settled = true; signal.removeEventListener("abort", abort);
                if (error) reject(error); else resolve(response);
            };
            const abort = () => { if (handle && handle.abort) handle.abort(); done(new Error("Request canceled")); };
            if (signal.aborted) { done(new Error("Request canceled")); return; }
            signal.addEventListener("abort", abort, { once: true });
            try {
                handle = request({ method: "GET", url, anonymous: true, timeout: 20000,
                    headers: { Authorization: "ApiKey " + key, Accept: "application/json" },
                    onload: r => {
                        if (r.finalUrl && new URL(r.finalUrl).origin !== "https://api.torn.com") { done(new Error("Unexpected API redirect")); return; }
                        done(null, { status: r.status, text: r.responseText });
                    },
                    onerror: () => done(new Error("Torn API connection failed")),
                    ontimeout: () => done(new Error("Torn API timeout")),
                    onabort: () => done(new Error("Request canceled"))
                });
                if (handle && typeof handle.catch === "function") handle.catch(() => done(new Error("Torn API connection failed")));
            } catch (_) { done(new Error("Userscript request bridge failed")); }
        });
        // TornPDA's documented native GET bridge bypasses WebView CORS limits.
        if (window.flutter_inappwebview && typeof window.flutter_inappwebview.callHandler === "function") {
            return new Promise((resolve, reject) => {
                let settled = false;
                const done = (error, value) => {
                    if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
                    if (error) reject(error); else resolve(value);
                };
                const abort = () => done(new Error("Request canceled"));
                const timer = setTimeout(() => done(new Error("TornPDA API timeout")), 20000);
                if (signal.aborted) { abort(); return; }
                signal.addEventListener("abort", abort, { once: true });
                Promise.resolve().then(() => window.flutter_inappwebview.callHandler("PDA_httpGet", url,
                    { Authorization: "ApiKey " + key, Accept: "application/json" }))
                    .then(response => {
                        if (!response || typeof response !== "object" || number(response.status) === null) {
                            done(new Error("Unexpected TornPDA HTTP response")); return;
                        }
                        done(null, { status: Number(response.status), text: String(response.responseText || "") });
                    }, () => done(new Error("TornPDA API connection failed")));
            });
        }
        return (async () => {
            const controller = new AbortController();
            const abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) controller.abort();
            const timer = setTimeout(() => controller.abort(), 20000); // Network timeout only.
            try {
                const r = await fetch(url, { method: "GET", headers: { Authorization: "ApiKey " + key, Accept: "application/json" },
                    credentials: "omit", redirect: "error", signal: controller.signal });
                return { status: r.status, text: await r.text() };
            } catch (_) { throw new Error("Torn API fetch failed. Check connectivity or the TornPDA request bridge."); }
            finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
        })();
    }
    function api(path, query = {}) {
        const epoch = state.epoch;
        const job = async () => {
            if (epoch !== state.epoch || !state.key) throw new Error("Request canceled");
            if (state.blocked) throw new Error(state.blocked);
            if (Date.now() < state.blockedUntil) throw new Error("API cooling down. Retry with Refresh after " + new Date(state.blockedUntil).toLocaleTimeString());
            const signal = state.requestAbort.signal;
            const at = await reserveRequest(); await networkDelay(at - Date.now(), signal);
            if (epoch !== state.epoch || signal.aborted) throw new Error("Request canceled");
            const url = new URL(path, API);
            if (url.origin !== "https://api.torn.com" || !url.pathname.startsWith("/v2/")) throw new Error("Invalid API destination");
            for (const [k, v] of Object.entries({ ...query, comment: "TornInventoryCompare" })) url.searchParams.set(k, String(v));
            log("API request", { path: url.pathname });
            const r = await transport(url.href, state.key, signal);
            if (epoch !== state.epoch) throw new Error("Request canceled");
            if (r.status === 429) { state.blockedUntil = Date.now() + 65000; throw new Error("Torn rate limit reached. Refresh after one minute."); }
            if (r.status !== 200) { state.blockedUntil = Date.now() + 30000; throw new Error("Torn API HTTP " + r.status); }
            let data; try { data = JSON.parse(r.text); } catch (_) { throw new Error("Torn API returned invalid JSON"); }
            if (data.error) {
                const code = number(data.error.code);
                log("API rejected request", { path: url.pathname, code }, "WARN");
                if ([1, 2, 8, 9, 10, 13, 16, 18].includes(code)) state.blocked = "API error " + code + ": check the key, permissions or account API access in settings.";
                if ([5, 14].includes(code)) state.blockedUntil = Date.now() + (code === 14 ? 3600000 : 65000);
                throw new Error(state.blocked || "Torn API error " + code + ". Refresh later to retry.");
            }
            return data;
        };
        const result = state.queue.then(job); state.queue = result.catch(() => {}); return result;
    }

    function catalogEntry(id) {
        for (const cat of state.catalogs.values()) {
            const item = cat.items.find(i => String(i.id) === String(id)); if (item) return item;
        }
        return null;
    }
    function armorSlot(item) {
        if (!item || item.type !== "Armor") return "";
        if (state.opts.armorSlots[String(item.id)]) return state.opts.armorSlots[String(item.id)];
        const name = String(item.name || "");
        if (/hazmat|full[ -]?body suit/i.test(name)) return "fullbody";
        if (/helmet|mask|respirator|visage/i.test(name)) return "head";
        if (/gloves?|gauntlets?/i.test(name)) return "hands";
        if (/pants|trousers|leggings|greaves/i.test(name)) return "legs";
        if (/boots?|shoes?|sabatons/i.test(name)) return "feet";
        if (/vest|body|apron|jacket|chain mail|armor|armour|carapace/i.test(name)) return "body";
        return ""; // Unrecognized new armor requires an explicit slot override.
    }
    function groupOf(item) {
        if (!item) return "";
        if (item.type === "Armor") return armorSlot(item);
        const category = item.details && item.details.category;
        return ["Primary", "Secondary", "Melee", "Temporary"].includes(category) ? category : "";
    }
    function detailEntries(data) {
        const value = data && data.itemdetails;
        if (Array.isArray(value)) return value;
        if (value && uidOf(value.uid)) return [value]; // Deprecated single-UID object.
        if (value && typeof value === "object") return Object.values(value).filter(v => v && uidOf(v.uid));
        return [];
    }
    function statRecord(raw, at = Date.now()) {
        if (!raw || !uidOf(raw.uid)) return null;
        const s = raw.stats || {};
        return { id: uidOf(raw.id), uid: uidOf(raw.uid), name: clean(raw.name),
            damage: number(s.damage), accuracy: number(s.accuracy), armor: number(s.armor), quality: number(s.quality),
            bonuses: Array.isArray(raw.bonuses) ? raw.bonuses : [], at };
    }
    function isRatingRange(value) {
        return Boolean(value && typeof value === "object" && number(value.min) !== null && number(value.max) !== null && value.min >= 0 && value.min <= value.max);
    }
    function ratingText(value) { return isRatingRange(value) ? fmt(value.min) + "-" + fmt(value.max) : fmt(value); }
    function abroadStats(model, item) {
        if (!item || !["Weapon", "Armor"].includes(item.type)) return null;
        const known = ABROAD_RANGES[clean(item.name).toLowerCase()];
        const values = { damage: new Set(), accuracy: new Set(), armor: new Set() };
        for (const entry of model.row.querySelectorAll('[class*="properties__"] [class*="property__"],[class*="infoBonuses__"] [class*="container__"]')) {
            if (owned(entry)) continue;
            const value = entry.querySelector('[class*="value__"]') || entry.querySelector("span"), icon = entry.querySelector('i,[class*="icon__"]');
            if (!value) continue;
            const label = clean([value.getAttribute("aria-label"), entry.getAttribute("aria-label"), icon?.getAttribute("aria-label"), icon?.className, icon?.getAttribute("title")].filter(Boolean).join(" ")).toLowerCase();
            const keys = ["damage", "accuracy", "armor"].filter(key => new RegExp(key === "armor" ? "\\b(?:armor|armour|defen[cs]e)\\b" : "\\b" + key + "\\b").test(label));
            const match = clean(value.textContent).match(/^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)$/);
            if (keys.length === 1 && match && Number(match[1]) <= Number(match[2])) values[keys[0]].add(JSON.stringify([Number(match[1]), Number(match[2])]));
        }
        const record = { id: model.id, uid: "", damage: null, accuracy: null, armor: null, bonuses: [], at: 0, stale: false, shopRange: true, source: "Torn Wiki overseas shop range (verified 2026-10-18); individual roll unknown" };
        for (const key of Object.keys(values)) {
            let bounds = null;
            if (values[key].size === 1) { bounds = JSON.parse([...values[key]][0]); record.source = "Displayed overseas shop range; individual roll unknown"; }
            else if (!values[key].size && known?.[key]) {
                const minimum = number(item.details?.base_stats?.[key]);
                // A changed official catalog minimum invalidates the bundled
                // range. Never guess a new maximum by adding a fixed amount.
                if (minimum === null || minimum === known[key][0]) bounds = known[key];
            }
            if (bounds) record[key] = { min: bounds[0], max: bounds[1] };
        }
        return [record.damage, record.accuracy, record.armor].some(isRatingRange) ? record : null;
    }
    function statsFor(model) {
        const catalog = catalogEntry(model.id);
        if (model.abroad && !model.uid && groupOf(catalog) !== "Temporary") return abroadStats(model, catalog);
        if (model.shopping && groupOf(catalog) !== "Temporary") {
            const viewed = model.listingStats || (model.uid && state.listingData.get(model.id + ":" + model.uid));
            if (fresh(viewed, TTL.detail)) {
                const cached = model.uid && state.details.get(model.uid);
                return { ...viewed, bonuses: viewed.bonuses.length ? viewed.bonuses : cached?.id === model.id ? cached.bonuses : [], stale: false };
            }
        }
        if (model.uid) {
            const detail = state.details.get(model.uid);
            if (detail && String(detail.id) === String(model.id)) {
                const isArmor = catalog && catalog.type === "Armor";
                const usable = isArmor ? number(detail.armor) !== null : number(detail.damage) !== null || number(detail.accuracy) !== null;
                if (usable) return { ...detail, source: "Individual UID", stale: !fresh(detail, TTL.detail) };
            }
        }
        if (groupOf(catalog) === "Temporary") {
            const base = catalog.details && catalog.details.base_stats;
            // Temporary stacks have fixed catalog ratings, not weapon quality rolls.
            if (base) return { damage: number(base.damage), accuracy: number(base.accuracy), armor: null, source: "Fixed temporary rating", at: 0, stale: false };
        }
        return null;
    }
    function isEquipped(row) {
        const explicit = row.getAttribute("data-equipped");
        if (explicit === "true" || explicit === "1") return true;
        if (explicit === "false" || explicit === "0") return false;
        if (/(?:^|\s)(?:equipped|is-equipped|item-equipped)(?:\s|$)/.test(row.className)) return true;
        const selector = '.option-unequip,.unequip,[data-action="unequip"],.equipped,[title],[aria-label],[data-tooltip]';
        return Array.from(row.querySelectorAll(selector)).some(control => {
            // Torn may retain hidden Equip/Unequip controls for every row.
            // Only visible, semantically identified controls define the reference.
            if (owned(control) || !control.getClientRects().length || getComputedStyle(control).visibility === "hidden") return false;
            if (control.matches('.option-unequip,.unequip,[data-action="unequip"],.equipped')) return true;
            return ["title", "aria-label", "data-tooltip"].some(attr => /^(?:(?:click|tap)\s+(?:here\s+)?to\s+)?unequip\b/i.test(clean(control.getAttribute(attr))));
        });
    }
    function itemId(node) {
        for (const attr of ITEM_ATTRS) { const id = uidOf(node.getAttribute(attr)); if (id) return id; }
        return "";
    }
    function hasItemTitle(row) {
        // A genuine nested copy has its own item title. Repeated IDs on Send,
        // Equip and Sell list entries do not make those controls item rows.
        return Boolean(row.querySelector(":scope > .title-wrap .name-wrap, :scope > .name-wrap, :scope > .name, :scope > [data-item-name]"));
    }
    function inventoryRow(node) {
        if (!(node instanceof Element) || owned(node)) return null;
        // The native boundary is the direct LI child of the inventory category,
        // not the nearest LI. Torn's item actions themselves are nested LIs.
        const nativeRow = node.closest(NATIVE_ROWS);
        if (nativeRow && (!state.root || state.root.contains(nativeRow)) && hasItemTitle(nativeRow)) return nativeRow;
        let fallback = null;
        for (let li = node.closest("li"); li && li !== state.root && (!state.root || state.root.contains(li)); li = li.parentElement?.closest("li")) {
            if (hasItemTitle(li)) return li;
            if (li === nativeRow) return li;
            // For other list layouts, the outer item-bearing LI owns nested
            // controls. A real separate copy with a title returned above.
            if (li.matches(ITEM_MARKERS)) fallback = li;
        }
        if (fallback) return fallback;
        // Card-style layouts without a list item: use the outer item container,
        // excluding native interactive controls and inventory category roots.
        let candidate = node.closest(ITEM_MARKERS), row = null;
        while (candidate && candidate !== state.root && (!state.root || state.root.contains(candidate))) {
            if (!candidate.matches("a,button,input,select,option,label,[role=button]")) row = candidate;
            candidate = candidate.parentElement?.closest(ITEM_MARKERS);
        }
        return row;
    }
    function readRow(row) {
        const nodes = Array.from(row.querySelectorAll(IDENTITY_MARKERS)).filter(n => !owned(n) && inventoryRow(n) === row);
        const ids = new Set(nodes.map(itemId).filter(Boolean));
        const id = itemId(row) || (ids.size === 1 ? [...ids][0] : "");
        if (!id) return null;
        const uids = new Set();
        for (const node of [row, ...nodes]) {
            if (itemId(node) && itemId(node) !== id) continue;
            for (const attr of UID_ATTRS) { const value = uidOf(node.getAttribute(attr)); if (value) uids.add(value); }
        }
        // Conflicting copy IDs are unavailable, never arbitrarily first-match.
        let uid = uids.size === 1 ? [...uids][0] : "";
        const weak = uidOf(row.getAttribute("data-id"));
        if (!uid && weak && !uids.size) {
            // data-id is used for several purposes. Accept only a matching inventory UID.
            for (const inv of state.inventories.values()) {
                if (inv.items.some(i => uidOf(i.uid) === weak && String(i.id) === id)) { uid = weak; break; }
            }
        }
        const nameNode = row.querySelector(".name-wrap > .name,.name-wrap .name,.name,[data-item-name]");
        const catalog = catalogEntry(id);
        const name = catalog ? catalog.name : clean(nameNode ? [...nameNode.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(" ") : "Item " + id);
        return { id, uid, weak, name: name || "Item " + id, row, group: groupOf(catalog), equipped: isEquipped(row) };
    }
    function inventoryCategory(group) { return Object.keys(SLOT_AREA).includes(group) ? "Defensive" : group; }
    function marketItemId() {
        const query = new URLSearchParams(location.search), hash = new URLSearchParams(location.hash.replace(/^#\/?/, ""));
        return uidOf(hash.get("itemID") || hash.get("itemId") || query.get("itemID") || query.get("itemId"));
    }
    function listingScope() {
        return state.mode === "bazaar" ? "bazaar:" + (uidOf(new URLSearchParams(location.search).get("userId")) || "self") : "market:" + marketItemId();
    }
    function listingRecord(raw, hint = "", mode = state.mode) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
        const copy = raw.item_details || raw.itemDetails || raw;
        const id = uidOf(raw.itemID || raw.itemId || raw.item_id || raw.item?.id || hint || (raw.uid && raw.stats ? raw.id : ""));
        if (!id) return null;
        const uid = uidOf(copy.uid || copy.UID || raw.armoryID || raw.armouryID || raw.armoryId || raw.itemUid);
        let stats = copy.stats;
        if (!stats && copy !== raw && uid) stats = { damage: copy.damage ?? copy.dmg, accuracy: copy.accuracy ?? copy.acc, armor: copy.armor ?? copy.arm };
        // Native bazaar responses carry rolled dmg/acc/arm alongside separate
        // base damage/accuracy fields. Only the rolled fields are accepted.
        if (!stats && (raw.itemID || raw.itemId) && ("dmg" in raw || "acc" in raw || "arm" in raw)) stats = { damage: raw.dmg, accuracy: raw.acc, armor: raw.arm };
        const rating = value => number(value) !== null && number(value) >= 0 ? number(value) : null;
        const record = { id, uid, listingId: uidOf(raw.bazaarID || raw.listingID || raw.listingId || raw.listing_id),
            damage: rating(stats?.damage), accuracy: rating(stats?.accuracy), armor: rating(stats?.armor), quality: rating(stats?.quality),
            bonuses: Array.isArray(copy.bonuses) ? copy.bonuses.filter(b => b && typeof b === "object" && (b.title || b.name)) : [],
            at: Date.now(), source: mode === "bazaar" ? "Viewed bazaar listing" : "Viewed market listing" };
        return record;
    }
    function hasRatings(record) { return Boolean(record && [record.damage, record.accuracy, record.armor].some(v => number(v) !== null)); }
    function rememberListing(record, scope) {
        if (!record) return;
        if (record.uid && hasRatings(record)) state.listingData.set(record.id + ":" + record.uid, record);
        if (record.listingId) state.listingIds.set(scope + ":" + record.listingId, record);
        for (const map of [state.listingData, state.listingIds]) while (map.size > 2000) map.delete(map.keys().next().value);
    }
    function observeListingResponse(data, context) {
        if (!data || typeof data !== "object") return;
        const list = Array.isArray(data.list) ? data.list : Array.isArray(data.listings) ? data.listings : Array.isArray(data.items) ? data.items : data.itemmarket?.listings;
        if (!Array.isArray(list)) return;
        let accepted = 0;
        for (const raw of list) {
            const record = listingRecord(raw, uidOf(data.itemmarket?.item?.id) || context.id, context.mode);
            if (!record) continue;
            rememberListing(record, context.scope); accepted++;
        }
        if (accepted) { log("Native listings observed", { surface: context.mode, accepted }); schedule(); }
    }
    function installListingObserver() {
        if (state.mode === "inventory" || state.mode === "abroad") return;
        // Observe only listing responses the page already requests. No extra
        // authenticated site requests, injected scripts, or buy actions.
        try {
            const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
            const original = page.fetch;
            if (typeof original !== "function") return;
            const observeFetch = function (...args) {
                let context = null;
                try {
                    const url = new URL(typeof args[0] === "string" ? args[0] : args[0]?.url, location.href), step = url.searchParams.get("step");
                    if (url.origin === location.origin && ((url.pathname === "/bazaar.php" && step === "getBazaarItems") ||
                        (url.pathname === "/page.php" && /^(?:imarket|itemmarket)$/i.test(url.searchParams.get("sid") || "") && ["getListing", "getShopList", "searchItem"].includes(step)))) {
                        const mode = url.pathname === "/bazaar.php" ? "bazaar" : "market";
                        let body = args[1]?.body, id = uidOf(url.searchParams.get("itemID"));
                        if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = new URLSearchParams(body); } }
                        if (!id) id = uidOf(typeof body?.get === "function" ? body.get("itemID") : body?.itemID) || marketItemId();
                        context = { mode, id, scope: mode === "bazaar" ? listingScope() : "market:" + id };
                    }
                } catch (_) { /* Unrelated requests are passed through untouched. */ }
                const pending = Reflect.apply(original, this, args);
                if (context) void Promise.resolve(pending).then(response => {
                    if (!response.ok) return;
                    return response.clone().json().then(data => observeListingResponse(data, context));
                }).catch(() => {});
                return pending;
            };
            page.fetch = typeof exportFunction === "function" ? exportFunction(observeFetch, page) : observeFetch;
            state.observedFetch = true;
        } catch (_) { log("Native listing observer unavailable; using row metadata", {}, "DEBUG"); }
    }
    function rowListingObjects(row) {
        const objects = [], queue = [], seen = new Set();
        const push = (value, depth = 0, children = true) => { if (value && typeof value === "object" && !Array.isArray(value) && !seen.has(value)) { seen.add(value); queue.push({ value, depth, children }); } };
        const nodes = [row, ...Array.from(row.querySelectorAll("div,span,li,button,[data-item-details],[data-item-info]")).filter(n => !owned(n)).slice(0, 20)];
        for (const node of nodes) {
            for (const attr of ["data-item-details", "data-item-info", "data-info"]) {
                const value = node.getAttribute(attr); if (value?.startsWith("{")) try { push(JSON.parse(value)); } catch (_) {}
            }
            // Read only this rendered card's data props. No state changes,
            // component invocation, or traversal through whole inventory arrays.
            try {
                const rendered = node.wrappedJSObject || node;
                for (const key of Object.getOwnPropertyNames(rendered)) {
                    if (key.startsWith("__reactProps$")) push(rendered[key]);
                    if (node === row && key.startsWith("__reactFiber$")) {
                        let fiber = rendered[key];
                        for (let i = 0; fiber && i < 3; i++, fiber = fiber.return) push(fiber.memoizedProps, 0, false);
                    }
                }
            } catch (_) {}
        }
        while (queue.length && objects.length < 120) {
            const { value, depth, children } = queue.shift(); objects.push(value);
            if (depth >= 4) continue;
            for (const key of ["item", "listing", "data", "itemInfo", "itemData", "bazaarItem", "itemDetails", "item_details", "props", ...(children ? ["children"] : [])]) {
                try { push(value[key], depth + 1, children); } catch (_) {}
            }
        }
        return objects;
    }
    function shoppingRow(node) {
        if (!(node instanceof Element) || owned(node)) return null;
        if (state.mode === "abroad") {
            const row = node.closest(ABROAD_ROWS);
            return row && state.root?.contains(row) ? row : null;
        }
        const native = node.closest(SHOP_NATIVE_ROWS), row = native || node.closest('[data-listing-id],[data-bazaar-id]');
        if (!row || !state.root?.contains(row)) return null;
        if (row.matches("a,button,input,select,option,label") || (!native && row.matches('[role="button"]'))) return null;
        const seller = row.closest('[class*="sellerList__"] > li');
        return seller || row;
    }
    function itemOwner(node) { return state.mode === "inventory" ? inventoryRow(node) : shoppingRow(node); }
    function rowVisible(row) {
        // Brief synchronous removal lets native filters remain authoritative.
        // This private attribute is deliberately outside the observer filter.
        const removed = [];
        for (let node = row; node && node !== state.root; node = node.parentElement) {
            for (const attr of ["data-tw-ic-filtered", "data-tw-ic-filter-slot"]) if (node.hasAttribute(attr)) {
                removed.push([node, attr, node.getAttribute(attr)]); node.removeAttribute(attr);
            }
        }
        const visible = row.getClientRects().length > 0 && getComputedStyle(row).visibility !== "hidden";
        for (const [node, attr, value] of removed) node.setAttribute(attr, value);
        return visible;
    }
    function visibleListingStats(row, id, uid) {
        // Read the values already printed on this individual tile. The typed
        // property label identifies each metric; price, quality and list order
        // never stand in for a rolled rating.
        const values = { damage: new Set(), accuracy: new Set(), armor: new Set() };
        const entries = row.querySelectorAll('[class*="properties__"] [class*="property__"],[class*="infoBonuses__"] [class*="container__"]');
        for (const entry of entries) {
            if (owned(entry)) continue;
            const value = entry.querySelector('[class*="value__"]') || entry.querySelector("span"), icon = entry.querySelector('i,[class*="icon__"]');
            if (!value || owned(value)) continue;
            const label = clean([value.getAttribute("aria-label"), entry.getAttribute("aria-label"), icon?.getAttribute("aria-label"), icon?.getAttribute("class"), icon?.getAttribute("title")].filter(Boolean).join(" ")).toLowerCase();
            const kinds = [/(?:damage|dmg)/.test(label) && "damage", /(?:accuracy|\bacc\b)/.test(label) && "accuracy", /(?:armou?r|defen[cs]e)/.test(label) && "armor"].filter(Boolean);
            const text = clean(value.textContent);
            if (kinds.length !== 1 || !/^\d+(?:\.\d+)?$/.test(text)) continue;
            values[kinds[0]].add(Number(text));
        }
        const record = { id, uid, damage: null, accuracy: null, armor: null, quality: null, bonuses: [], at: Date.now(), source: "Visible listing stats" };
        for (const key of Object.keys(values)) if (values[key].size === 1) record[key] = [...values[key]][0];
        return hasRatings(record) ? record : null;
    }
    function readShoppingRow(row) {
        const objects = rowListingObjects(row), idSet = new Set(), uidSet = new Set(), listingIds = new Set();
        const metadata = [row, ...Array.from(row.querySelectorAll(IDENTITY_MARKERS + ",[data-item-uid],[data-armory-id],[data-armoury-id],[data-listing-id],[data-bazaar-id]")).filter(n => !owned(n))];
        for (const node of metadata) {
            const id = itemId(node); if (id) idSet.add(id);
            for (const attr of [...UID_ATTRS, "data-item-uid", "data-armory-id", "data-armoury-id"]) { const uid = uidOf(node.getAttribute(attr)); if (uid) uidSet.add(uid); }
            for (const attr of ["data-listing-id", "data-bazaar-id"]) { const id = uidOf(node.getAttribute(attr)); if (id) listingIds.add(id); }
        }
        for (const img of row.querySelectorAll("img[src],img[srcset]")) {
            const match = (img.getAttribute("src") || "").match(/\/images\/items\/(\d+)\//) || (img.getAttribute("srcset") || "").match(/\/images\/items\/(\d+)\//);
            if (match) idSet.add(match[1]);
        }
        for (const raw of objects) {
            const id = uidOf(raw.itemID || raw.itemId || raw.item_id || (state.mode === "abroad" ? raw.ID : "")); if (id) idSet.add(id);
            const copy = raw.item_details || raw.itemDetails || raw;
            const uid = uidOf(copy.uid || copy.UID || raw.armoryID || raw.armouryID || raw.armoryId || raw.itemUid); if (uid) uidSet.add(uid);
        }
        // A known UID identifies its catalog item even while a hash navigation
        // is replacing the old seller list with a different item type.
        if (!idSet.size) for (const uid of uidSet) {
            const known = state.details.get(uid) || [...state.listingData.values()].find(record => record.uid === uid);
            if (known) idSet.add(known.id);
        }
        const hint = idSet.size === 1 ? [...idSet][0] : state.mode === "market" ? marketItemId() : "";
        let records = objects.map(raw => listingRecord(raw, hint)).filter(Boolean);
        for (const record of records) { idSet.add(record.id); if (record.uid) uidSet.add(record.uid); if (record.listingId) listingIds.add(record.listingId); }
        for (const id of listingIds) {
            const record = state.listingIds.get(listingScope() + ":" + id);
            if (record) { records.push(record); idSet.add(record.id); if (record.uid) uidSet.add(record.uid); }
        }
        if (!idSet.size && hint) idSet.add(hint);
        if (idSet.size !== 1) return null;
        const id = [...idSet][0], uid = uidSet.size === 1 ? [...uidSet][0] : "", catalog = catalogEntry(id);
        // Multiple copy identities within one supposed card are ambiguous.
        records = uidSet.size > 1 ? [] : records.filter(r => r.id === id && (!r.uid || !uid || r.uid === uid) && hasRatings(r));
        if (uidSet.size <= 1) {
            const visible = visibleListingStats(row, id, uid);
            if (visible) records.push(visible);
        }
        const listingStats = records[0] || null;
        if (listingStats?.uid) rememberListing(listingStats, listingScope());
        const cell = state.mode === "bazaar" ? bazaarCell(row) : null;
        const bazaarPositioned = Boolean(cell && bazaarLocked(row));
        return { id, uid, weak: "", name: catalog?.name || "Item " + id, group: groupOf(catalog), row, equipped: false, listingStats, shopping: true, abroad: state.mode === "abroad",
            bazaarPositioned, bazaarCompact: Boolean(cell && (bazaarPositioned || cell.getBoundingClientRect().width < 120)) };
    }
    function bazaarCell(row) {
        const description = row.querySelector('[class*="itemDescription__"]');
        if (!description) return null;
        return description.querySelector(':scope > [class*="description__"]') || description;
    }
    function bazaarGroup(row) { return row.closest('[data-testid="bazaar-items-row"],[class*="row__"]'); }
    function bazaarLocked(row) {
        const group = bazaarGroup(row);
        return Boolean(group && ["absolute", "fixed"].includes(getComputedStyle(group).position));
    }
    function syncBazaarLayout(models) {
        const wanted = new Map();
        const mark = (node, role) => {
            if (!node || node === state.root) return;
            if (!wanted.has(node)) wanted.set(node, new Set());
            wanted.get(node).add(role);
        };
        if (state.mode === "bazaar" && state.opts.enabled) for (const model of models) {
            const row = model.row, cell = bazaarCell(row);
            if (!cell || !row.querySelector("." + P + "wrap")) continue;
            mark(row, "card");
            if (model.bazaarCompact) mark(row, "compact");
            for (let node = cell; node && node !== row; node = node.parentElement) mark(node, "cell");
            // Normal rows may grow with their contents. Positioned virtual
            // rows keep Torn's offsets and scroll geometry; use a compact
            // single-line comparison in their existing description instead.
            if (!model.bazaarPositioned) {
                const list = row.parentElement, group = bazaarGroup(row);
                if (list?.matches('[data-testid="row-items"],[class*="rowItems__"]')) mark(list, "flow");
                if (group) mark(group, "flow");
            }
        }
        for (const node of state.bazaarLayoutNodes) if (!wanted.has(node)) node.removeAttribute("data-tw-ic-bazaar-layout");
        for (const [node, roles] of wanted) {
            const value = [...roles].join(" ");
            if (node.getAttribute("data-tw-ic-bazaar-layout") !== value) node.setAttribute("data-tw-ic-bazaar-layout", value);
        }
        state.bazaarLayoutNodes = new Set(wanted.keys());
    }
    function nameHost(row) {
        // Mount only inside this item's name area. The v1.0.5 ownership check
        // keeps repeated action metadata from becoming independent rows.
        return Array.from(row.querySelectorAll(".name-wrap,[data-item-name],.name")).find(node =>
            !owned(node) && inventoryRow(node) === row &&
            !node.closest('a,button,label,[role="button"],[contenteditable="true"]')) || null;
    }
    function rowHost(row, model) {
        if (model.abroad) return row.querySelector('[class*="itemName__"],[data-tt-content-type="name"]') || row.querySelector('[class*="row__"]') || row;
        if (state.mode === "bazaar") { const cell = bazaarCell(row); if (cell) return cell; }
        if (model.shopping) return row;
        if (state.opts.layout === "inline") {
            const host = nameHost(row);
            if (host) return host;
        }
        if (!["table-row", "table", "inline-table"].includes(getComputedStyle(row).display)) return row;
        const candidates = Array.from(row.querySelectorAll(".name-wrap,.name,.desc,[data-item-name],td,th,div,span"));
        let cell = candidates.find(n => !owned(n) && getComputedStyle(n).display === "table-cell" && clean(n.textContent).includes(model.name));
        if (!cell) cell = candidates.find(n => !owned(n) && /^(?:name|name-wrap|desc)$/.test(n.className) && clean(n.textContent).includes(model.name));
        return cell || row;
    }
    function inlineClasses(row, host) {
        const grow = new Set(), clear = new Set();
        if (host) for (let node = host.parentElement; node && row.contains(node); node = node.parentElement) {
            grow.add(node);
            // Clear floats with owned empty elements instead of overriding the
            // native display type, so breakpoint changes still take effect.
            if (["block", "list-item"].includes(getComputedStyle(node).display)) clear.add(node);
            if (node === row) break;
        }
        const nodes = new Set([row, ...grow, ...row.querySelectorAll("." + P + "inline-host,." + P + "inline-grow")]);
        if (host) nodes.add(host);
        for (const node of nodes) for (const [suffix, active] of [["inline-host", node === host], ["inline-grow", grow.has(node)]]) {
            // Do not emit unchanged class mutations on every inventory scan.
            const cls = P + suffix;
            if (node.classList.contains(cls) !== active) node.classList.toggle(cls, active);
        }
        for (const node of row.querySelectorAll("." + P + "inline-clear")) if (!clear.has(node.parentElement)) node.remove();
        for (const parent of clear) if (!Array.from(parent.children).some(node => node.classList.contains(P + "inline-clear"))) {
            const node = el("span", null, P + "inline-clear"); node.setAttribute("data-tw-ic-owned", "layout"); node.setAttribute("aria-hidden", "true"); parent.append(node);
        }
    }
    function prepareRow(row, model, wrap) {
        const host = rowHost(row, model);
        if (!row.classList.contains(P + "annotated")) row.classList.add(P + "annotated");
        // Attribute is a layout hook, not an ownership marker: native row
        // mutations must remain visible to the inventory observer.
        const inline = state.mode === "inventory" && state.opts.layout === "inline" && host !== row && host === nameHost(row);
        const mode = inline ? "inline" : host === row ? "footer" : "cell";
        inlineClasses(row, inline || model.abroad ? host : null);
        if (row.getAttribute("data-tw-ic-mount") !== mode) row.setAttribute("data-tw-ic-mount", mode);
        if (wrap.parentElement !== host) host.appendChild(wrap);
    }
    function releaseRow(row, wrap) {
        if (wrap) wrap.remove();
        else row.querySelectorAll("." + P + "wrap").forEach(n => n.remove());
        if (row.classList.contains(P + "annotated")) row.classList.remove(P + "annotated");
        if (row.hasAttribute("data-tw-ic-mount")) row.removeAttribute("data-tw-ic-mount");
        row.removeAttribute("data-tw-ic-bazaar-layout");
        row.removeAttribute("data-tw-ic-filtered");
        inlineClasses(row, null);
        state.rowModels.delete(row);
    }
    function findRoot() { return state.mode ? document.querySelector(ROOTS[state.mode]) : null; }
    function owned(node) { const e = node && (node.nodeType === 1 ? node : node.parentElement); return Boolean(e && e.closest && e.closest("[data-tw-ic-owned]")); }
    function schedule() {
        if (!state.alive || state.frame) return;
        state.frame = requestAnimationFrame(() => { state.frame = 0; scanAndRender(); });
    }
    function attachRoot(root) {
        if (state.root === root) return;
        if (state.inventoryObserver) state.inventoryObserver.disconnect();
        syncBazaarLayout([]);
        clearFilterLayout();
        restoreMarketSliders();
        if (state.root) for (const row of state.root.querySelectorAll("." + P + "annotated,[data-tw-ic-filtered]")) releaseRow(row);
        state.root = root;
        if (!root) return;
        state.inventoryObserver = new MutationObserver(records => {
            if (records.some(m => !owned(m.target) && (m.type !== "childList" || [...m.addedNodes, ...m.removedNodes].some(n => !owned(n)) ||
                [...m.removedNodes].some(n => n.nodeType === 1 && n.matches("." + P + "wrap"))))) schedule();
        });
        state.inventoryObserver.observe(root, { childList: true, subtree: true, attributes: true, characterData: true,
            attributeFilter: ["class", "style", "data-equipped", "data-id", ...ITEM_ATTRS, ...UID_ATTRS, "data-item-uid", "data-armory-id", "data-listing-id", "data-bazaar-id", "data-item-info", "data-item-details", "data-info", "src", "srcset", "hidden", "aria-selected", "title", "aria-label", "data-action", "data-tooltip"] });
        log("Inventory container found", { surface: state.mode, selector: root.id ? "#" + root.id : ROOTS[state.mode] });
    }
    function equippedReferences(models) {
        const result = new Map();
        for (const group of GROUPS) {
            if (state.mode === "inventory") {
                const marked = models.filter(m => m.group === group && m.equipped);
                const unique = [...new Map(marked.map(m => [m.uid ? m.id + ":" + m.uid : m.row, m])).values()];
                if (unique.length === 1) { result.set(group, { ...unique[0], referenceSource: "Equipped on page" }); continue; }
                if (unique.length > 1) continue;
            }
            const items = state.equipment.filter(raw => groupOf(catalogEntry(raw.id)) === group);
            if (items.length === 1) {
                const raw = items[0];
                const visible = state.mode === "inventory" && models.find(m => m.id === String(raw.id) && m.uid === uidOf(raw.uid));
                if (visible && ["false", "0"].includes(visible.row.getAttribute("data-equipped"))) continue;
                result.set(group, { id: String(raw.id), uid: uidOf(raw.uid), name: raw.name || catalogEntry(raw.id)?.name, group, referenceSource: "Equipped via API" });
            }
        }
        return result;
    }
    function references(models) {
        if (state.mode !== "inventory") {
            const result = equippedReferences(models);
            if (state.mode === "market") for (const [group, pin] of state.pins) {
                const item = catalogEntry(pin.id);
                if (groupOf(item) === group) result.set(group, { ...pin, group, name: item.name, referenceSource: "Chosen in inventory" });
            }
            return result;
        }
        const result = new Map();
        for (const group of GROUPS) {
            const pin = state.pins.get(group);
            if (pin) {
                const visible = models.find(m => pin.uid ? m.uid === pin.uid && m.id === pin.id : m.id === pin.id && m.group === "Temporary");
                if (visible) { result.set(group, { ...visible, referenceSource: "Chosen" }); continue; }
                // Never retain a manual pin for an item no longer in the visible list.
                if (models.some(m => m.group === group)) { state.pins.delete(group); saveReferences(); }
            }
            if (state.opts.referenceMode === "selected") continue;
            const marked = [...new Map(models.filter(m => m.group === group && m.equipped).map(m => [m.uid ? m.id + ":" + m.uid : m.row, m])).values()];
            if (marked.length === 1) { result.set(group, { ...marked[0], referenceSource: "Equipped on page" }); continue; }
            if (marked.length > 1) continue;
            const equipped = state.equipment.filter(raw => groupOf(catalogEntry(raw.id)) === group);
            if (equipped.length === 1) {
                const raw = equipped[0];
                const sameVisible = models.find(m => m.uid && m.uid === uidOf(raw.uid) && m.id === String(raw.id));
                // Explicit current page state wins over the API's service cache.
                if (sameVisible && ["false", "0"].includes(sameVisible.row.getAttribute("data-equipped"))) continue;
                result.set(group, { id: String(raw.id), uid: uidOf(raw.uid), name: raw.name, group, referenceSource: "Equipped via API" });
            }
        }
        return result;
    }
    function lowerReasons(model, ref) {
        if (!state.opts.enabled || !ref || !model.group || sameItem(model, ref)) return [];
        const item = catalogEntry(model.id), actual = statsFor(model), base = statsFor(ref), reasons = [];
        if (state.opts.keepTempEffects && hasTemporaryStatus(item)) return reasons;
        const lower = (a, b) => compare(a, b).cls === "down";
        // Unavailable or expired copy ratings never remove an item from view.
        if (item?.type === "Weapon" && actual && base && !actual.stale && !base.stale) {
            if (state.opts.hideLowerDamage && lower(actual.damage, base.damage)) reasons.push("damage");
            if (model.group !== "Temporary" && state.opts.hideLowerAccuracy && lower(actual.accuracy, base.accuracy)) reasons.push("accuracy");
        }
        if (item?.type === "Armor") {
            if (state.opts.hideLowerArmor && actual && base && !actual.stale && !base.stale && lower(actual.armor, base.armor)) reasons.push("armor rating");
            const area = state.opts.coverageArea === "slot" ? SLOT_AREA[model.group] : state.opts.coverageArea;
            if (state.opts.hideLowerCoverage && lower(coverage(item, area), coverage(catalogEntry(ref.id), area))) reasons.push("coverage");
        }
        return reasons;
    }
    function applyFilters(models) {
        const refs = state.mode === "market" ? references(models) : equippedReferences(models); let hidden = 0;
        clearFilterLayout();
        for (const model of models) {
            const reasons = lowerReasons(model, refs.get(model.group));
            if (reasons.length) {
                model.row.setAttribute("data-tw-ic-filtered", reasons.join(",")); hidden++;
                const slot = marketSlot(model.row);
                if (slot !== model.row) { slot.setAttribute("data-tw-ic-filter-slot", ""); state.filterSlots.add(slot); }
            }
            else if (model.row.hasAttribute("data-tw-ic-filtered")) model.row.removeAttribute("data-tw-ic-filtered");
            if (state.opts.enabled && FILTER_KEYS.some(key => state.opts[key]) && state.mode === "market" && model.row.matches(MARKET_TILES)) {
                const slot = marketSlot(model.row), list = slot.parentElement;
                if (list?.matches('[class*="itemList__"]')) {
                    list.setAttribute("data-tw-ic-compact", ""); state.compactLists.add(list);
                    slot.setAttribute("data-tw-ic-grid-slot", "");
                }
            }
        }
        state.hiddenCount = hidden;
        if (state.resetFilters) state.resetFilters.hidden = !FILTER_KEYS.some(key => state.opts[key]);
        if (state.tempToggle) state.tempToggle.hidden = !models.some(model => model.group === "Temporary");
        syncTempButtons();
        syncMarketSliders(models, refs);
    }
    function clearFilterLayout() {
        for (const slot of state.filterSlots) slot.removeAttribute("data-tw-ic-filter-slot");
        state.filterSlots.clear();
        for (const list of state.compactLists) {
            list.removeAttribute("data-tw-ic-compact");
            for (const slot of list.children) slot.removeAttribute("data-tw-ic-grid-slot");
        }
        state.compactLists.clear();
    }
    function marketSlot(row) {
        if (state.mode !== "market") return row;
        // A tile's enclosing LI is the grid cell. Hiding only the inner DIV
        // leaves an empty cell. Never collapse a container of multiple items.
        for (let slot = row; slot && slot !== state.root; slot = slot.parentElement) {
            if (slot.parentElement?.matches('[class*="itemList__"],[class*="sellerList__"]')) {
                if (slot.querySelectorAll(MARKET_TILES).length <= (slot.matches(MARKET_TILES) ? 0 : 1)) return slot;
                return row;
            }
            if (slot !== row && slot.matches(SHOP_ROWS)) break;
        }
        return row;
    }
    function marketGroup(models) {
        const id = marketItemId();
        if (id) return groupOf(catalogEntry(id));
        const query = new URLSearchParams(location.search), hash = new URLSearchParams(location.hash.replace(/^#\/?/, ""));
        const category = clean(hash.get("categoryName") || query.get("categoryName"));
        const group = GROUPS.find(g => g.toLowerCase() === category.toLowerCase());
        if (group) return group;
        // Armor/category searches can mix slots with different baselines.
        // Do not apply one slot's minimum globally to the others.
        return "";
    }
    function marketSliderControls() {
        if (state.mode !== "market" || !state.root) return [];
        const result = [];
        for (const host of state.root.querySelectorAll('[class*="rangeSlider"]')) {
            if (owned(host) || host.closest('[data-aon-brf]')) continue;
            const inputs = [...host.querySelectorAll('input[type="range"]')];
            const low = inputs.find(n => /sliderMin/.test(n.className));
            const high = inputs.find(n => /sliderMax/.test(n.className));
            if (!low || !high || low.disabled || high.disabled) continue;
            const label = clean(host.querySelector('[class*="leftText"]')?.textContent || host.getAttribute("aria-label") || low.getAttribute("aria-label")).toLowerCase();
            const keys = ["damage", "accuracy", "armor", "coverage"].filter(k => new RegExp(k === "armor" ? "\\b(?:armor|armour|defen[cs]e)\\b" : "\\b" + k + "\\b").test(label));
            if (keys.length === 1) result.push({ host, low, high, key: keys[0] });
        }
        return result;
    }
    function setNativeRange(input, value) {
        const view = input.ownerDocument.defaultView;
        const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value")?.set;
        if (!setter) return false;
        state.syncingSliders = true;
        try {
            setter.call(input, String(value));
            input.dispatchEvent(new view.Event("input", { bubbles: true }));
            input.dispatchEvent(new view.Event("change", { bubbles: true }));
            return Math.abs(Number(input.value) - value) < 0.000001;
        } finally { state.syncingSliders = false; }
    }
    function restoreMarketSliders(keep = new Set()) {
        for (const [input, entry] of state.sliderStates) {
            if (keep.has(input) && input.isConnected) continue;
            state.sliderStates.delete(input);
            // Leave a user's later manual refinement intact.
            if (input.isConnected && entry.applied !== null && Number(input.value) === entry.applied) setNativeRange(input, entry.before);
        }
    }
    function syncMarketSliders(models, refs) {
        const controls = marketSliderControls(), group = marketGroup(models), ref = refs.get(group), base = ref && statsFor(ref);
        const active = new Set(), notes = [];
        const filter = { damage: "hideLowerDamage", accuracy: "hideLowerAccuracy", armor: "hideLowerArmor", coverage: "hideLowerCoverage" };
        const armor = Object.hasOwn(SLOT_AREA, group), scope = "market:" + marketItemId() + ":" + group;
        for (const control of controls) {
            const { low, high, key } = control;
            if (!low.isConnected || !state.opts.enabled || !state.opts[filter[key]] || !group || !ref) continue;
            if ((key === "armor" || key === "coverage") !== armor || (key === "accuracy" && group === "Temporary")) continue;
            // A global native damage minimum would also discard protected
            // temporary effects before the local override could keep them.
            if (group === "Temporary" && state.opts.keepTempEffects) continue;
            const area = state.opts.coverageArea === "slot" ? SLOT_AREA[group] : state.opts.coverageArea;
            const target = key === "coverage" ? coverage(catalogEntry(ref.id), area) : base && !base.stale ? number(base[key]) : null;
            if (target === null) continue;
            const min = number(low.getAttribute("min")) ?? 0, max = number(low.getAttribute("max")) ?? 100;
            const step = low.step === "any" ? 0 : number(low.getAttribute("step")) || 1;
            // Floor to Torn's supported step so equal fractional ratings are
            // not excluded by rounding upward. Local filtering stays exact.
            const wanted = Number((step ? min + Math.floor((target - min) / step + 1e-7) * step : target).toFixed(6));
            if (wanted < min || wanted > max || wanted > Number(high.value)) continue;
            const previous = state.sliderStates.get(low);
            if (previous && previous.scope !== scope) restoreMarketSliders(new Set([...state.sliderStates.keys()].filter(n => n !== low)));
            let entry = state.sliderStates.get(low);
            const changed = !entry || entry.wanted !== wanted;
            if (!entry) { entry = { scope, before: Number(low.value), applied: null, wanted, failed: false }; state.sliderStates.set(low, entry); }
            active.add(low);
            if (changed) { entry.wanted = wanted; entry.failed = false; }
            if (!entry.failed && (changed || Number(low.value) < wanted)) {
                const already = Number(low.value) === wanted;
                if (!already && !setNativeRange(low, wanted)) entry.failed = true;
                if (!already && !entry.failed) entry.applied = wanted;
            }
            notes.push((key === "armor" ? "AR" : key === "accuracy" ? "A" : key === "damage" ? "D" : "Coverage") + " ≥ " + fmt(target) + (entry.failed ? " (local filter)" : wanted !== target ? " (slider " + fmt(wanted) + ")" : ""));
        }
        restoreMarketSliders(active);
        state.sliderStatus = notes.length ? "Market minimums: " + notes.join(" · ") : "";
        if (state.sliderStatus !== state.lastSliderStatus) {
            state.lastSliderStatus = state.sliderStatus;
            log("Market slider minimums", { group, controls: controls.length, active: active.size, summary: state.sliderStatus });
        }
    }
    function resetFilters() {
        for (const key of FILTER_KEYS) state.opts[key] = false;
        saveOptions(); schedule();
        if (state.modal) openSettings();
    }
    function hasTemporaryStatus(item) {
        if (groupOf(item) !== "Temporary") return false;
        const value = effect(item);
        if (["💥", "🎉", "·"].includes(value.symbol)) return false;
        if (value.symbol !== "✦") return true;
        return /(?:buff|debuff|stun|blind|smok|gas|maced|burn|poison|paraly|ensnar|strength|dexterity|defen[cs]e|speed|heal|life restoration)/i.test(value.text);
    }
    function syncTempButtons() {
        const text = "Keep temporary effect items visible: " + (state.opts.keepTempEffects ? "ON" : "OFF");
        for (const node of document.querySelectorAll("[data-tw-ic-temp-toggle]")) {
            if (node.textContent !== text) node.textContent = text;
            const pressed = String(state.opts.keepTempEffects);
            if (node.getAttribute("aria-pressed") !== pressed) node.setAttribute("aria-pressed", pressed);
        }
    }
    function tempEffectButton() {
        const node = button("Keep temporary effect items visible: " + (state.opts.keepTempEffects ? "ON" : "OFF"), () => {
            state.opts.keepTempEffects = !state.opts.keepTempEffects; saveOptions(); syncTempButtons(); schedule();
        });
        node.setAttribute("data-tw-ic-temp-toggle", ""); node.setAttribute("aria-pressed", String(state.opts.keepTempEffects));
        node.title = "Let temporary status effects and self buffs pass through lower-stat filters.";
        return node;
    }
    function sameItem(a, b) { return Boolean(a && b && (a.uid && b.uid ? a.uid === b.uid && a.id === b.id : a.group === "Temporary" && b.group === "Temporary" && a.id === b.id)); }
    function compare(a, b) {
        if (isRatingRange(a)) {
            if (number(b) === null) return { symbol: "?", cls: "unknown", text: "comparison unavailable" };
            const min = compare(a.min, b), max = compare(a.max, b);
            if (min.cls === "up") return { symbol: "↑", cls: "up", text: "entire shop range is higher" };
            if (max.cls === "down") return { symbol: "↓", cls: "down", text: "entire shop range is lower" };
            if (min.cls === "equal" && max.cls === "equal") return { symbol: "=", cls: "equal", text: "equal" };
            return { symbol: "↕", cls: "equal", text: "shop range overlaps the reference; individual roll unknown" };
        }
        if (number(a) === null || number(b) === null) return { symbol: "?", cls: "unknown", text: "comparison unavailable" };
        const delta = Math.round((a - b) * 100) / 100;
        return delta > 0 ? { symbol: "↑", cls: "up", text: "higher", delta } : delta < 0 ? { symbol: "↓", cls: "down", text: "lower", delta } : { symbol: "=", cls: "equal", text: "equal", delta: 0 };
    }
    function rof(item) {
        const v = item && item.details && item.details.ammo && item.details.ammo.rate_of_fire;
        const min = v && number(v.minimum), max = v && number(v.maximum);
        return min !== null && min !== undefined && max !== null && max !== undefined && min <= max ? { min, max } : null;
    }
    function compareRoF(a, b) {
        if (!a || !b) return { symbol: "?", cls: "unknown", text: "comparison unavailable" };
        if (a.min === b.min && a.max === b.max) return { symbol: "=", cls: "equal", text: "same rounds-per-turn range" };
        if (a.min >= b.min && a.max >= b.max) return { symbol: "↑", cls: "up", text: "higher rounds-per-turn range" };
        if (a.min <= b.min && a.max <= b.max) return { symbol: "↓", cls: "down", text: "lower rounds-per-turn range" };
        return { symbol: "↕", cls: "equal", text: "mixed range, neither consistently higher nor lower" };
    }
    function coverage(item, area) {
        const list = item && item.details && item.details.coverage;
        if (!Array.isArray(list) || !list.length) return null;
        const found = list.find(i => i.name === area);
        // A nonempty official list enumerates covered parts; omitted parts are uncovered.
        return found ? number(found.value) : area === "Full Body" ? null : 0;
    }
    function effect(item) {
        const n = String(item && item.name || "").toLowerCase();
        const text = clean(item && item.effect);
        const known = [
            [/pepper spray/, "🌶️", "Maced: enemy dexterity debuff"],
            [/concussion grenade/, "😵‍💫", "Concussed: enemy dexterity debuff"],
            [/flash grenade/, "⚡", "Blinded: enemy speed debuff"],
            [/smoke grenade/, "😶‍🌫️", "Smoked: enemy speed debuff"],
            [/tear gas/, "😭", "Gassed: enemy dexterity debuff"],
            [/nerve gas/, "☣️", "Nerve gas"],
            [/molotov/, "🔥", "Burning: damage over time"],
            [/bolas/, "🪢", "Ensnared: enemy misses turns"],
            [/stygian darkness/, "🫥", "Draws an interdimensional opponent into the physical realm"],
            [/epinephrine/, "💪", "Self buff: strength"],
            [/melatonin/, "🏃", "Self buff: speed"],
            [/serotonin/, "🛡️", "Self buff: defense and life restoration"],
            [/tyrosine/, "🎯", "Self buff: dexterity"],
            [/glitter bomb|party popper/, "🎉", "Decorative visual effect"],
            [/grenade|heg|nail bomb|claymore|fireworks/, "💥", "Explosive damage"]
        ];
        const found = known.find(([rx]) => rx.test(n));
        if (found) return { symbol: found[1], text: text || found[2], label: found[2] };
        if (/burn|fire damage/i.test(text)) return { symbol: "🔥", text, label: "Burning effect" };
        return { symbol: text ? "✦" : "·", text: text || "No special effect reported by the catalog.", label: text ? "See catalog effect" : "No special effect reported" };
    }

    // Combat effects are separate from catalog.effect, which can describe
    // crime uses (the Flamethrower's catalog effect describes Arson).
    // Innate effects: https://wiki.torn.com/wiki/Weapon_Bonus
    // No proc chance or rolled bonus value is guessed from the weapon's name.
    const COMBAT_EFFECTS = Object.freeze({
        burn: ["🔥", "Burn", "Can inflict Burning damage over time."],
        "severe burning": ["🔥", "Severe Burning", "Burning damage over time."],
        shock: ["⚡", "Shock", "Can cause the opponent to miss their next turn."],
        poisoned: ["☠️", "Poisoned", "Poison damage over time."],
        bleed: ["🩸", "Bleed", "Bleeding damage over time."],
        laceration: ["🩸", "Laceration", "Laceration damage over time."],
        freeze: ["❄️", "Freeze", "Reduces the opponent's speed and dexterity."],
        demoralized: ["😰", "Demoralized", "Reduces the opponent's battle stats."],
        toxin: ["☣️", "Toxin", "Applies a random battle-stat debuff."],
        stun: ["😵‍💫", "Stun", "Can cause the opponent to miss their next turn."],
        paralyze: ["🔒", "Paralyze", "Can cause the opponent to miss turns."],
        suppress: ["🔊", "Suppress", "Can cause the opponent to miss future turns."],
        wither: ["🥀", "Wither", "Reduces the opponent's strength."],
        slow: ["🐌", "Slow", "Reduces the opponent's speed."],
        cripple: ["🦵", "Cripple", "Reduces the opponent's dexterity."],
        weaken: ["🛡️", "Weaken", "Reduces the opponent's defense."],
        eviscerate: ["💢", "Eviscerate", "Increases damage received by the opponent."],
        disarm: ["🚫", "Disarm", "Temporarily disables the opponent's weapon."]
    });
    function combatEffectKey(title) {
        const key = clean(title).toLowerCase();
        return ({ burning: "burn", poison: "poisoned", bleeding: "bleed", demoralize: "demoralized", paralyzed: "paralyze" })[key] || key;
    }
    function weaponEffects(item, actual) {
        if (!item || item.type !== "Weapon") return [];
        if (groupOf(item) === "Temporary") return [effect(item)];
        const effects = new Map();
        for (const bonus of actual?.bonuses || []) {
            if (!bonus || typeof bonus !== "object") continue;
            const key = combatEffectKey(bonus.title || bonus.name), definition = Object.hasOwn(COMBAT_EFFECTS, key) ? COMBAT_EFFECTS[key] : null;
            if (!definition) continue;
            const value = number(bonus.value);
            effects.set(key, { symbol: definition[0], label: definition[1] + (value !== null ? " · " + fmt(value) : ""),
                text: clean(bonus.description) || definition[2], source: "Individual item bonus" });
        }
        const innate = { flamethrower: "burn", taser: "shock", "cattle prod": "shock", blowgun: "poisoned",
            "snow cannon": "freeze", "bread knife": "laceration", "gold plated ak-47": "demoralized", "poison umbrella": "toxin" };
        const name = clean(item.name).toLowerCase();
        const key = Object.hasOwn(innate, name) ? innate[name] : "";
        if (key && !effects.has(key)) {
            const definition = COMBAT_EFFECTS[key];
            effects.set(key, { symbol: definition[0], label: definition[1], text: definition[2],
                source: "Known innate effect; this copy's bonus value is unavailable" });
        }
        return [...effects.values()];
    }
    function effectIcon(value) {
        const icon = el("span", value.symbol, P + "effect");
        const description = value.label + ": " + value.text + (value.source ? " · " + value.source : "");
        icon.title = description; icon.setAttribute("role", "img"); icon.setAttribute("aria-label", description);
        return icon;
    }

    async function loadCatalog(category, force = false) {
        const old = state.catalogs.get(category);
        if (!force && fresh(old, TTL.catalog)) return;
        const last = state.catalogAttempts.get(category) || 0;
        if (!force && Date.now() - last < 60000) return;
        state.catalogAttempts.set(category, Date.now());
        state.progress = "Loading " + category.toLowerCase() + " reference data"; schedule();
        const data = await api("torn/items", { cat: category });
        if (!Array.isArray(data.items)) throw new Error("Unexpected catalog response");
        state.catalogs.set(category, { items: data.items, at: Date.now() });
    }
    async function loadInventory(category, force = false) {
        if (!category || !["Primary", "Secondary", "Melee", "Temporary", "Defensive"].includes(category)) return;
        if (!force && fresh(state.inventories.get(category), TTL.inventory)) return;
        const failureKey = "inventory:" + category;
        if (!force && Date.now() - (state.failures.get(failureKey) || 0) < 60000) return;
        const items = []; let offset = 0;
        try {
            while (offset < 20000) {
                state.progress = "Reading " + category.toLowerCase() + " inventory"; schedule();
                const data = await api("user/inventory", { cat: category, limit: 250, offset });
                if (!data.inventory || !Array.isArray(data.inventory.items)) throw new Error("Unexpected inventory response");
                const rows = data.inventory.items; items.push(...rows); offset += rows.length;
                const metadata = data._metadata || {};
                if (!rows.length || rows.length < 250 || (number(metadata.total) !== null && offset >= number(metadata.total))) break;
                if (metadata.links && Object.hasOwn(metadata.links, "next") && !metadata.links.next) break;
            }
            state.inventories.set(category, { items, at: Date.now() });
            if (offset >= 20000) state.notice = "Large inventory: UID fallback list truncated. Direct row UIDs still work.";
        } catch (e) { state.failures.set(failureKey, Date.now()); throw e; }
    }
    async function loadEquipment() {
        if ((!state.equipmentWanted && state.equipmentAt) || Date.now() - state.equipmentFailedAt < 30000) return;
        state.equipmentWanted = false;
        try {
            state.progress = "Reading equipped items"; schedule();
            const data = await api("user/equipment");
            if (!Array.isArray(data.equipment)) throw new Error("Unexpected equipment response");
            state.equipment = data.equipment; state.equipmentAt = Date.now();
            for (const raw of data.equipment) { const item = statRecord(raw); if (item) state.details.set(item.uid, item); }
            log("Equipped items loaded", { count: data.equipment.length });
        } catch (e) { state.equipmentFailedAt = Date.now(); throw e; }
    }
    function currentModels() {
        if (!state.root) return [];
        const candidates = Array.from(state.root.querySelectorAll(state.mode === "inventory" ? ROWS : state.mode === "abroad" ? ABROAD_ROWS : SHOP_ROWS)).filter(n => !owned(n));
        state.rowCandidates = candidates.length;
        const rows = new Set(candidates.map(itemOwner).filter(row => row && state.root.contains(row)));
        // Only resolved item owners participate here. Nested action LIs have
        // already mapped to their parent item, so they cannot discard it.
        const groups = new Set();
        for (const row of rows) {
            for (let p = row.parentElement; p && p !== state.root; p = p.parentElement) if (rows.has(p)) groups.add(p);
        }
        return [...rows].filter(row => !groups.has(row) && rowVisible(row))
            .map(state.mode === "inventory" ? readRow : readShoppingRow).filter(Boolean);
    }
    async function hydrate() {
        if (!state.key || !state.opts.enabled || state.blocked || Date.now() < state.blockedUntil) return;
        if (state.hydrating) { state.again = true; return; }
        state.hydrating = true; const epoch = state.epoch;
        try {
            await loadCatalog("Weapon");
            await loadCatalog("Armor");
            await loadEquipment();
            if (epoch !== state.epoch) return;
            let models = currentModels();
            // Inventory is a fallback only for ambiguous data-id attributes, not
            // a way to assign duplicate copies by their display order or names.
            const needsInventory = state.mode === "inventory" ? [...new Set(models.filter(m => !m.uid && m.weak && m.group !== "Temporary").map(m => inventoryCategory(m.group)))] : [];
            for (const category of needsInventory) {
                try { await loadInventory(category); }
                catch (e) { log("Inventory fallback unavailable", { category, message: e.message }, "WARN"); if (state.blocked || epoch !== state.epoch) throw e; }
            }
            models = currentModels();
            const refs = references(models);
            const wanted = [...refs.values(), ...models];
            const requested = new Set();
            const pending = [];
            for (const model of wanted) {
                if (!model.uid || requested.has(model.uid)) continue;
                if (model.shopping && statsFor(model) && !statsFor(model).stale) continue;
                const record = state.details.get(model.uid);
                if (fresh(record, TTL.detail) && record.id === model.id) continue;
                if (Date.now() - (state.failures.get(model.uid) || 0) < 60000) continue;
                requested.add(model.uid); pending.push(model);
            }
            let completed = 0;
            for (let i = 0; i < pending.length; i += 25) {
                if (epoch !== state.epoch || !state.opts.enabled) return;
                // Stop obsolete category work if React replaced the inventory.
                const visible = currentModels();
                const stillNeeded = new Set([...visible, ...references(visible).values()].map(m => m.uid).filter(Boolean));
                const batch = pending.slice(i, i + 25).filter(m => stillNeeded.has(m.uid));
                if (!batch.length) continue;
                state.progress = "Loading individual stats: " + completed + "/" + pending.length; schedule();
                try {
                    const data = await api("torn/" + batch.map(m => m.uid).join(",") + "/itemdetails");
                    const entries = detailEntries(data); const accepted = new Set();
                    for (const raw of entries) {
                        const record = statRecord(raw);
                        if (!record) continue;
                        const expected = batch.find(m => m.uid === record.uid && m.id === record.id);
                        if (!expected) { log("UID response mismatch ignored", { uid: record.uid, itemId: record.id }, "WARN"); continue; }
                        state.details.set(record.uid, record); accepted.add(record.uid);
                    }
                    for (const m of batch) if (!accepted.has(m.uid)) state.failures.set(m.uid, Date.now());
                    completed += batch.length;
                    log("Individual stats loaded", { requested: batch.length, accepted: accepted.size }); schedule();
                } catch (e) {
                    for (const m of batch) state.failures.set(m.uid, Date.now());
                    log("Individual stats unavailable", { count: batch.length, message: e.message }, "WARN");
                    throw e;
                }
            }
            if (epoch === state.epoch) { state.notice = ""; await saveCache(); }
        } catch (e) {
            if (epoch === state.epoch && e.message !== "Request canceled") { state.notice = e.message; log("Data refresh stopped", { message: e.message }, "WARN"); }
        } finally {
            state.progress = ""; state.hydrating = false; schedule();
            if (state.again) { state.again = false; /* Next relevant render checks only uncached work. */ }
        }
    }
    function needsHydration(models) {
        if (!state.key || !state.opts.enabled || state.hydrating || state.blocked || Date.now() < state.blockedUntil) return false;
        if (["Weapon", "Armor"].some(c => !fresh(state.catalogs.get(c), TTL.catalog) && Date.now() - (state.catalogAttempts.get(c) || 0) >= 60000)) return true;
        if ((state.equipmentWanted || !state.equipmentAt) && Date.now() - state.equipmentFailedAt >= 30000) return true;
        if (state.mode === "inventory" && models.some(m => !m.uid && m.weak && m.group && m.group !== "Temporary" && !fresh(state.inventories.get(inventoryCategory(m.group)), TTL.inventory) && Date.now() - (state.failures.get("inventory:" + inventoryCategory(m.group)) || 0) >= 60000)) return true;
        return [...models, ...references(models).values()].some(m => m.uid && !(m.shopping && statsFor(m) && !statsFor(m).stale) && (!fresh(state.details.get(m.uid), TTL.detail) || state.details.get(m.uid).id !== m.id) && Date.now() - (state.failures.get(m.uid) || 0) >= 60000);
    }

    function applyTheme() {
        const css = `:root{--tw-ic-up:${state.opts.upColor};--tw-ic-down:${state.opts.downColor};--tw-ic-size:${state.opts.fontSize}px;--tw-ic-arrow-size:${state.opts.arrowSize}px;--tw-ic-effect-size:${state.opts.effectSize}px}`;
        let node = document.getElementById(P + "theme");
        if (!node) { node = el("style"); node.id = P + "theme"; node.setAttribute("data-tw-ic-owned", "theme"); (document.head || document.documentElement).appendChild(node); }
        if (node.textContent !== css) node.textContent = css;
    }
    function styles() {
        if (document.getElementById(P + "styles")) return;
        const node = el("style"); node.id = P + "styles"; node.setAttribute("data-tw-ic-owned", "style");
        node.textContent = `
        [data-tw-ic-filtered],[data-tw-ic-filter-slot]{display:none!important}
        [data-tw-ic-compact]>[data-tw-ic-grid-slot]{clear:none!important;grid-column:auto!important;grid-row:auto!important;height:auto!important;max-height:none!important}
        [data-tw-ic-bazaar-layout~="cell"],[data-tw-ic-bazaar-layout~="flow"]{height:auto!important;max-height:none!important;min-width:0!important;overflow:visible!important}
        .${P}annotated[data-tw-ic-bazaar-layout~="card"]>[class*="itemDescription__"]{padding-left:2px!important;padding-right:0!important}
        .${P}annotated[data-tw-ic-bazaar-layout~="card"] .${P}wrap{padding:1px 0!important}
        .${P}annotated[data-tw-ic-bazaar-layout~="card"] .${P}wrap .${P}chip{flex-direction:row!important;flex-wrap:wrap!important;align-items:center!important;justify-content:flex-start!important;column-gap:6px!important;row-gap:0!important;overflow-x:auto!important;overflow-y:hidden!important}
        .${P}annotated[data-tw-ic-bazaar-layout~="card"] .${P}wrap .${P}metric{flex-shrink:0!important;max-width:none!important}
        .${P}annotated[data-tw-ic-bazaar-layout~="card"] .${P}wrap .${P}metric>span:first-child{flex-shrink:0!important}
        [data-tw-ic-bazaar-layout~="compact"]{padding-top:0!important;padding-bottom:0!important}
        [data-tw-ic-bazaar-layout~="compact"] [data-tw-ic-bazaar-layout~="cell"]{padding-top:0!important;padding-bottom:0!important}
        .${P}annotated[data-tw-ic-bazaar-layout~="compact"][data-tw-ic-mount] .${P}wrap{padding:0!important}
        .${P}annotated[data-tw-ic-bazaar-layout~="compact"] .${P}wrap .${P}chip{flex-wrap:nowrap!important;min-height:0!important;width:max-content!important;max-width:100%!important;padding:0!important;overflow-x:auto!important;overflow-y:hidden!important;scrollbar-width:none}
        [data-tw-ic-bazaar-layout~="compact"] .${P}chip::-webkit-scrollbar{display:none}
        .${P}annotated[data-tw-ic-bazaar-layout~="compact"] .${P}wrap .${P}line,.${P}annotated[data-tw-ic-bazaar-layout~="compact"] .${P}wrap .${P}rof{flex-shrink:0!important;max-width:none!important;flex-wrap:nowrap!important}
        .${P}annotated[data-tw-ic-bazaar-layout~="compact"] .${P}wrap .${P}line{column-gap:4px!important}
        .${P}annotated[data-tw-ic-bazaar-layout~="compact"] .${P}wrap .${P}metric{gap:1px!important}
        .${P}annotated[data-tw-ic-bazaar-layout~="compact"] .${P}wrap .${P}effect{line-height:1!important}
        .${P}toolbar [hidden]{display:none!important}
        /* Both layouts stay within the resolved native inventory row. */
        .${P}annotated{height:auto!important;max-height:none!important;flex-wrap:wrap!important}
        .${P}inline-grow{height:auto!important;max-height:none!important}
        .${P}annotated .${P}inline-clear{display:block!important;position:static!important;clear:both!important;float:none!important;
          width:0!important;min-width:0!important;height:0!important;min-height:0!important;line-height:0!important;
          margin:0!important;padding:0!important;border:0!important;overflow:hidden!important}
        .${P}inline-host{display:flex!important;flex-wrap:wrap!important;align-items:center!important;column-gap:8px!important;row-gap:2px!important;
          min-width:0!important;max-width:100%!important;height:auto!important;max-height:none!important;
          box-sizing:border-box!important;white-space:normal!important;overflow:visible!important}
        .${P}inline-host>.name{float:none!important;min-width:0!important;max-width:100%!important;flex:0 1 auto!important;
          white-space:normal!important;overflow-wrap:anywhere!important}
        .${P}annotated .${P}wrap{display:block!important;position:static!important;float:none!important;clear:both!important;
          box-sizing:border-box!important;width:100%!important;min-width:0!important;max-width:100%!important;
          height:auto!important;min-height:0!important;max-height:none!important;margin:0!important;
          padding:3px 8px!important;flex:0 0 100%!important;grid-column:1/-1!important;align-self:stretch!important;
          white-space:normal!important;text-align:left!important;line-height:normal!important;overflow:visible!important}
        .${P}annotated[data-tw-ic-mount="cell"] .${P}wrap{padding:3px 0!important}
        .${P}annotated[data-tw-ic-mount="inline"] .${P}wrap{display:inline-flex!important;width:auto!important;
          flex:0 1 auto!important;clear:none!important;padding:1px 0!important;align-self:center!important}
        .${P}annotated .${P}wrap *{box-sizing:border-box!important;float:none!important;position:static!important;
          inset:auto!important;min-width:0!important;max-width:100%!important;width:auto!important;height:auto!important;
          margin:0!important;padding:0!important;border:0!important;text-indent:0!important;letter-spacing:normal!important;
          text-transform:none!important;vertical-align:baseline!important;font-family:Arial,sans-serif!important;
          line-height:inherit!important}
        .${P}annotated .${P}wrap .${P}chip{display:inline-flex!important;flex-direction:column!important;align-items:flex-start!important;
          justify-content:center!important;gap:1px!important;min-height:24px!important;margin:0!important;padding:2px 5px!important;
          border:0!important;border-radius:4px!important;background:#171c20e8!important;color:#edf4f7!important;
          font:var(--tw-ic-size,11px)/1.35 Arial,sans-serif!important;text-shadow:none!important;cursor:pointer;
          box-shadow:none!important;white-space:normal!important;touch-action:manipulation}
        .${P}annotated .${P}wrap .${P}line{display:flex!important;align-items:center!important;flex-wrap:wrap!important;gap:8px!important}
        .${P}annotated .${P}wrap .${P}metric{display:inline-flex!important;align-items:center!important;gap:3px!important;
          white-space:nowrap!important;font-variant-numeric:tabular-nums!important}
        .${P}annotated .${P}wrap .${P}arrow{font-weight:700!important;font-size:var(--tw-ic-arrow-size,18px)!important;line-height:1!important;flex-shrink:0!important}
        .${P}annotated .${P}wrap .${P}effect{display:inline-block!important;font-size:var(--tw-ic-effect-size,22px)!important;
          font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif!important;
          line-height:1.15!important;flex-shrink:0!important;white-space:nowrap!important}
        .${P}up{color:var(--tw-ic-up,#79e6a5)!important}.` + P + `down{color:var(--tw-ic-down,#99d9ff)!important}
        .${P}equal{color:#d5dce1!important}.` + P + `unknown{color:#c9c1a7!important}
        .${P}annotated .${P}wrap .${P}rof{font-size:.86em!important;opacity:.95}
        .${P}annotated .${P}wrap .${P}delta{font-size:.9em!important;opacity:.85}
        .${P}toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;min-height:34px;margin:4px 0;
          padding:2px 5px;box-sizing:border-box;color:#dbe6ed;background:#22292fd9;border-radius:5px;font:11px/1.3 Arial,sans-serif;clear:both}
        .${P}toolbar>div{flex:1 1 200px;min-width:0;overflow-wrap:anywhere}
        .${P}toolbar>.${P}button{max-width:100%;white-space:normal}
        .${P}toolbar small{display:block;color:#b4c7d2;font-size:10px;overflow-wrap:anywhere}
        .${P}gear{flex-shrink:0;width:34px;min-height:32px;padding:0;border:1px solid #77828b;border-radius:6px;
          background:#222b31;color:#ebf7ff;font-size:21px;cursor:pointer;touch-action:manipulation}
        .${P}fallback{position:fixed;right:12px;bottom:145px;z-index:2147483630}
        .${P}overlay{position:fixed;inset:0;z-index:2147483640;display:flex;align-items:center;justify-content:center;
          background:#000a;padding:12px;box-sizing:border-box;isolation:isolate}
        .${P}panel{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;width:min(560px,100%);max-height:88vh;
          max-height:88dvh;overflow:auto;background:#20262b;color:#edf5f8;border:1px solid #71838f;border-radius:12px;
          padding:16px;font:13px/1.5 Arial,sans-serif;box-shadow:0 10px 40px #000b;overscroll-behavior:contain;text-align:left}
        .${P}panel *{box-sizing:border-box}.` + P + `panel h2{font:700 18px/1.3 Arial,sans-serif;margin:0;color:#f3f8fb}
        .${P}panel h3{font:700 14px/1.4 Arial,sans-serif;margin:4px 0;color:#edf5f8}.` + P + `panel p{margin:0}
        .${P}panel a{color:#a7dfff!important;text-decoration:underline!important}.` + P + `panel small{color:#bdcbd4}
        .${P}panel [hidden]{display:none!important}.` + P + `panel input:not([type=checkbox]):not([type=color]),.${P}panel select{
          width:100%;min-height:36px;background:#111a20;color:#f1f5f9;border:1px solid #738694;border-radius:5px;padding:6px;font:inherit}
        .${P}panel input[type=checkbox]{width:18px;height:18px;flex-shrink:0}.` + P + `panel input[type=color]{width:48px;height:34px}
        .${P}field{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:34px}
        .${P}stack{display:flex;flex-direction:column;gap:6px}.` + P + `actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
        .${P}button{min-height:36px;border:1px solid #708a9b;border-radius:6px;padding:6px 10px;background:#304550;
          color:#fff;font:13px/1.3 Arial,sans-serif;cursor:pointer;text-transform:none;touch-action:manipulation}
        .${P}panel button:focus-visible,.${P}gear:focus-visible,.${P}chip:focus-visible{outline:2px solid #b0e6ff;outline-offset:2px}
        .${P}muted{color:#bdcbd4;font-size:12px}.` + P + `table{width:100%;border-collapse:collapse;font:12px/1.4 Arial,sans-serif}
        .${P}table th,.${P}table td{padding:5px;text-align:left;border-bottom:1px solid #4b5962;color:#eff7fb}
        .${P}callout{padding:9px;background:#14202a;border:1px solid #415c70;border-radius:6px;overflow-wrap:anywhere}
        #${P}support{position:static!important;inset:auto!important;z-index:auto!important;width:100%!important;display:flex!important;
          flex-direction:column!important;gap:8px!important;margin:4px 0!important}
        #${P}support .tw-support-btn{max-width:100%;min-width:0}
        @media(max-width:480px){.${P}annotated .${P}wrap{padding:3px 4px!important}
          .${P}annotated[data-tw-ic-mount="inline"] .${P}wrap{padding:1px 0!important}
          .${P}annotated .${P}wrap .${P}line{gap:5px!important}
          .${P}overlay{padding:8px}.${P}panel{padding:12px;max-height:90vh;max-height:90dvh}}
        `;
        (document.head || document.documentElement).appendChild(node); applyTheme();
    }
    function ensureToolbar() {
        if (!state.toolbar) {
            const bar = el("div", null, P + "toolbar"); bar.id = P + "toolbar"; bar.setAttribute("data-tw-ic-owned", "toolbar");
            const text = el("div"); state.baselineText = el("span"); state.statusText = el("small"); text.append(state.baselineText, state.statusText);
            const gear = button("⚙", openSettings, P + "gear"); gear.title = "Inventory Compare settings"; gear.setAttribute("aria-label", "Open Inventory Compare settings");
            state.resetFilters = button("Reset filters", resetFilters); state.resetFilters.hidden = true;
            state.tempToggle = tempEffectButton(); state.tempToggle.hidden = true;
            bar.append(text, state.resetFilters, state.tempToggle, gear); state.toolbar = bar;
        }
        const bar = state.toolbar;
        if (state.root && state.root.parentElement) {
            bar.classList.remove(P + "fallback");
            if (bar.nextElementSibling !== state.root) state.root.before(bar);
        } else if (!bar.isConnected) { bar.classList.add(P + "fallback"); document.body.appendChild(bar); }
    }
    function metric(label, value, baseline, percent = false, compact = false) {
        const node = el("span", null, P + "metric"); const c = compare(value, baseline);
        node.append(el("span", label + (state.opts.showValues && !compact ? " " + ratingText(value) + (percent && number(value) !== null ? "%" : "") : "")));
        const arrow = el("span", c.symbol, P + "arrow " + P + c.cls); arrow.setAttribute("aria-hidden", "true"); node.append(arrow);
        if (state.opts.showDeltas && !compact && c.delta !== undefined && c.delta !== 0) node.append(el("small", (c.delta > 0 ? "+" : "") + fmt(c.delta), P + "delta"));
        node.setAttribute("aria-label", label + " " + ratingText(value) + (percent ? " percent" : "") + ", " + c.text + (number(baseline) !== null ? " than " + fmt(baseline) : ""));
        return node;
    }
    function renderRow(model, ref) {
        const row = model.row;
        const wraps = Array.from(row.querySelectorAll("." + P + "wrap")).filter(n => itemOwner(n.parentElement) === row);
        let wrap = wraps.shift(); wraps.forEach(n => n.remove());
        const cat = catalogEntry(model.id);
        if ((!model.group && !(cat && cat.type === "Armor")) || !state.opts.enabled) { releaseRow(row, wrap); return; }
        const actual = statsFor(model); const base = ref && statsFor(ref);
        const area = state.opts.coverageArea === "slot" ? SLOT_AREA[model.group] : state.opts.coverageArea;
        const sig = JSON.stringify([model.id, model.uid, actual, ref && [ref.id, ref.uid], base, state.opts, cat && cat.details, model.equipped, model.bazaarCompact]);
        if (!wrap) {
            wrap = el("span", null, P + "wrap"); wrap.setAttribute("data-tw-ic-owned", "row");
        }
        prepareRow(row, model, wrap);
        if (state.rowModels.get(row)?.widget === wrap && wrap.querySelector("." + P + "chip") && wrap.getAttribute("data-signature") === sig) { state.rowModels.set(row, { widget: wrap, model }); return; }
        wrap.setAttribute("data-signature", sig); wrap.replaceChildren(); state.rowModels.set(row, { widget: wrap, model });
        const chip = button("", () => openDetails(model, ref), P + "chip");
        const line = el("span", null, P + "line"); const baseline = sameItem(model, ref);
        if (model.group === "Temporary") {
            line.append(metric("D", actual && actual.damage, base && base.damage));
        } else if (cat && cat.type === "Armor") {
            line.append(metric("AR", actual && actual.armor, base && base.armor, false, model.bazaarCompact));
            if (model.group) line.append(metric("C(" + (AREA_SHORT[area] || "?") + ")", coverage(cat, area), ref ? coverage(catalogEntry(ref.id), area) : null, true));
            else line.append(el("small", "Choose armor slot", P + "muted"));
        } else {
            line.append(metric("D", actual && actual.damage, base && base.damage, false, model.bazaarCompact), metric("A", actual && actual.accuracy, base && base.accuracy, false, model.bazaarCompact));
        }
        if (state.opts.showEffects) for (const value of weaponEffects(cat, actual)) line.append(effectIcon(value));
        if (baseline) { const b = el("span", "◎", P + "equal"); b.setAttribute("aria-label", "Reference item"); line.append(b); }
        chip.append(line);
        const rate = rof(cat);
        if (state.opts.showRoF && rate && model.group !== "Temporary") {
            const c = compareRoF(rate, ref && rof(catalogEntry(ref.id)));
            const small = el("small", null, P + "rof " + P + "metric");
            small.append(el("span", "RoF " + rate.min + (rate.min !== rate.max ? "-" + rate.max : "")), el("span", c.symbol, P + "arrow " + P + c.cls));
            small.title = c.text + "; unmodified rounds per turn. Tap for details."; chip.append(small);
        }
        if (actual?.shopRange) chip.append(el("small", "Shop range · roll unknown", P + "muted"));
        if (!actual || actual.stale || !ref) chip.append(el("small", !actual ? (model.uid ? "Stats pending" : model.abroad ? "Shop range unavailable" : "UID needed") : actual.stale ? "Cached stats" : model.shopping ? "No equipped item in this slot" : "Choose reference", P + "muted"));
        chip.title = model.name + (ref ? " vs " + ref.name : ": no reference yet") + (model.shopping ? ". Tap for comparison details." : ". Tap for details or choose a reference.");
        chip.setAttribute("aria-label", chip.title); wrap.append(chip);
    }
    function scanAndRender() {
        if (!state.alive || !document.body) return;
        state.mode = pageMode();
        if (!state.mode) { attachRoot(null); state.toolbar?.remove(); return; }
        styles(); attachRoot(findRoot());
        if (state.mode === "abroad" && !state.root) { state.toolbar?.remove(); return; }
        ensureToolbar();
        const models = currentModels(); state.rows = models;
        const liveRows = new Set(models.map(m => m.row));
        if (state.root) for (const row of state.root.querySelectorAll("." + P + "annotated")) if (!liveRows.has(row)) releaseRow(row);
        const refs = references(models);
        const groups = [...new Set(models.map(m => m.group).filter(Boolean))];
        const labels = groups.map(g => refs.has(g) ? (groups.length > 1 ? g + ": " : "") + refs.get(g).name : g + (state.mode === "inventory" ? ": choose reference" : ": nothing equipped"));
        const title = !state.opts.enabled ? "Inventory Compare paused" : labels.length ? "Compare with: " + labels.join(" | ") : "Inventory Compare";
        if (state.baselineText.textContent !== title) state.baselineText.textContent = title;
        const eligible = models.filter(m => m.group || (catalogEntry(m.id) && catalogEntry(m.id).type === "Armor"));
        state.scanned = eligible.length; state.loaded = eligible.filter(m => statsFor(m)).length;
        for (const m of models) renderRow(m, refs.get(m.group));
        syncBazaarLayout(models);
        applyFilters(models);
        const info = !state.key ? "Tap ⚙ to add a minimal-access Torn API key" : state.blocked || state.progress || state.notice ||
            state.loaded + "/" + state.scanned + " items have stats · " + state.hiddenCount + " hidden · ↑ higher · ↓ lower · = equal · tap stats for details" + (state.sliderStatus ? " · " + state.sliderStatus : "");
        if (state.statusText.textContent !== info) state.statusText.textContent = info;
        const resolution = JSON.stringify([state.rowCandidates, models.length, models.filter(m => m.uid).length]);
        if (resolution !== state.lastRowResolution) {
            state.lastRowResolution = resolution;
            log("Inventory rows resolved", { surface: state.mode, identityNodes: state.rowCandidates, itemRows: models.length, rowsWithUid: models.filter(m => m.uid).length });
        }
        const refSignature = JSON.stringify([title, models.length, [...refs].map(([g, r]) => [g, r.id, r.uid, r.referenceSource])]);
        if (refSignature !== state.lastReferences) {
            state.lastReferences = refSignature;
            log("Comparison references", { categories: groups.length, resolved: groups.filter(g => refs.has(g)).length, rows: models.length });
        }
        checkLayoutSoon();
        if (needsHydration(models)) void hydrate();
        if (!state.key && !state.autoOpened) { state.autoOpened = true; openSettings(); }
    }

    function clippingAncestors(node) {
        if (!node) return [];
        const r = node.getBoundingClientRect(), result = [];
        for (let parent = node.parentElement, depth = 0; parent && depth < 16; parent = parent.parentElement, depth++) {
            const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
            const x = /^(?:hidden|clip)$/.test(style.overflowX) && (r.left < box.left - 2 || r.right > box.right + 2);
            const y = /^(?:hidden|clip)$/.test(style.overflowY) && (r.top < box.top - 2 || r.bottom > box.bottom + 2);
            if (x || y) result.push({ tag: parent.tagName.toLowerCase(), classes: clean(parent.className).slice(0, 180),
                overflowX: style.overflowX, overflowY: style.overflowY, position: style.position,
                width: Math.round(box.width), height: Math.round(box.height), horizontal: x, vertical: y });
            if (parent === state.root) break;
        }
        return result;
    }
    function layoutSnapshot() {
        const box = node => {
            if (!node) return null;
            const r = node.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        };
        const rows = state.rows.filter(m => m.row.isConnected && m.row.getClientRects().length);
        const inventoryRect = state.root?.getBoundingClientRect();
        const horizontalOutside = (r, boundary) => Boolean(r && boundary && (r.left < boundary.left - 2 || r.right > boundary.right + 2));
        const samples = []; let outside = 0, outsideInventory = 0, duplicates = 0, missing = 0, wrongOwner = 0, squeezed = 0, clipped = 0;
        for (const model of rows) {
            const widgets = Array.from(model.row.querySelectorAll("." + P + "chip"));
            const eligible = model.group || catalogEntry(model.id)?.type === "Armor";
            if (!widgets.length && eligible && state.opts.enabled) missing++;
            if (widgets.length > 1) duplicates++;
            const chip = widgets[0], rowRect = model.row.getBoundingClientRect(), r = chip?.getBoundingClientRect();
            const clipAncestors = clippingAncestors(chip);
            if (clipAncestors.length) clipped++;
            const category = model.row.closest(NATIVE_LISTS);
            const nativeOwner = model.row.closest(NATIVE_ROWS);
            const expectedOwner = itemOwner(model.row);
            const misplaced = Boolean(chip && (expectedOwner !== model.row ||
                (nativeOwner && nativeOwner !== model.row && !hasItemTitle(model.row)) ||
                chip.parentElement.parentElement !== rowHost(model.row, model)));
            const narrow = Boolean(r && r.width < 24);
            const beyondInventory = horizontalOutside(r, inventoryRect) || horizontalOutside(r, category?.getBoundingClientRect());
            const beyondRow = Boolean(r && (horizontalOutside(r, rowRect) || r.top < rowRect.top - 2 || r.bottom > rowRect.bottom + 2));
            const bad = beyondRow || beyondInventory;
            if (bad) outside++;
            if (beyondInventory) outsideInventory++;
            if (misplaced) wrongOwner++;
            if (narrow) squeezed++;
            if (samples.length < 3 || ((bad || misplaced || narrow || clipAncestors.length) && samples.length < 8)) samples.push({
                rowTag: model.row.tagName.toLowerCase(), itemId: model.id, hasUid: Boolean(model.uid),
                mountTag: chip?.parentElement.parentElement.tagName.toLowerCase() || null,
                rowDisplay: getComputedStyle(model.row).display, rowBox: box(model.row), widgetBox: box(chip),
                mountClass: clean(chip?.parentElement.parentElement.className), clipAncestors,
                bazaarFrameBox: state.mode === "bazaar" ? box(bazaarGroup(model.row)) : undefined, bazaarCompact: Boolean(model.bazaarCompact),
                categoryBox: box(category), nativeOwnerBox: box(nativeOwner), widgets: widgets.length,
                outside: bad, outsideInventory: beyondInventory, wrongOwner: misplaced, squeezed: narrow
            });
        }
        return { version: VERSION, surface: state.mode, identityNodes: state.rowCandidates, itemRows: rows.length,
            marketTiles: state.root?.querySelectorAll(MARKET_TILES).length || 0,
            collapsedSlots: state.filterSlots.size, nativeSliderControls: marketSliderControls().length, sliderMinimums: state.sliderStatus,
            inventoryBox: box(state.root), outside, outsideInventory, wrongOwner, squeezed, duplicates, missing, clipped, samples };
    }
    function checkLayoutSoon() {
        if (state.layoutFrame) return;
        state.layoutFrame = requestAnimationFrame(() => {
            state.layoutFrame = 0;
            const report = layoutSnapshot();
            const sig = JSON.stringify([report.itemRows, report.outside, report.outsideInventory, report.wrongOwner, report.squeezed, report.duplicates, report.missing, report.clipped]);
            if (sig === state.lastLayout) return;
            state.lastLayout = sig;
            log("Layout check", { rows: report.itemRows, outside: report.outside, outsideInventory: report.outsideInventory,
                wrongOwner: report.wrongOwner, squeezed: report.squeezed, duplicates: report.duplicates, missing: report.missing, clipped: report.clipped },
                report.outside || report.wrongOwner || report.squeezed || report.duplicates || report.missing || report.clipped ? "WARN" : "INFO");
        });
    }

    function closeModal() {
        if (state.support) { state.support.destroy(); state.support = null; }
        if (state.modal) { state.modal.remove(); state.modal = null; }
        if (state.previousFocus && state.previousFocus.isConnected) { try { state.previousFocus.focus({ preventScroll: true }); } catch (_) {} }
    }
    function modal(title) {
        const previous = state.modal ? state.previousFocus : document.activeElement;
        closeModal(); state.previousFocus = previous;
        const overlay = el("div", null, P + "overlay"); overlay.setAttribute("data-tw-ic-owned", "modal"); overlay.id = P + "modal";
        const panel = el("section", null, P + "panel"); panel.tabIndex = -1; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true");
        const head = el("div", null, P + "actions"); const heading = el("h2", title); heading.id = P + "dialog-title"; heading.style.flex = "1";
        panel.setAttribute("aria-labelledby", heading.id); head.append(heading, button("Close", closeModal)); panel.append(head); overlay.append(panel);
        overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
        overlay.addEventListener("keydown", e => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeModal(); return; }
            if (e.key !== "Tab") return;
            const nodes = Array.from(panel.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')).filter(n => !n.disabled && n.getClientRects().length);
            if (!nodes.length) { e.preventDefault(); panel.focus(); return; }
            const i = nodes.indexOf(document.activeElement);
            if (e.shiftKey && i <= 0) { e.preventDefault(); nodes.at(-1).focus(); }
            else if (!e.shiftKey && (i === nodes.length - 1 || i === -1)) { e.preventDefault(); nodes[0].focus(); }
        });
        document.body.appendChild(overlay); state.modal = overlay; panel.focus(); return panel;
    }
    function field(labelText, control) {
        const label = el("label", null, P + "field"); label.append(el("span", labelText), control); return label;
    }
    function optionSelect(options, selected, onChange) {
        const select = el("select");
        for (const [value, name] of options) { const option = el("option", name); option.value = value; select.append(option); }
        select.value = selected; select.addEventListener("change", () => onChange(select.value)); return select;
    }
    function settingCheck(container, key, label) {
        const input = el("input"); input.type = "checkbox"; input.checked = state.opts[key];
        input.addEventListener("change", () => { state.opts[key] = input.checked; saveOptions(); schedule(); }); container.append(field(label, input));
    }
    function clearReferences() { state.pins.clear(); saveReferences(); schedule(); log("Manual references cleared"); }
    function setReference(model) {
        if (!model.group || (!model.uid && model.group !== "Temporary")) { state.notice = "An exact item UID is needed before using this item as reference."; schedule(); return; }
        state.pins.set(model.group, { id: model.id, uid: model.uid }); saveReferences(); log("Reference chosen", { group: model.group, itemId: model.id, uid: model.uid || "stack" }); schedule(); closeModal();
    }
    async function refresh(force = false) {
        if (!state.key) { openSettings(); return; }
        if (state.hydrating) { state.notice = "A refresh is already running."; schedule(); return; }
        if (Date.now() < state.blockedUntil) { state.notice = "API cooldown ends at " + new Date(state.blockedUntil).toLocaleTimeString(); schedule(); return; }
        state.blocked = ""; state.notice = ""; state.failures.clear(); state.equipmentFailedAt = 0; state.equipmentWanted = true;
        const uids = new Set([...currentModels(), ...references(currentModels()).values()].map(m => m.uid));
        for (const uid of uids) { const d = state.details.get(uid); if (d) d.at = 0; }
        if (force) { state.catalogs.clear(); state.catalogAttempts.clear(); state.inventories.clear(); }
        log("Manual refresh", { referenceData: force }); schedule();
    }
    async function setKey(key, feedback) {
        if (!/^[A-Za-z0-9]{16}$/.test(key)) { feedback.textContent = "Enter a valid 16-character Torn API key."; return; }
        state.epoch++; state.requestAbort.abort(); state.requestAbort = new AbortController();
        state.key = key; state.blocked = ""; state.blockedUntil = 0; state.notice = "";
        state.equipment = []; state.equipmentAt = 0; state.equipmentFailedAt = 0; state.equipmentWanted = true;
        state.inventories.clear(); state.details.clear(); state.pins.clear(); saveReferences(); state.failures.clear(); state.catalogAttempts.clear();
        await state.writes; await removeStore("cache");
        const saved = await writeStore("api-key", key);
        feedback.textContent = saved ? "Key saved. Loading stats; you can close settings." : "Key active for this page. Persistent storage is unavailable.";
        log("API key updated", { stored: saved }); schedule();
    }
    function openSettings() {
        const panel = modal("Inventory Compare · " + VERSION);
        panel.append(el("p", "Compare inventory, item market, bazaar and overseas shop gear by weapon category or armor slot. Market arrows and filters use a chosen inventory reference when available, otherwise equipped gear. Bazaars and overseas shops use equipped gear.", P + "muted"));
        const credentials = el("div", null, P + "stack"); credentials.append(el("h3", "Torn API key"));
        const key = el("input"); key.type = "password"; key.maxLength = 16; key.autocomplete = "off"; key.spellcheck = false; key.setAttribute("aria-label", "16-character Torn API key");
        key.placeholder = state.key ? "Key saved. Enter a new key to replace it." : "16-character minimal-access key";
        const feedback = el("p", "", P + "muted"); feedback.setAttribute("aria-live", "polite");
        const keyActions = el("div", null, P + "actions");
        keyActions.append(button("Save key", async function () { const value = key.value.trim(); key.value = ""; await setKey(value, feedback); }),
            button("Forget key", async () => {
                state.epoch++; state.requestAbort.abort(); state.requestAbort = new AbortController(); state.key = "";
                state.equipment = []; state.details.clear(); state.inventories.clear(); state.pins.clear(); saveReferences(); state.blocked = "";
                await state.writes; await removeStore("api-key"); await removeStore("cache"); feedback.textContent = "Key and private cached data removed."; log("Key removed"); schedule();
            }), link("Create a minimal-access key", "https://www.torn.com/preferences.php#tab=api"));
        credentials.append(key, keyActions, feedback, el("small", state.fallbackStorage ? "This WebView uses session storage. Your key may need entering again after closing the session." : "The key is stored through the userscript manager and sent only to api.torn.com. It is never included in copied logs.")); panel.append(credentials);
        const settings = el("div", null, P + "stack"); settings.append(el("h3", "Display and reference"));
        settingCheck(settings, "enabled", "Enable comparisons"); settingCheck(settings, "showValues", "Show actual numeric ratings");
        settingCheck(settings, "showDeltas", "Show numeric differences"); settingCheck(settings, "showRoF", "Show firearm rate of fire"); settingCheck(settings, "showEffects", "Show weapon effect icons");
        settings.append(field("Comparison placement", optionSelect([["inline", "Inline beside item name"], ["below", "Below each item (previous layout)"]], state.opts.layout, v => {
            state.opts.layout = v; saveOptions(); schedule();
        })));
        settings.append(field("Reference behavior", optionSelect([["equipped", "Equipped item, with optional chosen override"], ["selected", "Last tapped inventory item"]], state.opts.referenceMode, v => { state.opts.referenceMode = v; clearReferences(); saveOptions(); })),
            field("Coverage area", optionSelect([["slot", "Slot area: head / chest / hand / leg / foot"], ...AREAS.map(a => [a, a])], state.opts.coverageArea, v => { state.opts.coverageArea = v; saveOptions(); schedule(); })));
        for (const [key, label, min, max] of [["fontSize", "Stat text size (px)", 9, 15], ["arrowSize", "Arrow size (px)", 12, 30], ["effectSize", "Effect icon size (px)", 14, 32]]) {
            const size = el("input"); size.type = "number"; size.min = String(min); size.max = String(max); size.value = state.opts[key]; size.style.maxWidth = "72px";
            size.addEventListener("change", () => { state.opts[key] = Math.max(min, Math.min(max, number(size.value) || DEFAULTS[key])); size.value = state.opts[key]; saveOptions(); applyTheme(); schedule(); });
            settings.append(field(label, size));
        }
        for (const [k, label] of [["upColor", "↑ Higher value color"], ["downColor", "↓ Lower value color"]]) {
            const input = el("input"); input.type = "color"; input.value = state.opts[k];
            input.addEventListener("change", () => { state.opts[k] = input.value; saveOptions(); applyTheme(); schedule(); }); settings.append(field(label, input));
        }
        const refreshActions = el("div", null, P + "actions"); refreshActions.append(button("Refresh visible stats", () => { void refresh(); }), button("Refresh reference data", () => { void refresh(true); }), button("Use equipped references", () => { state.opts.referenceMode = "equipped"; saveOptions(); clearReferences(); openSettings(); }));
        settings.append(refreshActions); panel.append(settings);
        const filters = el("div", null, P + "stack"); filters.append(el("h3", "Hide items below equipped gear"));
        settingCheck(filters, "hideLowerDamage", "Hide lower damage");
        settingCheck(filters, "hideLowerAccuracy", "Hide lower accuracy");
        settingCheck(filters, "hideLowerArmor", "Hide lower armor rating");
        settingCheck(filters, "hideLowerCoverage", "Hide lower armor coverage");
        filters.append(el("p", "An item is hidden when any checked stat is confirmed lower than its reference. Inventory, bazaar and overseas filters use equipped gear. Market filters use a saved chosen inventory reference when present. Equal, unknown and overlapping shop ranges remain visible. Armor compares within its slot; coverage uses the selected body area. Market cards close up after filtering. In a single category or item view, supported native stat sliders also follow the reference minimum; mixed armor slots and coverage without a native slider use local filtering. Unchecking restores the previous native minimum unless you changed it yourself.", P + "muted"),
            tempEffectButton(), el("small", "Turn ON to keep temporary debuffs, burning effects and self buffs visible through the filters. Damage-only explosives and decorative items continue to follow your filters. This override is saved separately and starts OFF."), button("Reset filters", resetFilters));
        panel.append(filters);
        panel.append(el("p", "D = intrinsic damage rating, not predicted HP damage. A = accuracy. AR = armor. C(area) = coverage of that body area. ↑ higher, ↓ lower, = equal, ? unavailable. RoF is the unmodified rounds-per-turn range, not attack speed; ↕ means mixed bounds. Player perks, ammo, weapon mods and combat circumstances can change outcomes.", P + "callout"));
        panel.append(el("p", "Inventory API lists can be an hour old. Individual copies are matched only by UID. Missing UIDs are never assigned by name or row order. Chosen inventory references are saved across pages; Use equipped references clears them. Overseas shop ranges are labeled because the purchased copy's exact roll is usually unknown. ↕ indicates a range overlapping the reference. No roll is estimated from catalog base stats.", P + "muted"));
        panel.append(el("p", "Inventory comparisons sit beside the item name and wrap within its name area when needed. Choose the previous layout to put them below each inventory row. Market and bazaar comparisons stay within each listing. Arrow and effect icon sizes can be adjusted independently.", P + "muted"));
        panel.append(el("h3", "Weapon effect icons"));
        panel.append(el("p", "🔥 Burn · ⚡ Shock · ☠️ Poisoned · 🩸 Bleed / Laceration · ❄️ Freeze · 😵‍💫 Stun. Icons identify effects a weapon can apply; they do not mean an effect is guaranteed to trigger. Tap the comparison to see its effect labels and reported bonuses.", P + "muted"));
        panel.append(el("h3", "Temporary effect legend"));
        panel.append(el("p", "🌶️ pepper spray · 😵‍💫 concussion · ⚡ flash · 😶‍🌫️ smoke · 😭 tear gas · ☣️ nerve gas · 🔥 burning · 🪢 ensnare · 💥 explosive damage · 🫥 Stygian Darkness · 💪 / 🏃 / 🛡️ / 🎯 self buffs · 🎉 decorative. Tap stats for the catalog effect description.", P + "muted"));
        panel.append(el("h3", "Diagnostics")); const debug = el("div", null, P + "actions");
        debug.append(button("🪲", () => { closeModal(); MyDebug.toggleView(); }), button("📋 Copy Logs to Clipboard", function () {
            log("Diagnostic summary", { version: VERSION, rows: state.scanned, loaded: state.loaded, rootFound: Boolean(state.root), blocked: Boolean(state.blocked) });
            log("Layout diagnostics", layoutSnapshot()); void MyDebug.copy(this);
        })); panel.append(debug);
        panel.append(el("h3", "Support ThaWookie")); const supportHost = el("div"); supportHost.id = P + "support-host"; panel.append(supportHost);
        state.support = createEmbeddedSupportModule(supportHost);
        panel.append(link("Greasy Fork: ShavedW00kie", "https://greasyfork.org/en/users/1597765-shavedw00kie"));
    }
    function tableRow(table, values, heading = false) {
        const row = el("tr"); for (const value of values) row.append(el(heading ? "th" : "td", value)); table.append(row);
    }
    function openDetails(model, ref) {
        const item = catalogEntry(model.id); const actual = statsFor(model); const base = ref && statsFor(ref);
        const panel = modal(model.name);
        panel.append(el("p", (model.uid ? "UID " + model.uid : model.abroad ? "Overseas shop item · individual roll unknown" : "No unique UID exposed in this row") + " · " + (model.group || "unknown slot"), P + "muted"));
        panel.append(el("p", ref ? "Compared with " + ref.name + (ref.uid ? " [" + ref.uid + "]" : "") + " · " + ref.referenceSource : model.shopping ? "No equipped reference is available in this category or armor slot." : "No reference is available in this slot. Choose an inventory item below.", P + "callout"));
        const t = el("table", null, P + "table"); tableRow(t, ["Rating", "This item", "Reference", "Change"], true);
        for (const [key, name] of model.group === "Temporary" ? [["damage", "Damage rating"]] : item && item.type === "Armor" ? [["armor", "Armor rating"]] : [["damage", "Damage rating"], ["accuracy", "Accuracy"]]) {
            const a = actual && actual[key], b = base && base[key]; const c = compare(a, b); tableRow(t, [name, ratingText(a), ratingText(b), c.symbol + (c.delta !== undefined ? " " + (c.delta > 0 ? "+" : "") + fmt(c.delta) : "")]);
        }
        const rate = rof(item); const baseRate = ref && rof(catalogEntry(ref.id));
        if (rate) tableRow(t, ["RoF (rounds / turn)", rate.min + "-" + rate.max, baseRate ? baseRate.min + "-" + baseRate.max : "?", compareRoF(rate, baseRate).symbol]);
        panel.append(t);
        if (actual) panel.append(el("small", "Source: " + actual.source + (actual.at ? " · fetched " + new Date(actual.at).toLocaleString() : "") + (actual.stale ? " · cached, refresh pending" : "")));
        else panel.append(el("p", model.uid ? "Individual stats are pending or unavailable. Check API status in settings and Refresh." : model.abroad ? "No verified shop range is available for this item. Its future individual roll is unknown. Known catalog coverage and effects can still be compared." : "Torn must expose this copy's UID before rolled stats can be shown. Expanding its native information can expose the UID. Copies are never guessed by their names or order.", P + "muted"));
        if (actual?.shopRange) panel.append(el("p", "This is the shop item's possible ordinary stat range. The exact roll is determined when a copy is generated. ↑ means every value is higher than your equipped item; ↓ means every value is lower; ↕ means the range overlaps it. Coverage and temporary damage are fixed catalog values. Unknown ranges stay unavailable.", P + "callout"));
        if (model.group === "Temporary") {
            const e = effect(item); panel.append(el("p", e.symbol + " " + e.label, P + "callout")); panel.append(el("p", e.text));
            panel.append(el("p", "Displayed damage is the fixed item rating. It does not predict HP lost or compare the tactical value of buffs and debuffs.", P + "muted"));
        } else {
            const effects = weaponEffects(item, actual);
            if (effects.length) panel.append(el("h3", "Weapon effects"));
            for (const value of effects) panel.append(el("p", value.symbol + " " + value.label + ": " + value.text, P + "callout"), el("small", value.source));
        }
        if (item && item.type === "Armor") {
            panel.append(el("h3", "Coverage by body area")); const ct = el("table", null, P + "table"); tableRow(ct, ["Area", "This item", "Reference", "Change"], true);
            for (const area of AREAS) {
                const a = coverage(item, area), b = ref ? coverage(catalogEntry(ref.id), area) : null;
                if (a === null && b === null) continue;
                tableRow(ct, [area, a === null ? "?" : fmt(a) + "%", b === null ? "?" : fmt(b) + "%", compare(a, b).symbol]);
            }
            panel.append(ct, el("p", "These are individual body-area percentages. They are not added together. Full Body is shown only when Torn explicitly supplies that aggregate.", P + "muted"));
            panel.append(field("Armor slot override", optionSelect([["auto", "Automatic"], ...Object.keys(SLOT_AREA).map(s => [s, s])], state.opts.armorSlots[model.id] || "auto", v => {
                if (v === "auto") delete state.opts.armorSlots[model.id]; else state.opts.armorSlots[model.id] = v;
                saveOptions(); clearReferences(); closeModal(); schedule();
            })));
        }
        if (actual && actual.bonuses && actual.bonuses.length) {
            panel.append(el("h3", "Reported bonuses"));
            for (const bonus of actual.bonuses) panel.append(el("p", clean(bonus.title || bonus.name) + (number(bonus.value) !== null ? ": " + bonus.value : "") + (bonus.description ? " · " + clean(bonus.description) : ""), P + "muted"));
        }
        const actions = el("div", null, P + "actions");
        const choose = button("Compare against this item", () => setReference(model)); choose.disabled = !model.group || (!model.uid && model.group !== "Temporary");
        if (!model.shopping) actions.append(choose, button("Use equipped references", () => { state.opts.referenceMode = "equipped"; saveOptions(); clearReferences(); closeModal(); }));
        actions.append(button("Settings", openSettings)); panel.append(actions);
    }

    function nativeClick(event) {
        if (state.mode !== "inventory") return;
        if (owned(event.target) || !(event.target instanceof Element) || !state.root || !state.root.contains(event.target)) return;
        const row = inventoryRow(event.target);
        if (row && state.opts.referenceMode === "selected" && !event.target.closest('a,button,input,select,label,[role="button"],.option,.option-wrap')) {
            const model = readRow(row); if (model && model.group && (model.uid || model.group === "Temporary")) { state.pins.set(model.group, { id: model.id, uid: model.uid }); saveReferences(); schedule(); }
        }
        const action = event.target.closest('.option-equip,.option-unequip,[data-action="equip"],[data-action="unequip"]');
        if (action) { state.equipmentWanted = true; state.equipmentFailedAt = 0; state.pins.clear(); saveReferences(); schedule(); }
    }
    async function boot() {
        if (!document.documentElement) await new Promise(resolve => {
            const observer = new MutationObserver(() => { if (document.documentElement) { observer.disconnect(); resolve(); } });
            observer.observe(document, { childList: true });
        });
        if (!marker.isConnected) (document.head || document.documentElement).appendChild(marker);
        const [opts, key, cached, pins] = await Promise.all([readStore("options", {}), readStore("api-key", ""), readStore("cache", null), readStore("references", [])]);
        state.opts = sanitizeOptions(opts); state.key = typeof key === "string" && /^[A-Za-z0-9]{16}$/.test(key) ? key : "";
        state.pins = savedReferences(pins);
        if (cached && cached.schema === 1) {
            for (const pair of Array.isArray(cached.catalogs) ? cached.catalogs : []) if (Array.isArray(pair) && pair[1] && Array.isArray(pair[1].items)) state.catalogs.set(pair[0], pair[1]);
            for (const pair of Array.isArray(cached.details) ? cached.details : []) if (Array.isArray(pair) && pair[1] && uidOf(pair[1].uid)) state.details.set(pair[0], pair[1]);
            for (const pair of Array.isArray(cached.inventories) ? cached.inventories : []) if (Array.isArray(pair) && pair[1] && Array.isArray(pair[1].items)) state.inventories.set(pair[0], pair[1]);
        }
        styles();
        document.addEventListener("click", nativeClick, true);
        const sliderInput = event => {
            if (state.syncingSliders || state.mode !== "market" || !(event.target instanceof HTMLInputElement) || event.target.type !== "range" || owned(event.target)) return;
            const entry = state.sliderStates.get(event.target);
            if (entry) { entry.before = Number(event.target.value); entry.applied = null; entry.failed = false; }
            schedule();
        };
        document.addEventListener("input", sliderInput, true);
        document.addEventListener("change", sliderInput, true);
        state.discovery = new MutationObserver(records => {
            if (!state.root || !state.root.isConnected || !state.toolbar || !state.toolbar.isConnected) { schedule(); return; }
            const roots = Object.values(ROOTS).join(",");
            if (records.some(m => !owned(m.target) && [...m.addedNodes, ...m.removedNodes].some(n => n.nodeType === 1 && !owned(n) && (n.matches(roots) || n.querySelector(roots))))) schedule();
        });
        state.discovery.observe(document.documentElement, { childList: true, subtree: true });
        window.addEventListener("pageshow", schedule);
        window.addEventListener("resize", schedule, { passive: true });
        window.addEventListener("hashchange", schedule);
        window.addEventListener("focus", () => { if (Date.now() - state.equipmentAt > 120000) state.equipmentWanted = true; void reloadReferences(); schedule(); });
        document.addEventListener("visibilitychange", () => { if (!document.hidden) { if (Date.now() - state.equipmentAt > 120000) state.equipmentWanted = true; void reloadReferences(); schedule(); } });
        try {
            const register = typeof GM_registerMenuCommand === "function" ? GM_registerMenuCommand : typeof GM !== "undefined" && GM.registerMenuCommand ? GM.registerMenuCommand.bind(GM) : null;
            if (register) register("Inventory Compare settings", openSettings);
        } catch (_) { log("Userscript menu unavailable", {}, "DEBUG"); }
        log("Started", { version: VERSION, surface: state.mode, cachedItems: state.details.size, keyPresent: Boolean(state.key), listingObserver: state.observedFetch }); schedule();
    }

    // Supplied SupportModule and debugger are bundled below, inside this IIFE.

/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

/*
 * Donation UI Module
 * Version 1.4
 *
 * Reusable support/donation UI for Torn.com userscripts.
 *
 * Features:
 *   - Animated Buy Me a Coffee button
 *   - Animated coffee cup with squash-and-stretch movement
 *   - Animated steam
 *   - Animated coffee fill
 *   - Hover-to-fill coffee effect
 *   - Periodic diagonal button gleam
 *   - Animated liquid-style label transition
 *   - Torn Xanax-tip button
 *   - MutationObserver persistence against Torn/React DOM changes
 *   - TornPDA/mobile-compatible DOM implementation
 *   - Reduced-motion accessibility support
 *
 * License: BSD-3-Clause
 *
 * Copyright (c) 2026 ShavedW00kie
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */


    function createEmbeddedSupportModule(host) {
    const DEFAULT_CONFIG = Object.freeze({
        bmcId: "bittick1c",
        tornUserId: "2954173",

        containerId: "thawookie-support-module",
        styleId: "thawookie-support-module-style"
    });

    /*
     * Unique counter used for SVG clipPath IDs.
     *
     * SVG IDs are document-global. If multiple instances of this
     * module are ever created, sharing a clipPath ID can cause one
     * SVG to reference another SVG's clipping path.
     */
    let coffeeInstanceCount = 0;

    /* ============================================================
     * SUPPORT MODULE
     * ============================================================ */

    class SupportModule {
        constructor(config = {}) {
            this.config = {
                ...DEFAULT_CONFIG,
                ...config
            };

            this.observer = null;
            this.observerAttached = false;
            this.isInjecting = false;
            this.destroyed = false;

            this.init();
        }

        /* ========================================================
         * INITIALIZATION
         * ======================================================== */

        init() {
            if (this.destroyed) {
                return;
            }

            if (!this.getBody()) {
                if (document.readyState === "loading") {
                    document.addEventListener(
                        "DOMContentLoaded",
                        () => this.init(),
                        { once: true }
                    );
                }

                return;
            }

            this.injectStyles();
            this.injectUI();
            this.attachObserver();
        }

        /* ========================================================
         * DOM HELPERS
         * ======================================================== */

        getBody() {
            return host && host.isConnected ? host : null;
        }

        getContainer() {
            return document.getElementById(
                this.config.containerId
            );
        }

        isContainerConnected() {
            const container = this.getContainer();

            return Boolean(
                container &&
                container.isConnected
            );
        }

        /* ========================================================
         * STYLE INJECTION
         * ======================================================== */

        injectStyles() {
            if (this.destroyed) {
                return;
            }

            if (document.getElementById(this.config.styleId)) {
                return;
            }

            const styles = `
                /* =================================================
                 * DONATION CONTAINER
                 * ================================================= */

                #${this.config.containerId} {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    z-index: 2147483640;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    font-family: Arial, sans-serif;
                    box-sizing: border-box;
                    touch-action: manipulation;
                }

                /* =================================================
                 * GENERIC SUPPORT BUTTON
                 * ================================================= */

                #${this.config.containerId} .tw-support-btn {
                    box-sizing: border-box;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 40px;
                    padding: 10px 15px;
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: bold;
                    line-height: 1.2;
                    text-align: center;
                    text-decoration: none !important;
                    cursor: pointer;
                    user-select: none;
                    -webkit-tap-highlight-color: transparent;
                    touch-action: manipulation;
                }

                #${this.config.containerId} .tw-support-btn:focus-visible {
                    outline: 2px solid #ffffff;
                    outline-offset: 2px;
                }

                /* =================================================
                 * BUY ME A COFFEE BUTTON
                 *
                 * Visual design ported from the supplied animated
                 * coffee-button implementation:
                 *
                 *   #FFDD00 yellow
                 *   black foreground
                 *   6px radius
                 *   6px 12px compact padding
                 *   11px / 600 typography
                 *   animated glare
                 *   animated cup
                 * ================================================= */

                #${this.config.containerId} .tw-bmc {
                    position: relative;
                    overflow: hidden;
                    isolation: isolate;

                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;

                    width: 100%;
                    min-width: 170px;
                    min-height: 40px;

                    padding: 6px 12px;

                    background: #FFDD00;
                    color: #000000 !important;

                    border: 1px solid #FFDD00;
                    border-radius: 6px;

                    font-size: 11px;
                    font-weight: 600;
                    line-height: 1.2;

                    text-decoration: none !important;

                    box-sizing: border-box;

                    transition:
                        opacity 0.15s ease,
                        transform 0.15s ease;
                }

                /*
                 * Keep all actual button contents above the
                 * animated specular highlight.
                 */
                #${this.config.containerId} .tw-bmc > * {
                    position: relative;
                    z-index: 1;
                }

                /*
                 * Subtle interaction feedback.
                 *
                 * Hover is deliberately opacity-based rather than
                 * relying on desktop-only behavior for functionality.
                 * The button remains fully usable through touch.
                 */
                #${this.config.containerId} .tw-bmc:hover {
                    opacity: 0.9;
                }

                #${this.config.containerId} .tw-bmc:active {
                    transform: scale(0.97);
                }

                /* =================================================
                 * COFFEE CUP - SQUASH & STRETCH
                 * ================================================= */

                @keyframes tw-coffee-cup-hop {
                    0% {
                        transform:
                            translateY(0)
                            scale(1, 1);
                    }

                    18% {
                        transform:
                            translateY(0.5px)
                            scale(1.08, 0.9);
                    }

                    32% {
                        transform:
                            translateY(-2px)
                            scale(0.94, 1.08);
                    }

                    50% {
                        transform:
                            translateY(-3px)
                            scale(1, 1);
                    }

                    68% {
                        transform:
                            translateY(0)
                            scale(1.1, 0.88);
                    }

                    84% {
                        transform:
                            translateY(0)
                            scale(0.97, 1.03);
                    }

                    100% {
                        transform:
                            translateY(0)
                            scale(1, 1);
                    }
                }

                #${this.config.containerId} .tw-coffee-cup {
                    position: relative;
                    display: inline-flex;
                    flex-shrink: 0;

                    transform-origin: 50% 100%;

                    animation:
                        tw-coffee-cup-hop
                        2.4s
                        cubic-bezier(0.4, 0, 0.5, 1)
                        infinite;
                }

                /*
                 * Cup outline remains above the steam.
                 */
                #${this.config.containerId} .tw-coffee-cup > svg {
                    position: relative;
                    z-index: 1;
                    display: block;
                }

                /* =================================================
                 * STEAM
                 * ================================================= */

                #${this.config.containerId} .tw-coffee-cup::before,
                #${this.config.containerId} .tw-coffee-cup::after {
                    content: "";

                    position: absolute;

                    bottom: 74%;

                    width: 2px;
                    height: 4px;

                    border-radius: 999px;

                    background:
                        linear-gradient(
                            to top,
                            rgba(90, 58, 36, 0.5),
                            rgba(90, 58, 36, 0)
                        );

                    opacity: 0;

                    pointer-events: none;

                    will-change:
                        transform,
                        opacity;
                }

                #${this.config.containerId} .tw-coffee-cup::before {
                    left: 27%;

                    animation:
                        tw-coffee-steam
                        2.8s
                        ease-out
                        infinite;
                }

                #${this.config.containerId} .tw-coffee-cup::after {
                    left: 45%;

                    animation:
                        tw-coffee-steam
                        2.8s
                        ease-out
                        infinite;

                    animation-delay: -1.4s;
                }

                @keyframes tw-coffee-steam {
                    0% {
                        opacity: 0;

                        transform:
                            translateY(2px)
                            scale(0.6, 0.5)
                            skewX(0deg);
                    }

                    30% {
                        opacity: 0.7;

                        transform:
                            translateY(0)
                            scale(1, 0.9)
                            skewX(4deg);
                    }

                    65% {
                        opacity: 0.4;

                        transform:
                            translateY(-3px)
                            scale(0.85, 1.2)
                            skewX(-5deg);
                    }

                    100% {
                        opacity: 0;

                        transform:
                            translateY(-5px)
                            scale(0.5, 1.5)
                            skewX(6deg);
                    }
                }

                /* =================================================
                 * COFFEE FILL
                 * ================================================= */

                #${this.config.containerId} .tw-coffee-fill {
                    transform: scaleY(0.15);
                    transform-origin: 50% 100%;

                    animation:
                        tw-coffee-refill
                        7s
                        cubic-bezier(0.45, 0, 0.55, 1)
                        infinite;
                }

                @keyframes tw-coffee-refill {
                    0% {
                        transform: scaleY(0.15);
                    }

                    30% {
                        transform: scaleY(0.95);
                    }

                    55% {
                        transform: scaleY(0.75);
                    }

                    80% {
                        transform: scaleY(0.3);
                    }

                    100% {
                        transform: scaleY(0.15);
                    }
                }

                /*
                 * Hover overrides the normal coffee cycle and fills
                 * the cup completely.
                 */
                #${this.config.containerId}
                .tw-bmc:hover
                .tw-coffee-fill {
                    animation:
                        tw-coffee-fill-to-full
                        0.45s
                        cubic-bezier(0.4, 0, 0.2, 1)
                        forwards;
                }

                @keyframes tw-coffee-fill-to-full {
                    to {
                        transform: scaleY(1);
                    }
                }

                /* =================================================
                 * SPECULAR GLEAM
                 * ================================================= */

                /*
                 * A soft diagonal highlight sweeps across the
                 * yellow button every five seconds.
                 */
                #${this.config.containerId} .tw-bmc::after {
                    content: "";

                    position: absolute;

                    top: 0;
                    bottom: 0;
                    left: -60%;

                    width: 45%;

                    pointer-events: none;

                    background:
                        linear-gradient(
                            100deg,
                            transparent 0%,
                            rgba(255, 255, 255, 0.15) 35%,
                            rgba(255, 255, 255, 0.75) 50%,
                            rgba(255, 255, 255, 0.15) 65%,
                            transparent 100%
                        );

                    transform: skewX(-18deg);

                    will-change: transform;

                    animation:
                        tw-coffee-glare
                        5s
                        cubic-bezier(0.5, 0, 0.5, 1)
                        infinite;
                }

                @keyframes tw-coffee-glare {
                    0% {
                        transform:
                            translateX(0)
                            skewX(-18deg);
                    }

                    22%,
                    100% {
                        transform:
                            translateX(400%)
                            skewX(-18deg);
                    }
                }

                /* =================================================
                 * LIQUID LABEL TRANSITION
                 * ================================================= */

                #${this.config.containerId} .tw-coffee-label {
                    display: grid;
                    align-items: center;
                    justify-items: center;

                    min-width: 0;
                }

                #${this.config.containerId} .tw-coffee-label > span {
                    grid-area: 1 / 1;

                    white-space: nowrap;

                    transform-origin: 50% 50%;

                    will-change:
                        opacity,
                        transform,
                        filter;

                    animation:
                        tw-coffee-label-drip
                        7s
                        cubic-bezier(0.65, 0, 0.35, 1)
                        infinite;
                }

                /*
                 * The second label is exactly 50% out of phase,
                 * creating the alternating liquid transition.
                 */
                #${this.config.containerId}
                .tw-coffee-label
                > span:nth-child(2) {
                    animation-delay: -3.5s;
                }

                @keyframes tw-coffee-label-drip {
                    0%,
                    34% {
                        opacity: 1;

                        transform:
                            translateY(0)
                            scale(1, 1);

                        filter: blur(0);
                    }

                    38% {
                        opacity: 0.5;

                        transform:
                            translateY(2px)
                            scale(0.94, 1.08);

                        filter: blur(1.2px);
                    }

                    42% {
                        opacity: 0;

                        transform:
                            translateY(9px)
                            scale(1.06, 0.5);

                        filter: blur(4px);
                    }

                    42.01%,
                    92% {
                        opacity: 0;

                        transform:
                            translateY(-9px)
                            scale(1.06, 0.5);

                        filter: blur(4px);
                    }

                    96% {
                        opacity: 1;

                        transform:
                            translateY(1px)
                            scale(1.05, 0.9);

                        filter: blur(0);
                    }

                    98% {
                        opacity: 1;

                        transform:
                            translateY(0)
                            scale(0.99, 1.03);

                        filter: blur(0);
                    }

                    100% {
                        opacity: 1;

                        transform:
                            translateY(0)
                            scale(1, 1);

                        filter: blur(0);
                    }
                }

                /* =================================================
                 * TORN TIP BUTTON
                 * ================================================= */

                #${this.config.containerId} .tw-torn-tip {
                    background-color: #8ab63d;
                    color: #ffffff !important;

                    border: 1px solid #6a8c2f;

                    box-shadow:
                        0 4px 6px rgba(0, 0, 0, 0.3);

                    transition:
                        transform 0.2s ease,
                        background-color 0.2s ease;
                }

                #${this.config.containerId} .tw-torn-tip:active {
                    transform: scale(0.95);
                }

                /* =================================================
                 * REDUCED MOTION
                 * ================================================= */

                @media (prefers-reduced-motion: reduce) {
                    #${this.config.containerId}
                    .tw-coffee-cup {
                        animation: none;
                    }

                    #${this.config.containerId}
                    .tw-coffee-cup::before,
                    #${this.config.containerId}
                    .tw-coffee-cup::after {
                        animation: none;
                        opacity: 0;
                    }

                    #${this.config.containerId}
                    .tw-coffee-fill {
                        animation: none;
                        transform: scaleY(0.8);
                    }

                    #${this.config.containerId}
                    .tw-coffee-label > span {
                        animation: none;
                        opacity: 0;
                        filter: none;
                        transform: none;
                    }

                    #${this.config.containerId}
                    .tw-coffee-label
                    > span:nth-child(2) {
                        opacity: 1;
                    }

                    #${this.config.containerId}
                    .tw-bmc::after {
                        animation: none;
                        opacity: 0;
                    }
                }

                /* =================================================
                 * MOBILE / TORN PDA
                 * ================================================= */

                @media (max-width: 480px) {
                    #${this.config.containerId} {
                        right: 10px;
                        bottom: 10px;
                        left: 10px;

                        width: auto;
                    }

                    #${this.config.containerId}
                    .tw-support-btn {
                        width: 100%;
                    }

                    #${this.config.containerId}
                    .tw-bmc {
                        min-width: 0;
                    }
                }
            `;

            /*
             * Preferred Tampermonkey path.
             *
             * Some restricted WebViews can expose GM_addStyle but
             * still throw when it is called. Fall back safely.
             */
            this.injectStyleElement(styles);
        }

        injectStyleElement(styles) {
            if (document.getElementById(this.config.styleId)) {
                return;
            }

            const styleNode =
                document.createElement("style");

            styleNode.id =
                this.config.styleId;

            styleNode.type =
                "text/css";

            styleNode.textContent =
                styles;

            if (document.head) {
                document.head.appendChild(styleNode);
                return;
            }

            const body = this.getBody();

            if (body) {
                body.appendChild(styleNode);
            }
        }

        /* ========================================================
         * COFFEE BUTTON
         * ======================================================== */

        buildCoffeeButton() {
            coffeeInstanceCount += 1;

            const clipId =
                `${this.config.containerId}-coffee-clip-${coffeeInstanceCount}`;

            const bmcLink =
                document.createElement("a");

            bmcLink.className =
                "tw-support-btn tw-bmc";

            bmcLink.href =
                `https://www.buymeacoffee.com/${encodeURIComponent(
                    this.config.bmcId
                )}`;

            bmcLink.target = "_blank";

            bmcLink.rel =
                "noopener noreferrer";

            bmcLink.title =
                "Support ThaWookie";

            bmcLink.setAttribute(
                "aria-label",
                "Buy me a coffee - support ThaWookie"
            );

            /*
             * ----------------------------------------------------
             * Animated coffee cup
             * ----------------------------------------------------
             */

            const cup =
                document.createElement("span");

            cup.className =
                "tw-coffee-cup";

            cup.setAttribute(
                "aria-hidden",
                "true"
            );

            const svg =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "svg"
                );

            svg.setAttribute(
                "width",
                "16"
            );

            svg.setAttribute(
                "height",
                "16"
            );

            svg.setAttribute(
                "viewBox",
                "0 0 24 24"
            );

            svg.setAttribute(
                "fill",
                "none"
            );

            svg.setAttribute(
                "stroke",
                "currentColor"
            );

            svg.setAttribute(
                "stroke-width",
                "1.5"
            );

            svg.setAttribute(
                "aria-hidden",
                "true"
            );

            /*
             * SVG clip path.
             *
             * This is intentionally generated through DOM APIs
             * rather than innerHTML so the only dynamic value,
             * clipId, cannot become an HTML injection vector.
             */

            const defs =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "defs"
                );

            const clipPath =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "clipPath"
                );

            clipPath.setAttribute(
                "id",
                clipId
            );

            const clipShape =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "path"
                );

            clipShape.setAttribute(
                "d",
                "M5 8h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8z"
            );

            clipPath.appendChild(
                clipShape
            );

            defs.appendChild(
                clipPath
            );

            svg.appendChild(
                defs
            );

            /*
             * Coffee liquid.
             *
             * The CSS transform animation controls its visible
             * fill level.
             */
            const coffeeFill =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "rect"
                );

            coffeeFill.setAttribute(
                "class",
                "tw-coffee-fill"
            );

            coffeeFill.setAttribute(
                "x",
                "5"
            );

            coffeeFill.setAttribute(
                "y",
                "8"
            );

            coffeeFill.setAttribute(
                "width",
                "11"
            );

            coffeeFill.setAttribute(
                "height",
                "9"
            );

            coffeeFill.setAttribute(
                "fill",
                "#6f4e37"
            );

            coffeeFill.setAttribute(
                "stroke",
                "none"
            );

            coffeeFill.setAttribute(
                "clip-path",
                `url(#${clipId})`
            );

            svg.appendChild(
                coffeeFill
            );

            /*
             * Cup body outline.
             */
            const cupBody =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "path"
                );

            cupBody.setAttribute(
                "stroke-linecap",
                "round"
            );

            cupBody.setAttribute(
                "stroke-linejoin",
                "round"
            );

            cupBody.setAttribute(
                "d",
                "M5 8h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8z"
            );

            svg.appendChild(
                cupBody
            );

            /*
             * Cup handle.
             */
            const cupHandle =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "path"
                );

            cupHandle.setAttribute(
                "stroke-linecap",
                "round"
            );

            cupHandle.setAttribute(
                "stroke-linejoin",
                "round"
            );

            cupHandle.setAttribute(
                "d",
                "M16 9h2.5a2.5 2.5 0 0 1 0 5H16"
            );

            svg.appendChild(
                cupHandle
            );

            cup.appendChild(
                svg
            );

            bmcLink.appendChild(
                cup
            );

            /*
             * ----------------------------------------------------
             * Animated label
             * ----------------------------------------------------
             */

            const label =
                document.createElement("span");

            label.className =
                "tw-coffee-label";

            label.setAttribute(
                "aria-hidden",
                "true"
            );

            const supportLabel =
                document.createElement("span");

            supportLabel.textContent =
                "Support the project?";

            const coffeeLabel =
                document.createElement("span");

            coffeeLabel.textContent =
                "Buy me a coffee";

            label.appendChild(
                supportLabel
            );

            label.appendChild(
                coffeeLabel
            );

            bmcLink.appendChild(
                label
            );

            return bmcLink;
        }

        /* ========================================================
         * UI INJECTION
         * ======================================================== */

        injectUI() {
            if (
                this.destroyed ||
                this.isInjecting
            ) {
                return;
            }

            const body =
                this.getBody();

            if (!body) {
                return;
            }

            if (this.isContainerConnected()) {
                return;
            }

            this.isInjecting = true;

            try {
                /*
                 * Remove stale disconnected node, if present.
                 */
                const existingContainer =
                    this.getContainer();

                if (existingContainer) {
                    existingContainer.remove();
                }

                const container =
                    document.createElement("div");

                container.id =
                    this.config.containerId;

                container.setAttribute(
                    "role",
                    "complementary"
                );

                container.setAttribute(
                    "aria-label",
                    "Support ThaWookie"
                );

                /*
                 * Animated Buy Me a Coffee button.
                 */
                const bmcLink =
                    this.buildCoffeeButton();

                /*
                 * ------------------------------------------------
                 * Torn Xanax Tip
                 * ------------------------------------------------
                 */

                const tipLink =
                    document.createElement("a");

                tipLink.href =
                    "https://www.torn.com/item.php";

                tipLink.target =
                    "_blank";

                tipLink.rel =
                    "noopener noreferrer";

                tipLink.className =
                    "tw-support-btn tw-torn-tip";

                tipLink.title =
                    `Opens Items - search "Xanax", ` +
                    `tap Send, enter ThaWookie ` +
                    `[${this.config.tornUserId}]`;

                tipLink.setAttribute(
                    "aria-label",
                    `Send a Xanax tip to ThaWookie ` +
                    `[${this.config.tornUserId}]`
                );

                tipLink.textContent =
                    "💊 Send a Xanax Tip";

                /*
                 * Assemble donation controls.
                 */
                container.appendChild(
                    bmcLink
                );

                container.appendChild(
                    tipLink
                );

                /*
                 * Append directly to body so React does not own
                 * the donation UI's DOM subtree.
                 */
                body.appendChild(
                    container
                );
            } finally {
                this.isInjecting = false;
            }
        }

        /* ========================================================
         * MUTATION OBSERVER
         * ======================================================== */

        attachObserver() {
            if (
                this.destroyed ||
                this.observerAttached ||
                typeof MutationObserver === "undefined"
            ) {
                return;
            }

            const body =
                this.getBody();

            if (!body) {
                return;
            }

            this.observer =
                new MutationObserver(
                    (mutationList) => {
                        if (
                            this.destroyed ||
                            this.isInjecting
                        ) {
                            return;
                        }

                        let relevantMutation =
                            false;

                        for (
                            const mutation
                            of mutationList
                        ) {
                            if (
                                mutation.type !==
                                "childList"
                            ) {
                                continue;
                            }

                            if (
                                mutation.removedNodes
                                    .length > 0
                            ) {
                                relevantMutation =
                                    true;

                                break;
                            }
                        }

                        if (
                            !relevantMutation
                        ) {
                            return;
                        }

                        if (
                            !this.isContainerConnected()
                        ) {
                            this.injectStyles();
                            this.injectUI();
                        }
                    }
                );

            this.observer.observe(
                body,
                {
                    childList: true,
                    subtree: true
                }
            );

            this.observerAttached = true;
        }

        /* ========================================================
         * CLEANUP
         * ======================================================== */

        destroy() {
            this.destroyed = true;

            if (this.observer) {
                try {
                    this.observer.disconnect();
                } catch (_) {
                    /*
                     * Nothing further required.
                     */
                }
            }

            this.observer = null;
            this.observerAttached = false;

            const container =
                this.getContainer();

            if (container) {
                container.remove();
            }
        }
    }


        return new SupportModule({ containerId: P + "support", styleId: P + "support-style" });
    }

// BEGIN SUPPLIED DEBUGGER MODULE v1.0.4
/**
 * File: userscript-debugger-module.js
 * Version: 1.0.4
 * Advanced Modular Userscript Debugger with optional DOM Inspector
 * Author: ShavedW00kie (Torn: ThaWookie [2954173] )
 * Namespace: https://github.com/ShavedW00kie/
 * Target: Embedded inside a Torn.com userscript IIFE (desktop and TornPDA).
 * License: BSD-3-Clause
 *
 * Copyright (c) 2026 ShavedW00kie
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software
 *    without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 *
 * Integration inside the host userscript's IIFE, AFTER this function definition:
 *   const MyDebug = initializeModularDebugger(GM_info.script.name);
 *   MyDebug.log("Ready");
 *   bugButton.addEventListener("click", () => MyDebug.toggleView());
 *   copyButton.addEventListener("click", function () { void MyDebug.copy(this); });
 *   // Optional: MyDebug.inspect(), MyDebug.inspectElement(element),
 *   // MyDebug.watchElement(element), MyDebug.stopInspection(), MyDebug.destroy().
 *
 * This file is a source module, not an independently installable userscript.
 * The host userscript supplies its own ==UserScript== metadata and IIFE.
 */
function initializeModularDebugger(scriptNamespace) {
    "use strict";
    if (scriptNamespace === undefined) scriptNamespace = "App";

    const randomId = (() => {
        try {
            if (typeof crypto !== "undefined" && crypto.randomUUID) {
                return crypto.randomUUID().replace(/-/g, "");
            }
        } catch (_) { /* WebView fallback. */ }
        return Math.random().toString(36).slice(2) + Date.now().toString(36);
    })();
    const id = `tw-debug-${randomId}`;
    const LIMITS = Object.freeze({
        buffer: (10 * 1024 * 1024) - (900 * 1024),
        entry: 64 * 1024,
        renderEntries: 180,
        renderChars: 128 * 1024,
        report: 15000,
        html: 6000,
        parents: 6,
        children: 12,
        nodes: 65,
        mutations: 40
    });
    const state = {
        logs: [], head: 0, length: 0, destroyed: false, 
        frames: new Set(), statuses: new Map(), resizeObserver: null,
        root: null, logArea: null, inspector: null, inspectorText: null,
        style: null, statusBar: null, highlight: null,
        panelMode: "logs", selected: null, picking: false,
        watching: false, changeLog: [],
        observer: null, parentObserver: null, uiObserver: null,
        observedBody: null, renderPending: false,
        pendingMutations: 0, mutationLogPending: false,
        viewportListeners: false, highlightPending: false
    };
    const SENSITIVE = /(?:^key$|api[_-]?key|apikey|token|auth|authorization|cookie|secret|passwd|password|csrf|session|bearer|credential|client[_-]?secret|refresh[_-]?token|access[_-]?token)/i;
    const SAFE_ATTRIBUTES = new Set([
        "id", "class", "role", "type", "aria-expanded",
        "aria-hidden", "data-testid", "data-test", "data-role", "data-state"
    ]);

    /* ---------- Redacted, bounded logging ---------- */
    function redact(value) {
        return String(value)
            .replace(/\b(?:Authorization|Proxy-Authorization)\s*:\s*[^\r\n]+/gi, "Authorization: [REDACTED]")
            .replace(/\b[A-Za-z0-9]{16}\b/g, "[POSSIBLE KEY REDACTED]")
            // Bearer tokens and known secret-bearing URL parameters.
            .replace(/(\bBearer\s+)[A-Za-z0-9._~+/-]+/gi, "$1[REDACTED]")
            .replace(/([?&](?:key|api_key|token|access_token|refresh_token|secret|session|csrf)=)[^&#\s\"'<>}\]]+/gi, "$1[REDACTED]")
            // Quoted property values, including embedded spaces.
            .replace(/(["']?(?:api[_-]?key|apikey|token|authorization|cookie|password|passwd|secret|csrf|session|access[_-]?token|refresh[_-]?token)["']?\s*[:=]\s*)(["'])([^"']*)\2/gi,
                (_, prefix, quote) => `${prefix}${quote}[REDACTED]${quote}`)
            // Unquoted key=value patterns.
            .replace(/(["']?(?:api[_-]?key|apikey|token|authorization|cookie|password|passwd|secret|csrf|session|access[_-]?token|refresh[_-]?token)["']?\s*[:=]\s*)(?!["'])([^\s"',;}&\]]+)/gi,
                (_, prefix) => `${prefix}[REDACTED]`);
    }

    // Does not call getters or toJSON. Proxies can still execute traps; never
    // deliberately pass hostile proxies to an in-process diagnostic function.
    function safeSerialize(value) {
        let remaining = 240;
        const path = new WeakSet();
        function visit(item, depth) {
            if (--remaining < 0) return "[Traversal limit]";
            if (typeof item === "string") return redact(item.slice(0, 8192));
            if (item === null || typeof item === "boolean" || typeof item === "number") return item;
            if (typeof item === "undefined") return "[undefined]";
            if (typeof item === "bigint" || typeof item === "symbol") return String(item);
            if (typeof item === "function") return "[Function]";
            if (path.has(item)) return "[Circular]";
            if (depth >= 5) return "[Depth limit]";
            path.add(item);
            try {
                const result = Object.create(null);
                let count = 0;
                if (item instanceof Error) {
                    for (const key of ["name", "message", "stack"]) {
                        const descriptor = Object.getOwnPropertyDescriptor(item, key);
                        result[key] = descriptor && "value" in descriptor
                            ? visit(descriptor.value, depth + 1) : "[Unavailable/accessor]";
                    }
                }
                // for-in permits early exit without allocating Object.keys for
                // every property. Reflection itself is not a hard time limit.
                for (const key in item) {
                    if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
                    if (++count > 40 || remaining <= 0) { result["[Truncated]"] = true; break; }
                    const descriptor = Object.getOwnPropertyDescriptor(item, key);
                    result[redact(key.slice(0, 160))] = SENSITIVE.test(key) ? "[REDACTED]"
                        : descriptor && "value" in descriptor ? visit(descriptor.value, depth + 1) : "[Accessor omitted]";
                }
                return result;
            } catch (_) { return "[Unserializable]"; }
            finally { path.delete(item); }
        }
        try {
            if (typeof value === "string") return redact(value.slice(0, LIMITS.entry));
            return JSON.stringify(visit(value, 0));
        } catch (_) { return "[Unserializable]"; }
    }
    function scheduleFrame(callback) {
        if (state.destroyed) return;
        if (typeof requestAnimationFrame !== "function") { callback(); return; }
        const handle = requestAnimationFrame(() => {
            state.frames.delete(handle);
            if (!state.destroyed) callback();
        });
        state.frames.add(handle);
    }
    function trim(text, max) {
        text = String(text);
        return text.length > max ? `${text.slice(0, Math.max(0, max - 17))}[TRUNCATED]` : text;
    }
    function log(message, level = "INFO") {
        if (state.destroyed) return;
        const label = typeof level === "string" && /^(INFO|WARN|ERROR|DEBUG)$/i.test(level) ? level.toUpperCase() : "INFO";
        const timestamp = new Date().toISOString();
        const entry = trim(`[${timestamp}] [${label}] ${safeSerialize(message)}`, LIMITS.entry);
        const size = entry.length + 1;
        while (state.head < state.logs.length && state.length + size > LIMITS.buffer) {
            state.length -= state.logs[state.head].length + 1;
            state.logs[state.head++] = null; // Release pruned strings immediately.
        }
        if (state.head > 2048) { state.logs = state.logs.slice(state.head); state.head = 0; }
        state.logs.push(entry);
        state.length += size;
        queueRender();
    }
    const info = message => log(message, "INFO");
    const warn = message => log(message, "WARN");
    const error = message => log(message, "ERROR");
    function clear() {
        state.logs.length = 0;
        state.head = 0;
        state.length = 0;
        renderLogs();
    }
    function queueRender() {
        if (!state.logArea || !state.root || state.root.hidden || state.panelMode !== "logs") return;
        if (state.renderPending) return;
        state.renderPending = true;
        scheduleFrame(() => { state.renderPending = false; renderLogs(); });
    }
    function renderLogs() {
        if (state.destroyed || !state.root || state.root.hidden || !state.logArea || !state.logArea.isConnected || state.panelMode !== "logs") return;
        const subset = [];
        let chars = 0;
        for (let i = state.logs.length - 1; i >= state.head && subset.length < LIMITS.renderEntries; i--) {
            if (chars + state.logs[i].length + 1 > LIMITS.renderChars) break;
            subset.unshift(state.logs[i]); chars += state.logs[i].length + 1;
        }
        const skipped = state.logs.length - state.head - subset.length;
        state.logArea.textContent = (skipped ? `[${skipped} earlier entries retained for copying]\n` : "") + subset.join("\n");
        state.logArea.scrollTop = state.logArea.scrollHeight;
    }

    /* ---------- Clipboard (Tampermonkey, TornPDA, browser) ---------- */
    function copyFallback(text) {
        if (!document.body) return false;
        const input = document.createElement("textarea");
        const previousFocus = document.activeElement;
        const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
        const ranges = [];
        if (selection) for (let i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i).cloneRange());
        let caret = null;
        try { if (previousFocus && typeof previousFocus.selectionStart === "number") caret = [previousFocus.selectionStart, previousFocus.selectionEnd, previousFocus.selectionDirection]; } catch (_) {}
        input.value = text;
        input.readOnly = true;
        input.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;z-index:-1";
        try {
            document.body.appendChild(input);
            input.focus();
            input.select();
            input.setSelectionRange(0, text.length);
            return Boolean(document.execCommand("copy"));
        } catch (_) { return false; }
        finally {
            input.remove();
            try { if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
                if (caret) previousFocus.setSelectionRange(...caret);
                if (selection) { selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range)); } } catch (_) { /* Non-focusable element. */ }
        }
    }
    async function writeClipboard(text) {
        try {
            if (typeof GM_setClipboard === "function") {
                await Promise.resolve(GM_setClipboard(text, "text"));
                return true;
            }
            if (typeof GM !== "undefined" && typeof GM.setClipboard === "function") {
                await GM.setClipboard(text, "text");
                return true;
            }
        } catch (_) { /* Try browser APIs. */ }
        if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
            try { await navigator.clipboard.writeText(text); return true; }
            catch (_) { /* Restricted WebView. */ }
        }
        return copyFallback(text);
    }
    function showCopyResult(button, result) {
        if (state.destroyed || !button || !button.isConnected) return;
        let saved = state.statuses.get(button);
        if (saved) clearTimeout(saved.timer);
        else saved = { nodes: Array.from(button.childNodes), timer: null };
        button.textContent = result;
        // This timer is only UI feedback, never element discovery or polling.
        saved.timer = setTimeout(() => {
            button.replaceChildren(...saved.nodes);
            state.statuses.delete(button);
        }, 1300);
        state.statuses.set(button, saved);
    }
    async function copy(button = null) {
        if (state.destroyed) return false;
        const text = state.logs.slice(state.head).join("\n");
        if (!text) { showCopyResult(button, "Empty"); return false; }
        const success = await writeClipboard(text);
        showCopyResult(button, success ? "Copied!" : "Failed");
        if (!success) warn("Clipboard unavailable. Open debugger to select and copy manually.");
        return success;
    }

    /* ---------- Safe DOM descriptions ---------- */
    function isElement(node) { return Boolean(node && node.nodeType === 1 && node.tagName); }
    function tag(node) { return isElement(node) ? node.tagName.toLowerCase() : "(none)"; }
    function describe(node) {
        if (!isElement(node)) return "(none)";
        let text = tag(node);
        const nodeId = node.getAttribute("id");
        if (nodeId && !SENSITIVE.test(nodeId)) text += `#${trim(redact(nodeId), 50)}`;
        const classes = Array.from(node.classList || []).filter(name => !SENSITIVE.test(name)).slice(0, 3);
        if (classes.length) text += "." + classes.map(name => trim(redact(name), 48)).join(".");
        return trim(text, 180);
    }
    function selectorSegment(node) {
        if (!isElement(node)) return "";
        const nodeId = node.getAttribute("id");
        if (nodeId && /^[A-Za-z_][\w-]{0,60}$/.test(nodeId) && !SENSITIVE.test(nodeId)) {
            return `#${nodeId}`;
        }
        let part = tag(node);
        const classNames = Array.from(node.classList || [])
            .filter(name => /^[A-Za-z_][\w-]{0,45}$/.test(name) && !SENSITIVE.test(name))
            .slice(0, 2);
        part += classNames.map(name => `.${name}`).join("");
        if (node.parentElement) {
            const same = Array.from(node.parentElement.children).filter(sibling => sibling.tagName === node.tagName);
            if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
        }
        return part;
    }
    function makeSelector(element) {
        const segments = [];
        let current = element;
        for (let step = 0; step < LIMITS.parents && isElement(current); step++) {
            const segment = selectorSegment(current);
            segments.unshift(segment);
            if (segment.startsWith("#")) break;
            current = current.parentElement;
        }
        const selector = segments.join(" > ");
        if (selector.length > 500) return "(selector exceeds safe length)";
        if (redact(selector) !== selector) return "(selector omitted: possible credential)";
        return selector;
    }
    function safeAttributeText(element) {
        const result = [];
        if (!isElement(element)) return "";
        for (const attr of Array.from(element.attributes || [])) {
            if (!SAFE_ATTRIBUTES.has(attr.name) || SENSITIVE.test(attr.name)) continue;
            if (SENSITIVE.test(attr.value)) continue;
            result.push(`${attr.name}="${escapeHTML(trim(redact(attr.value), 90))}"`);
            if (result.length >= 8) break;
        }
        return result.length ? ` ${result.join(" ")}` : "";
    }
    function escapeHTML(value) {
        return String(value).replace(/[&<>"']/g, character => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[character]);
    }
    function structuralHTML(element) {
        let budget = LIMITS.nodes;
        const skip = /^(script|style|noscript|template|iframe|object|embed)$/i;
        function recurse(node, depth) {
            if (!isElement(node) || budget-- <= 0) return "";
            const name = tag(node);
            const open = `<${name}${safeAttributeText(node)}>`;
            if (skip.test(name)) return `${open}[contents omitted]</${name}>`;
            if (depth >= 2) return `${open}[descendants omitted]</${name}>`;
            const kids = Array.from(node.children).slice(0, LIMITS.children);
            const nested = kids.map(child => recurse(child, depth + 1)).join("\n");
            const note = node.children.length > LIMITS.children ? "\n[additional children omitted]" : "";
            return `${open}${nested ? `\n${nested}${note}\n` : "[text omitted]"}</${name}>`;
        }
        return trim(recurse(element, 0), LIMITS.html);
    }
    function reactRootHint(element) {
        let node = element;
        for (let i = 0; i < LIMITS.parents && isElement(node); i++, node = node.parentElement) {
            const candidateId = node.getAttribute("id") || "";
            if (/^(?:react-root|root|__next)$/i.test(candidateId) || node.hasAttribute("data-reactroot")) {
                return `${describe(node)} (heuristic only)`;
            }
        }
        return "Not detected (does not rule out React)";
    }
    function getInspectionReport() {
        const element = state.selected;
        if (!isElement(element)) return "No element selected.";
        const ancestors = [];
        let ancestor = element.parentElement;
        for (let i = 0; i < LIMITS.parents && isElement(ancestor); i++, ancestor = ancestor.parentElement) {
            ancestors.push(`  ${i + 1}. ${describe(ancestor)}`);
        }
        const children = Array.from(element.children).slice(0, LIMITS.children)
            .map((child, index) => `  ${index + 1}. ${describe(child)}`);
        const page = typeof location !== "undefined"
            ? (location.origin === "null" ? "(local document)" : `${location.origin}${location.pathname}`)
            : "(unknown)";
        return trim(redact([
            `DOM INSPECTION | ${redact(String(scriptNamespace))}`,
            `Time: ${new Date().toISOString()}`,
            `Page (query omitted): ${redact(page)}`,
            `Selected: ${describe(element)}`,
            `Connected: ${element.isConnected}`,
            `Selector (best effort): ${makeSelector(element)}`,
            `React container hint: ${reactRootHint(element)}`,
            `Parent chain:\n${ancestors.join("\n") || "  (none)"}`,
            `Immediate children (${element.children.length}):\n${children.join("\n") || "  (none)"}`,
            `Sibling context: previous=${describe(element.previousElementSibling)}, next=${describe(element.nextElementSibling)}`,
            `Structural preview (text nodes, form values, URLs and scripts omitted; review attributes before sharing):\n${structuralHTML(element)}`,
            `Recent observed mutations (${state.changeLog.length}):\n${state.changeLog.join("\n") || "  (none)"}`
        ].join("\n\n")), LIMITS.report);
    }

    /* ---------- On-demand DOM selection and mutation watch ---------- */
    function isOurUI(node) {
        return Boolean(isElement(node) && (
            (state.root && state.root.contains(node)) ||
            (state.highlight && state.highlight.contains(node))
        ));
    }
    function ensureHighlight() {
        if (state.destroyed || !state.selected || !state.root || state.root.hidden || state.panelMode !== "inspect") return null;
        if (state.highlight && state.highlight.isConnected) return state.highlight;
        if (!document.body) return null;
        const node = document.createElement("div");
        node.setAttribute("aria-hidden", "true");
        node.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #00dbff;box-shadow:0 0 0 1px #001e28;box-sizing:border-box;display:none";
        document.body.appendChild(node);
        state.highlight = node;
        return node;
    }
    function updateHighlight() {
        const marker = ensureHighlight();
        if (!marker) return;
        const node = state.selected;
        if (!isElement(node) || !node.isConnected || !state.root || state.root.hidden || state.panelMode !== "inspect") {
            marker.style.display = "none";
            return;
        }
        const rect = node.getBoundingClientRect();
        marker.style.display = "block";
        marker.style.top = `${rect.top}px`;
        marker.style.left = `${rect.left}px`;
        marker.style.width = `${rect.width}px`;
        marker.style.height = `${rect.height}px`;
    }
    function onViewportChanged() {
        if (state.destroyed || !state.selected || state.highlightPending || state.panelMode !== "inspect") return;
        state.highlightPending = true;
        scheduleFrame(() => {
            state.highlightPending = false;
            updateHighlight();
        });
    }
    function setViewportListeners(enable) {
        if (typeof window === "undefined" || enable === state.viewportListeners) return;
        state.viewportListeners = enable;
        const method = enable ? "addEventListener" : "removeEventListener";
        window[method]("scroll", onViewportChanged, true);
        window[method]("resize", onViewportChanged);
    }
    function removeHighlight() {
        if (state.highlight) { state.highlight.remove(); state.highlight = null; }
    }
    function updateInspector() {
        if (!state.inspectorText) return;
        state.inspectorText.textContent = state.selected ? trim([
            `Selected: ${describe(state.selected)}`,
            `Parent: ${describe(state.selected.parentElement)}`,
            `Children: ${state.selected.children.length}`,
            `Selector: ${makeSelector(state.selected)}`,
            `Connected: ${state.selected.isConnected}`,
            `Watch: ${state.watching ? "ON" : "OFF"} | Changes: ${state.changeLog.length}`
        ].join("\n"), 1100) : "Tap Pick, then tap a Torn page element.\nNo page data is collected until inspection is used.";
        if (state.statusBar) state.statusBar.textContent = state.picking ? "PICK MODE: tap a page element or press Esc" : "Inspector idle";
        updateHighlight();
    }
    function suppressPickAction(event) {
        if (isOurUI(event.target)) return;
        event.stopImmediatePropagation();
        // Preserve the browser synthetic click needed for tap selection.
    }
    function onPickClick(event) {
        if (isOurUI(event.target)) return;
        // Capture before Torn/React click handlers so selecting a link does not navigate.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (isElement(event.target)) inspectElement(event.target);
        stopPicker();
    }
    function onPickKey(event) {
        if (event.key === "Escape") {
            event.preventDefault();
            stopPicker();
            updateInspector();
        }
    }
    function startPicker() {
        if (state.destroyed || !state.root || !state.root.isConnected || state.root.hidden || state.picking) return;
        state.picking = true;
        document.addEventListener("click", onPickClick, true);
        ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "mouseup"].forEach(type => document.addEventListener(type, suppressPickAction, { capture: true, passive: false }));
        document.addEventListener("keydown", onPickKey, true);
        updateInspector();
    }
    function stopPicker() {
        if (!state.picking) return;
        state.picking = false;
        document.removeEventListener("click", onPickClick, true);
        ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "mouseup"].forEach(type => document.removeEventListener(type, suppressPickAction, true));
        document.removeEventListener("keydown", onPickKey, true);
        updateInspector();
    }
    function stopWatch() {
        if (state.observer) state.observer.disconnect();
        if (state.parentObserver) state.parentObserver.disconnect();
        state.observer = null;
        state.parentObserver = null;
        state.watching = false;
        state.pendingMutations = 0;
        updateInspector();
    }
    function handleMutations(mutations) {
        if (!state.watching) return;
        const stamp = new Date().toISOString();
        let changed = 0;
        for (const mutation of mutations) {
            if (changed >= 8) break;
            const detail = mutation.type === "characterData" ? "text node changed (content omitted)" : mutation.type === "attributes"
                ? `attribute ${mutation.attributeName} on ${describe(mutation.target)}`
                : `childList (+${mutation.addedNodes.length}/-${mutation.removedNodes.length}) on ${describe(mutation.target)}`;
            state.changeLog.push(`[${stamp}] ${detail}`);
            changed++;
        }
        while (state.changeLog.length > LIMITS.mutations) state.changeLog.shift();
        if (changed) {
            state.pendingMutations += changed;
            if (!state.mutationLogPending) {
                state.mutationLogPending = true;
                scheduleFrame(() => {
                    state.mutationLogPending = false;
                    const count = state.pendingMutations;
                    state.pendingMutations = 0;
                    if (count && state.watching) log(`DOM watch: ${count} sampled change(s) near ${describe(state.selected)}`, "DEBUG");
                });
            }
        }
        if (state.selected && !state.selected.isConnected) {
            warn(`DOM watch: selected element detached: ${describe(state.selected)}`);
            stopWatch();
        }
        updateInspector();
    }
    function watchElement(element = state.selected) {
        if (state.destroyed || !isElement(element) || !element.isConnected || element === document.documentElement || element === document.body) {
            warn("DOM watch requires a specific element, not the document root/body.");
            return false;
        }
        if (typeof MutationObserver === "undefined") {
            warn("MutationObserver is unavailable in this WebView.");
            return false;
        }
        stopWatch();
        if (element !== state.selected && !inspectElement(element)) return false;
        state.changeLog.length = 0;
        // Observe the chosen subtree and direct child lists along its ancestor chain.
        state.observer = new MutationObserver(handleMutations);
        state.observer.observe(element, {
            attributes: true, childList: true, characterData: true, subtree: true,
            attributeFilter: ["class", "id", "role", "aria-expanded", "hidden", "disabled", "data-state"]
        });
        if (element.parentElement) {
            state.parentObserver = new MutationObserver(handleMutations);
            let ancestor = element.parentElement;
            while (ancestor) {
                state.parentObserver.observe(ancestor, { childList: true });
                ancestor = ancestor.parentNode;
            }
        }
        state.watching = true;
        info(`DOM watch enabled: ${describe(element)}`);
        updateInspector();
        return true;
    }
    function moveSelection(direction) {
        const selected = state.selected;
        if (!isElement(selected)) return;
        const next = direction === "parent" ? selected.parentElement : selected.firstElementChild;
        if (next && next !== document.body && next !== document.documentElement) inspectElement(next);
    }
    function inspectElement(element) {
        if (state.destroyed || !isElement(element) || isOurUI(element) || !ensureUI()) return false;
        if (state.watching && state.selected !== element) stopWatch();
        state.selected = element;
        if (state.resizeObserver) state.resizeObserver.disconnect();
        if (typeof ResizeObserver === "function") {
            state.resizeObserver = new ResizeObserver(onViewportChanged);
            state.resizeObserver.observe(element);
        }
        state.changeLog.length = 0;
        showPanel("inspect");
        updateInspector();
        info(`DOM selected: ${describe(element)} | ${makeSelector(element)}`);
        return true;
    }
    function inspect() {
        if (!showPanel("inspect")) return false;
        startPicker();
        return true;
    }
    function stopInspection() {
        stopPicker();
        stopWatch();
        state.selected = null;
        if (state.resizeObserver) state.resizeObserver.disconnect();
        state.resizeObserver = null;
        state.changeLog.length = 0;
        removeHighlight();
        setViewportListeners(false);
        if (state.root && !state.root.hidden) showPanel("logs");
    }
    async function copyInspection(button = null) {
        if (state.destroyed) return false;
        if (!state.selected) { showCopyResult(button, "No selection"); return false; }
        const result = await writeClipboard(getInspectionReport());
        showCopyResult(button, result ? "Copied!" : "Failed");
        return result;
    }

    /* ---------- Compact UI, created on first use ---------- */
    function createButton(text, label, handler) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.title = label;
        button.setAttribute("aria-label", label);
        button.className = `${id}-btn`;
        button.addEventListener("click", handler);
        return button;
    }
    function ensureStyles() {
        if (state.destroyed) return;
        if (state.style && state.style.isConnected) return;
        if (!document.head && !document.body) return;
        const style = document.createElement("style");
        style.id = `${id}-styles`;
        style.textContent = `
          @keyframes ${id}-reset {from{opacity:.7}to{opacity:1}}
          .${id}-flash{animation:${id}-reset 1.3s ease 1}
          #${id}{position:fixed;right:12px;bottom:12px;width:min(430px,calc(100vw - 24px));
            height:320px;max-height:70vh;display:flex;flex-direction:column;gap:8px;padding:10px;
            background:#191919;color:#e2ffe7;border:1px solid #46db85;border-radius:8px;
            box-shadow:0 6px 25px #0009;box-sizing:border-box;font:12px/1.45 monospace;
            z-index:2147483647;touch-action:manipulation}
          #${id}[hidden],#${id} [hidden]{display:none!important}
          #${id} button{font:11px/1.2 sans-serif;min-height:30px;cursor:pointer}
          #${id} .${id}-btn{border:1px solid #616161;border-radius:4px;background:#292929;
            color:#fff;padding:6px;touch-action:manipulation}
          #${id} .${id}-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
          #${id} .${id}-title{font-weight:bold;flex:1 1 120px;min-width:0;overflow:hidden;text-overflow:ellipsis}
          #${id} .${id}-body{flex:1;min-height:0;overflow:auto;white-space:pre-wrap;
            overflow-wrap:anywhere;user-select:text}
          #${id} .${id}-actions{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:5px}
          #${id} .${id}-status{font-size:11px;color:#ace3fc}
          #${id} button:focus-visible{outline:2px solid #91dfff;outline-offset:2px}
          @media(max-width:480px){#${id}{right:8px;bottom:8px;width:calc(100vw - 16px);
            height:290px;font-size:11px}}
          @media(prefers-reduced-motion:reduce){.${id}-flash{animation:none}}
        `;
        (document.head || document.body).appendChild(style);
        state.style = style;
    }
    function ensureUI() {
        if (state.destroyed) return false;
        if (state.root && state.root.isConnected) { ensureStyles(); return true; }
        if (!document.body) return false;
        ensureStyles();
        const root = document.createElement("section");
        root.id = id;
        root.hidden = true;
        root.setAttribute("aria-label", `Debug console: ${String(scriptNamespace)}`);
        const toolbar = document.createElement("div");
        toolbar.className = `${id}-toolbar`;
        const title = document.createElement("span");
        title.className = `${id}-title`;
        title.textContent = `🪲 ${String(scriptNamespace)}`;
        toolbar.append(title,
            createButton("Copy", "Copy logs", function () { void copy(this); }),
            createButton("Clear", "Clear logs", clear),
            createButton("🔍", "Inspect Torn DOM element", inspect),
            createButton("Hide", "Hide debugger", () => toggleView()));
        const logArea = document.createElement("pre");
        logArea.className = `${id}-body`;
        logArea.style.margin = "0";
        const inspector = document.createElement("div");
        inspector.className = `${id}-body`;
        inspector.hidden = true;
        const actions = document.createElement("div");
        actions.className = `${id}-actions`;
        actions.append(
            createButton("Pick", "Pick element by tapping it", startPicker),
            createButton("↑ Parent", "Inspect parent element", () => moveSelection("parent")),
            createButton("↓ Child", "Inspect first child element", () => moveSelection("child")),
            createButton("Watch", "Watch selected element for DOM mutations", () => { watchElement(); }),
            createButton("Stop watch", "Disconnect mutation observers", stopWatch),
            createButton("Copy DOM", "Copy sanitized DOM report", function () { void copyInspection(this); }),
            createButton("Exit", "Close inspector", stopInspection));
        const status = document.createElement("div");
        status.className = `${id}-status`;
        const details = document.createElement("pre");
        details.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0;font:inherit";
        inspector.append(actions, status, details);
        root.append(toolbar, logArea, inspector);
        document.body.appendChild(root);
        Object.assign(state, { root, logArea, inspector, inspectorText: details, statusBar: status });
        attachUIObserver();
        return true;
    }
    function attachUIObserver() {
        if (typeof MutationObserver === "undefined" || !document.body) return;
        if (state.uiObserver) state.uiObserver.disconnect();
        // Only direct children of body, not the constantly changing React subtree.
        state.uiObserver = new MutationObserver(() => {
            if (state.root && (!state.root.isConnected || state.observedBody !== document.body)) {
                stopPicker();
                stopWatch();
                removeHighlight();
                setViewportListeners(false);
                if (state.root) state.root.remove();
                if (state.resizeObserver) state.resizeObserver.disconnect();
                state.resizeObserver = null;
                state.selected = null;
                state.root = state.logArea = state.inspector = state.inspectorText = state.statusBar = null;
                state.uiObserver.disconnect();
            }
        });
        state.uiObserver.observe(document.body, { childList: true });
        if (document.documentElement) state.uiObserver.observe(document.documentElement, { childList: true });
        state.observedBody = document.body;
    }
    function showPanel(panel) {
        if (!ensureUI()) return false;
        state.root.hidden = false;
        state.panelMode = panel;
        setViewportListeners(panel === "inspect");
        state.logArea.hidden = panel !== "logs";
        state.inspector.hidden = panel !== "inspect";
        if (panel === "logs") renderLogs();
        else updateInspector();
        return true;
    }
    function toggleView() {
        if (!ensureUI()) return false;
        if (!state.root.hidden) {
            // A hidden debugger must not keep an active DOM picker or watch.
            stopInspection();
            state.root.hidden = true;
            return false;
        }
        showPanel("logs");
        return true;
    }

    function destroy() {
        if (state.destroyed) return;
        state.destroyed = true;
        stopInspection();
        if (state.uiObserver) state.uiObserver.disconnect();
        if (state.resizeObserver) state.resizeObserver.disconnect();
        for (const handle of state.frames) {
            if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
        }
        state.frames.clear();
        for (const [button, saved] of state.statuses) {
            clearTimeout(saved.timer);
            button.replaceChildren(...saved.nodes);
        }
        state.statuses.clear();
        if (state.root) state.root.remove();
        if (state.style) state.style.remove();
        removeHighlight();
        state.root = state.logArea = state.inspector = state.inspectorText = state.statusBar = state.style = null;
        clear();
    }

    return Object.freeze({
        log, info, warn, error, copy, clear, toggleView,
        inspect, inspectElement, watchElement, stopInspection,
        getInspectionReport, copyInspection, destroy
    });
}

// END SUPPLIED DEBUGGER MODULE

    installListingObserver();
    void boot().catch(error => MyDebug.log({ event: "Startup failed", message: error.message }, "ERROR"));
})(typeof GM_info !== "undefined" && GM_info && GM_info.script ? GM_info : { script: { name: "Torn-Inventory-Compare", version: "1.2.1" } });

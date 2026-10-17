# Torn Inventory Compare

**Version 1.0.2** · Tampermonkey and TornPDA · BSD-3-Clause  
By **ShavedW00kie (Torn: ThaWookie [2954173])**

Compare inventory equipment against the equipped or chosen item in the same category or armor slot, using individual item stats rather than estimated quality rolls.

## Install in Tampermonkey

1. Open `Torn-Inventory-Compare.user.js.txt` in a text editor and copy its entire contents, including the metadata at the top. The `.txt` file is an identical download-friendly copy of the `.user.js` file.
2. Open Tampermonkey, choose **Create a new script**, select all the starter text and replace it with the copied script.
3. Save the script and make sure it is enabled.
4. Open or reload [Torn's Items page](https://www.torn.com/item.php).
5. The first-run settings panel opens automatically. Enter your **16-character minimal-access Torn API key**, then choose **Save key**. A Full-access key is unnecessary.
6. Close settings. The script loads the reference catalogs, equipped items and individual stats. Allow approximately 10 to 20 seconds for the first small inventory; larger inventories take longer because requests are paced.

Alternatively, import the `.user.js` file through Tampermonkey's dashboard. The ZIP contains both script formats and this guide.

## Install in TornPDA

1. Open TornPDA's userscript manager and add a new custom script.
2. Paste the entire contents of `Torn-Inventory-Compare.user.js.txt`, including its metadata. Enable the script.
3. Use `https://www.torn.com/item.php*` as its URL match if TornPDA asks for one. Use execution after page load when a timing option is offered.
4. Reload the Items page. Save your minimal-access key in the script's own settings.

The script supports legacy and modern GM APIs, TornPDA's documented `PDA_httpGet` bridge, and standard browser fetch as a final network fallback. Where userscript-manager storage is unavailable, settings and the key use session storage and may need entering again after the session closes.

## What appears in inventory

| Label | Meaning |
| --- | --- |
| `D` | This individual weapon's intrinsic damage rating |
| `A` | This individual weapon's accuracy rating |
| `AR` | This individual armor piece's armor rating |
| `C(Hd)` | Head coverage percentage |
| `C(Ch)` | Chest coverage percentage |
| `C(Ha)` | Hand coverage percentage |
| `C(Le)` | Leg coverage percentage |
| `C(Ft)` | Foot coverage percentage |
| `RoF` | The firearm's unmodified rounds-per-turn range, in smaller text |
| Green `↑` | Higher than the reference item's corresponding value |
| Light blue `↓` | Lower than the reference item's corresponding value |
| `=` | Equal at the displayed precision |
| `?` | The value or comparison is unavailable |
| `↕` beside RoF | One range bound is higher and the other lower |
| `◎` | This row is the reference item |

Higher and lower describe the numeric rating. They are not an overall recommendation about the weapon or armor.

Damage is Torn's weapon damage rating, not a prediction of HP damage. Rate of fire is rounds used per turn, not faster combat turns. Melee weapons have no firearm RoF. Ammunition, weapon mods, bonuses, education, player stats and enemy equipment can change combat outcomes.

## Choose the comparison reference

By default, each weapon category compares against its equipped item. Armor compares within its slot: head, body, hands, legs or feet. A recognized full-body suit has its own group.

- The script reads Torn's explicit equipped markers and uses the equipment API as a fallback.
- Tap a row's compact stats to open its full comparison. Choose **Compare against this item** to preview that item as the reference without equipping it.
- **Use equipped references** clears chosen overrides.
- In settings, **Last tapped inventory item** lets taps on ordinary row content choose the reference. Native action buttons and links retain their normal behavior. The explicit **Compare against this item** button also works in this mode.
- Chosen references last for the current page session and are kept separately for each category or armor slot.

## Actual stats and duplicate copies

Damage, accuracy and armor ratings come from Torn API v2 `itemdetails` or `equipment`, matched by the item's unique **UID** and catalog ID. Two Bo Staffs can have different rolls and therefore different arrows.

The script never assigns a rolled stat by item name, catalog base value, list position or the order of an API response. Ambiguous `data-id` values are accepted only when the inventory API verifies that value as the UID of the matching item type.

If Torn does not expose a copy's UID, the row shows **UID needed**. Expanding the item's native information can expose it; use **Refresh visible stats** afterward. If it stays unavailable, the debugger's DOM inspector can identify the current markup. A question mark is deliberately preferable to an incorrect comparison.

Stackable temporary weapons use their fixed catalog damage rating. This is identified as **Fixed temporary rating** in the detail panel. Non-damaging utility items can correctly show `D 0`.

## Armor coverage

Coverage comes from the catalog and is reported by body area. The default compact comparison uses the slot's principal area: head, chest, hand, leg or foot. The label always identifies the area. You can choose a different area in settings.

Tap an armor row for all reported coverage areas and their individual arrows. Percentages from different body areas are never added together. **Full Body** is shown numerically only when Torn explicitly supplies that aggregate; otherwise it is unavailable. This avoids inventing a total coverage percentage.

New armor with an unrecognized slot is excluded from comparisons until a slot is chosen through **Armor slot override** in its detail panel. Recognized armor can also be overridden there if needed.

## Temporary effect symbols

| Symbol | Effect or purpose |
| --- | --- |
| 🌶️ | Pepper Spray: maced / enemy dexterity debuff |
| 😵‍💫 | Concussion Grenade: concussed / enemy dexterity debuff |
| ⚡ | Flash Grenade: blinded / enemy speed debuff |
| 😶‍🌫️ | Smoke Grenade: smoked / enemy speed debuff |
| 😭 | Tear Gas: gassed / enemy dexterity debuff |
| ☣️ | Nerve gas |
| 🔥 | Molotov: burning damage over time |
| 🪢 | Bolas: ensnare |
| 💥 | Explosive damage; this icon alone does not imply a debuff |
| 🫥 | Stygian Darkness |
| 💪 | Epinephrine: self strength buff |
| 🏃 | Melatonin: self speed buff |
| 🛡️ | Serotonin: self defense and life effect |
| 🎯 | Tyrosine: self dexterity buff |
| 🎉 | Decorative effect |
| ✦ | Other catalog effect; tap to read it |
| · | No special effect reported |

The detail panel shows the catalog's effect text when available. Damage arrows do not rank the tactical usefulness of utility effects or account for enemy immunities.

## Settings, support and diagnostics

The **⚙** control sits just above the inventory container, in the area above the Items heading. It does not modify another script's controls. If Torn's inventory container cannot be found, a fallback settings control appears near the lower-right side of the page. Tampermonkey also receives a settings menu command.

Settings include comparison enable/disable, numeric values, differences, RoF, effect symbols, reference behavior, coverage area, font size and arrow colors.

The supplied **Donation UI Module 1.4** is embedded in settings with its animated coffee button and Xanax-tip link. Its original floating placement was adapted to the settings container. The supplied **Modular Debugger 1.0.4** is embedded inside the main script IIFE, with its log viewer, copy control and optional DOM inspector intact.

- **🪲** opens the debugger.
- **📋 Copy Logs to Clipboard** copies redacted diagnostics.
- For a markup issue, use the debugger's **🔍 / Pick** control, select an affected inventory row and choose **Copy DOM**. Inspect the report before sharing it.
- [Greasy Fork: ShavedW00kie](https://greasyfork.org/en/users/1597765-shavedw00kie)
- [Buy ThaWookie a coffee](https://www.buymeacoffee.com/bittick1c)

## Refreshing and API behavior

**Refresh visible stats** refreshes individual visible item stats and equipped references. **Refresh reference data** also clears the catalog and inventory caches.

- Reference catalogs are cached for 24 hours.
- Individual item ratings are cached for 6 hours.
- Inventory fallback lists are cached for an hour, matching Torn's documented inventory cache. Refreshing cannot guarantee that a newly acquired item immediately appears in that API list.
- Item details are requested in batches of up to 25 UIDs. Both the legacy single-item object and the current array response are supported.
- Requests are serialized, with at least a 3.4-second reservation gap and at most 18 script reservations per rolling minute. Same-origin tabs coordinate through browser locks where available. Other scripts consume Torn's shared API allowance too.
- Rate limits pause requests. Permanent key/access failures stop automatic requests until corrected. Refresh allows an explicit retry after a cooldown.
- DOM updates are detected with MutationObserver and coalesced with requestAnimationFrame. There is no interval polling. Timers are used only for network pacing/timeouts and the supplied debugger's brief copy-status feedback.

The key is sent only to `https://api.torn.com` in the authorization header, never in an API URL. Manager storage is preferred; the WebView fallback uses sessionStorage. Cached inventory data is not uploaded or shared. There is no analytics, remote executable dependency, automated equipping, item use or combat action. Coffee and support links open only after a user click.

## Verification and remaining limits

Verified against Torn's published OpenAPI schema **6.13.8**, the supplied API guide and codex, and TornPDA's documented HTTP handler.

The release passed **60 behavior checks** covering individual UID matching, duplicate copies, cached and cold API paths, selected references, same-slot armor, coverage, zero-damage temporary items, response formats, API errors, rate reservations, nested inventory rows, React replacement, native TornPDA transport, browser fallbacks, module placement and copied-log key redaction.

It also passed **10 Chromium browser checks** at mobile 390 × 844 and desktop 1280 × 900 sizes, with screenshots inspected for layout. These checks used controlled inventory and API fixtures. The script has not been executed against your signed-in live Torn account or on a physical TornPDA device, so undocumented markup variants may require adjustment. API data and catalog information reflect their documented meanings rather than every player-specific combat modifier.

## Reference documentation

- [Torn API OpenAPI specification](https://www.torn.com/swagger/openapi.json)
- [Torn API documentation and changelog](https://www.torn.com/api.html)
- [TornPDA HTTP handlers](https://github.com/Manuito83/torn-pda/blob/master/docs/webview/http-handlers.md)
- [Official Torn Wiki: Armor](https://wiki.torn.com/wiki/Armor)
- [Official Torn Wiki: Temporary weapons](https://wiki.torn.com/wiki/Temporary_Items)
- [Official Torn Wiki: Rate of fire](https://wiki.torn.com/wiki/List_of_weapons_rate_of_fire)

The main script's version is **1.0.2**. Bundled module version numbers identify those modules and are intentionally different.

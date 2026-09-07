/**
 * prefill — Sheet API.
 *
 * Bound to the spreadsheet that stores presets and fill history, deployed as a
 * Web App ("execute as me", "anyone with the link"). Only the Netlify function
 * calls it; the shared token is what stands between a leaked deployment URL and
 * the sheet.
 *
 * Setup:
 *   1. Extensions > Apps Script on the spreadsheet, paste this file.
 *   2. Project Settings > Script properties: add TOKEN = <same value as
 *      SHEET_API_TOKEN in the Netlify env>.
 *   3. Deploy > New deployment > Web app > execute as me, access "Anyone".
 *      Copy the /exec URL into SHEET_API_URL.
 *
 * Both tabs are created on first use — no manual sheet setup.
 *
 * Note on the token: an Apps Script Web App is never given request headers, so
 * it arrives in the POST body. Sending it as Authorization would silently
 * produce a "wrong token" error instead.
 */

var PRESETS = ['name', 'formId', 'formTitle', 'answers', 'updated'];
var HISTORY = ['at', 'formId', 'formTitle', 'preset', 'values', 'url'];

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function sheet_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Data rows as arrays, header dropped. */
function rows_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
}

/** Sheets may coerce an ISO string into a Date on write; normalise on read. */
function str_(v) {
  return v instanceof Date ? v.toISOString() : String(v == null ? '' : v);
}

function parse_(v) {
  try {
    return JSON.parse(v);
  } catch (e) {
    return {};
  }
}

function doGet() {
  // Not part of the API — just something to look at to confirm the deployment
  // is live before wiring up SHEET_API_URL.
  return out_({ ok: true, service: 'prefill sheet api' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ error: 'body is not JSON' });
  }

  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!expected) return out_({ error: 'script property TOKEN is not set' });
  if (body.token !== expected) return out_({ error: 'bad token' });

  try {
    switch (body.action) {
      case 'listPresets':
        return out_({ rows: listPresets_() });
      case 'savePreset':
        return out_(savePreset_(body));
      case 'deletePreset':
        return out_(deletePreset_(body.name));
      case 'listHistory':
        return out_({ rows: listHistory_() });
      case 'logFill':
        return out_(logFill_(body));
      default:
        return out_({ error: 'unknown action: ' + body.action });
    }
  } catch (err) {
    return out_({ error: String(err) });
  }
}

function listPresets_() {
  return rows_(sheet_('presets', PRESETS)).map(function (r) {
    return {
      name: str_(r[0]),
      formId: str_(r[1]),
      formTitle: str_(r[2]),
      answers: parse_(r[3]),
      updated: str_(r[4]),
    };
  });
}

/** Upsert by name — a preset is identified by what the user called it. */
function savePreset_(b) {
  if (!b.name) return { error: 'preset needs a name' };
  var sh = sheet_('presets', PRESETS);
  var row = [
    b.name,
    b.formId || '',
    b.formTitle || '',
    JSON.stringify(b.answers || {}),
    new Date().toISOString(),
  ];
  var existing = rows_(sh);
  for (var i = 0; i < existing.length; i++) {
    if (str_(existing[i][0]) === b.name) {
      sh.getRange(i + 2, 1, 1, row.length).setValues([row]);
      return { ok: true, updated: true };
    }
  }
  sh.appendRow(row);
  return { ok: true, updated: false };
}

function deletePreset_(name) {
  var sh = sheet_('presets', PRESETS);
  var existing = rows_(sh);
  for (var i = 0; i < existing.length; i++) {
    if (str_(existing[i][0]) === name) {
      sh.deleteRow(i + 2);
      return { ok: true };
    }
  }
  return { error: 'no preset named ' + name };
}

function listHistory_() {
  return rows_(sheet_('history', HISTORY))
    .map(function (r) {
      return {
        at: str_(r[0]),
        formId: str_(r[1]),
        formTitle: str_(r[2]),
        preset: str_(r[3]),
        values: parse_(r[4]),
        url: str_(r[5]),
      };
    })
    .reverse();
}

function logFill_(b) {
  sheet_('history', HISTORY).appendRow([
    new Date().toISOString(),
    b.formId || '',
    b.formTitle || '',
    b.preset || '',
    JSON.stringify(b.values || {}),
    b.url || '',
  ]);
  return { ok: true };
}

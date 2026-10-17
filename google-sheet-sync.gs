/**
 * Pocket Money → Google Sheet live sync (version 5).
 *
 * Paste this into Extensions → Apps Script of your Google Sheet.
 * To update an existing setup and KEEP the same link:
 *   Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy.
 * First setup: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *
 * "Entries" keeps every entry ever logged, including deleted ones.
 * Tick "Approved" (and optionally write a "Parent note") and your son
 * sees it in his app the next time it syncs.
 *
 * "Debts" is managed by you: add a row (Debt, Total, Per month) and it
 * appears in his app. Delete a row to remove the debt.
 */

var COLS = ['ID', 'Date', 'Type', 'What / note', 'Account', 'Amount (CHF)', 'Balance change', 'Hours', 'Logged at', 'Status', 'Approved', 'Parent note'];
var dataCols = 10;   // ID .. Status are written by the app
var approvedCol = 11;
var noteCol = 12;

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    writeSummary(getSheet(ss, 'Summary'), data);
    var approvals = writeEntries(getSheet(ss, 'Entries'), data);
    var debts = syncDebts(getSheet(ss, 'Debts'), data);
    return json({ ok: true, approvals: approvals, debts: debts });
  } catch (err) {
    // Write the problem into a "Sync log" tab so it is easy to see what went wrong
    try {
      var log = getSheet(SpreadsheetApp.getActiveSpreadsheet(), 'Sync log');
      log.appendRow([new Date(), String(err && err.message || err), String(err && err.stack || '')]);
    } catch (ignore) {}
    return json({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('Pocket Money sync is running (v5).');
}

function getSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function writeSummary(sh, d) {
  sh.clear();
  var rows = [];
  rows.push(['Pocket Money' + (d.name ? ' · ' + d.name : ''), '', '', '', '']);
  rows.push(['Last update', new Date(d.sentAt), '', '', '']);
  rows.push(['', '', '', '', '']);
  rows.push(['Accounts', 'Balance (CHF)', '', '', '']);
  d.accounts.forEach(function (a) { rows.push([a[0], a[1], '', '', '']); });
  rows.push(['Total', d.total, '', '', '']);
  rows.push(['', '', '', '', '']);
  rows.push(['Debts', 'Total', 'Paid', 'Left', 'Per month']);
  d.debts.forEach(function (x) { rows.push(x); });
  rows.push(['', '', '', '', '']);
  rows.push(['Monthly budget', 'CHF', '', '', '']);
  d.budget.forEach(function (b) { rows.push([b[0], b[1], '', '', '']); });
  sh.getRange(1, 1, rows.length, 5).setValues(rows);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  rows.forEach(function (r, i) {
    if (r[0] === 'Accounts' || r[0] === 'Debts' || r[0] === 'Monthly budget' || r[0] === 'Total') {
      sh.getRange(i + 1, 1, 1, 5).setFontWeight('bold');
    }
  });
  sh.getRange(2, 2).setNumberFormat('dd.mm.yyyy hh:mm');
  sh.getRange(4, 2, rows.length - 3, 4).setNumberFormat('#,##0.00');
  sh.autoResizeColumns(1, 5);
}

// Updates rows by ID and never deletes a row. Returns { id: { a: approved, n: note } }.
function writeEntries(sh, d) {
  if (sh.getLastRow() < 1 || sh.getRange(1, 1).getValue() !== 'ID') {
    sh.clear();
    sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideColumns(1);
  }
  var last = sh.getLastRow();
  var existing = last > 1 ? sh.getRange(2, 1, last - 1, COLS.length).getValues() : [];
  var rowOf = {};
  existing.forEach(function (r, i) { if (r[0]) rowOf[r[0]] = i; });

  var seen = {};
  var toAppend = [];
  d.entries.forEach(function (r) {
    if (!r || r.length < 10) return; // skip data from an old app version
    var id = r[0];
    seen[id] = true;
    var vals = [id, r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8] ? new Date(r[8]) : '', r[9]];
    if (rowOf[id] !== undefined) {
      var cur = existing[rowOf[id]];
      for (var c = 0; c < dataCols; c++) cur[c] = vals[c];
    } else {
      toAppend.push(vals.concat([false, '']));
    }
  });
  // Entries the app no longer knows about (e.g. "Start over") stay, marked as removed
  existing.forEach(function (r) {
    if (r[0] && !seen[r[0]] && String(r[9]).indexOf('Deleted') !== 0 && String(r[9]).indexOf('Removed') !== 0) {
      r[9] = 'Removed from app';
    }
  });

  if (existing.length) sh.getRange(2, 1, existing.length, dataCols).setValues(existing.map(function (r) { return r.slice(0, dataCols); }));
  if (toAppend.length) sh.getRange(last + 1, 1, toAppend.length, COLS.length).setValues(toAppend);

  var n = sh.getLastRow() - 1;
  if (n > 0) {
    var body = sh.getRange(2, 1, n, COLS.length);
    body.sort([{ column: 2, ascending: false }, { column: 9, ascending: false }]);
    sh.getRange(2, approvedCol, n, 1).insertCheckboxes();
    sh.getRange(2, 6, n, 2).setNumberFormat('+#,##0.00;-#,##0.00;0.00');
    sh.getRange(2, 9, n, 1).setNumberFormat('dd.mm.yyyy hh:mm');
    var all = body.getValues();
    var lines = [], colors = [];
    all.forEach(function (r) {
      var gone = String(r[9]) !== 'Active';
      lines.push(new Array(COLS.length).fill(gone ? 'line-through' : 'none'));
      colors.push(new Array(COLS.length).fill(gone ? '#999999' : '#000000'));
    });
    body.setFontLines(lines).setFontColors(colors);
  }
  sh.autoResizeColumns(2, COLS.length - 1);

  var out = {};
  if (n > 0) {
    sh.getRange(2, 1, n, COLS.length).getValues().forEach(function (r) {
      if (r[0] && (r[approvedCol - 1] === true || r[noteCol - 1])) out[r[0]] = { a: r[approvedCol - 1] === true, n: String(r[noteCol - 1] || '') };
    });
  }
  return out;
}

// The parent manages debts here. Returns [{ id, name, total, monthly }] for the app.
var DEBT_COLS = ['ID', 'Debt', 'Total (CHF)', 'Per month (CHF)', 'Paid (CHF)', 'Left (CHF)'];
function syncDebts(sh, d) {
  var app = d.debtList || [];
  var paidOf = {};
  app.forEach(function (x) { paidOf[x.id] = x.paid; });
  if (sh.getLastRow() < 1 || sh.getRange(1, 1).getValue() !== 'ID') {
    // First time: start the tab with the debts the app already has
    sh.clear();
    sh.getRange(1, 1, 1, DEBT_COLS.length).setValues([DEBT_COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideColumns(1);
    if (app.length) sh.getRange(2, 1, app.length, 4).setValues(app.map(function (x) { return [x.id, x.name, x.total, x.monthly]; }));
  }
  var n = sh.getLastRow() - 1;
  var out = [];
  if (n > 0) {
    var rows = sh.getRange(2, 1, n, DEBT_COLS.length).getValues();
    rows.forEach(function (r, i) {
      var name = String(r[1] || '').trim();
      var total = num(r[2]);
      if (!name || total <= 0) {
        if (name) { r[4] = ''; r[5] = 'Check Total: use plain numbers like 150'; }
        return;
      }
      if (!r[0]) r[0] = 'd' + new Date().getTime().toString(36) + i;
      var paid = Number(paidOf[r[0]]) || 0;
      r[4] = paid;
      r[5] = Math.max(0, Math.round((total - paid) * 100) / 100);
      out.push({ id: String(r[0]), name: name, total: total, monthly: num(r[3]) });
    });
    sh.getRange(2, 1, n, DEBT_COLS.length).setValues(rows);
    sh.getRange(2, 3, n, 4).setNumberFormat('#,##0.00');
  }
  sh.autoResizeColumns(2, DEBT_COLS.length - 1);
  return out;
}

// Reads numbers the Swiss way too: 150.-, CHF 1'500, 150,50
function num(v) {
  if (typeof v === 'number') return v;
  var s = String(v || '').replace(/CHF|Fr\.?|\s|'|’/gi, '').replace(/\.-$/, '').replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

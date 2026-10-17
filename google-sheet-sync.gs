/**
 * Pocket Money → Google Sheet live sync (version 2).
 *
 * Paste this into Extensions → Apps Script of your Google Sheet,
 * then Deploy → Manage deployments → edit → Version: New version → Deploy
 * (or for a first setup: Deploy → New deployment → Web app,
 *  Execute as: Me, Who has access: Anyone).
 *
 * "Entries" keeps every entry ever logged, including deleted ones.
 * Tick "Approved" (and optionally write a "Parent note") and your son
 * sees it in his app the next time it syncs.
 */

var COLS = ['ID', 'Date', 'Type', 'What / note', 'Account', 'Amount (CHF)', 'Balance change', 'Hours', 'Logged at', 'Status', 'Approved', 'Parent note'];
var DATA_COLS = 10;   // ID .. Status are written by the app
var APPROVED_COL = 11;
var NOTE_COL = 12;

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var approvals;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    writeSummary(getSheet(ss, 'Summary'), data);
    approvals = writeEntries(getSheet(ss, 'Entries'), data);
  } finally {
    lock.releaseLock();
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true, approvals: approvals }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('Pocket Money sync is running (v2).');
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
    var id = r[0];
    seen[id] = true;
    var vals = [id, r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8] ? new Date(r[8]) : '', r[9]];
    if (rowOf[id] !== undefined) {
      var cur = existing[rowOf[id]];
      for (var c = 0; c < DATA_COLS; c++) cur[c] = vals[c];
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

  if (existing.length) sh.getRange(2, 1, existing.length, DATA_COLS).setValues(existing.map(function (r) { return r.slice(0, DATA_COLS); }));
  if (toAppend.length) sh.getRange(last + 1, 1, toAppend.length, COLS.length).setValues(toAppend);

  var n = sh.getLastRow() - 1;
  if (n > 0) {
    var body = sh.getRange(2, 1, n, COLS.length);
    body.sort([{ column: 2, ascending: false }, { column: 9, ascending: false }]);
    sh.getRange(2, APPROVED_COL, n, 1).insertCheckboxes();
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
      if (r[0] && (r[APPROVED_COL - 1] === true || r[NOTE_COL - 1])) out[r[0]] = { a: r[APPROVED_COL - 1] === true, n: String(r[NOTE_COL - 1] || '') };
    });
  }
  return out;
}

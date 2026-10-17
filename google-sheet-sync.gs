/**
 * Pocket Money → Google Sheet live sync.
 *
 * Paste this into Extensions → Apps Script of a new Google Sheet,
 * then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * Put the web app URL into the app under Setup → Live sync.
 *
 * Every time an entry is saved, the app sends its full data here.
 * The sheet tabs "Summary" and "Entries" are rewritten each time,
 * so deleted entries disappear here too.
 */

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    writeSummary(getSheet(ss, 'Summary'), data);
    writeEntries(getSheet(ss, 'Entries'), data);
  } finally {
    lock.releaseLock();
  }
  return ContentService.createTextOutput('ok');
}

function doGet() {
  return ContentService.createTextOutput('Pocket Money sync is running.');
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

function writeEntries(sh, d) {
  sh.clear();
  var head = ['Date', 'Type', 'What / note', 'Account', 'Amount (CHF)', 'Balance change', 'Hours', 'Logged at'];
  var rows = [head].concat(d.entries.map(function (r) {
    return [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7] ? new Date(r[7]) : ''];
  }));
  sh.getRange(1, 1, rows.length, head.length).setValues(rows);
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (rows.length > 1) {
    sh.getRange(2, 5, rows.length - 1, 2).setNumberFormat('+#,##0.00;-#,##0.00;0.00');
    sh.getRange(2, 8, rows.length - 1, 1).setNumberFormat('dd.mm.yyyy hh:mm');
  }
  sh.autoResizeColumns(1, head.length);
}

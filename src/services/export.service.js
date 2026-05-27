'use strict';
/** Excel (.xlsx) and PDF export builders. Returns Buffers for the routes to send. */
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const NAVY = '1E3A5F', GOLD = 'C8A24B';
const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------------- Excel ---------------- */
async function workbookBuffer(build) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cassian PMS';
  build(wb);
  return wb.xlsx.writeBuffer();
}
function styleHeaderRow(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + NAVY } }; });
}
function tableSheet(ws, columns, rows) {
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 20 }));
  styleHeaderRow(ws.getRow(1));
  rows.forEach((r) => ws.addRow(r));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function clientsXlsx(rows) {
  return workbookBuffer((wb) => {
    tableSheet(wb.addWorksheet('Clients'), [
      { header: 'Name', key: 'name', width: 34 }, { header: 'Category', key: 'category', width: 14 },
      { header: 'TIN', key: 'tin', width: 16 }, { header: 'VRN', key: 'vrn', width: 16 },
      { header: 'Sector', key: 'sector', width: 20 }, { header: 'Year-end', key: 'financial_year_end', width: 14 },
      { header: 'Manager', key: 'manager_name', width: 22 }, { header: 'Status', key: 'status', width: 18 },
    ], rows);
  });
}

function obligationsXlsx(rows) {
  return workbookBuffer((wb) => {
    const ws = wb.addWorksheet('Tax obligations');
    tableSheet(ws, [
      { header: 'Client', key: 'client_name', width: 30 }, { header: 'Type', key: 'type', width: 14 },
      { header: 'Authority', key: 'authority', width: 12 }, { header: 'Period', key: 'period', width: 16 },
      { header: 'Due date', key: 'due_date', width: 14 }, { header: 'Status', key: 'status', width: 12 },
      { header: 'Amount (TZS)', key: 'amount', width: 16 },
    ], rows);
    ws.getColumn(7).numFmt = '#,##0.00';
  });
}

function trialBalanceXlsx(client, tb) {
  return workbookBuffer((wb) => {
    const ws = wb.addWorksheet('Trial Balance');
    ws.mergeCells('A1:E1'); ws.getCell('A1').value = `${client.name} — Trial Balance (TZS)`; ws.getCell('A1').font = { bold: true, size: 14 };
    ws.addRow([]);
    styleHeaderRow(ws.addRow(['Code', 'Account', 'Type', 'Debit', 'Credit']));
    tb.rows.forEach((r) => ws.addRow([r.code, r.name, r.type, Number(r.debit) || 0, Number(r.credit) || 0]));
    const tot = ws.addRow(['', '', 'Totals', tb.totals.debit, tb.totals.credit]); tot.font = { bold: true };
    [12, 34, 14, 18, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getColumn(4).numFmt = '#,##0.00'; ws.getColumn(5).numFmt = '#,##0.00';
  });
}

/* ---------------- PDF ---------------- */
function pdfBuffer(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 42, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}
function pdfHeader(doc, title, subtitle) {
  doc.fillColor('#' + NAVY).font('Helvetica-Bold').fontSize(18).text('Cassian & Associates');
  doc.fillColor('#' + GOLD).font('Helvetica').fontSize(10).text('Audit · Tax · Accounting');
  doc.moveDown(0.4); doc.fillColor('#111').font('Helvetica-Bold').fontSize(14).text(title);
  if (subtitle) doc.fillColor('#666').font('Helvetica').fontSize(10).text(subtitle);
  doc.moveDown(0.4); doc.moveTo(42, doc.y).lineTo(553, doc.y).strokeColor('#' + GOLD).stroke(); doc.moveDown(0.5);
}
function prow(doc, cols, widths, opts = {}) {
  const y = doc.y; let x = 42;
  doc.fontSize(opts.size || 10).fillColor(opts.color || '#222').font(opts.bold ? 'Helvetica-Bold' : 'Helvetica');
  cols.forEach((c, i) => { doc.text(String(c), x, y, { width: widths[i], align: (opts.align && opts.align[i]) || 'left' }); x += widths[i]; });
  doc.font('Helvetica').moveDown(0.35);
}

function trialBalancePdf(client, tb) {
  return pdfBuffer((doc) => {
    pdfHeader(doc, 'Trial Balance', client.name + ' · TZS');
    const W = [60, 230, 110, 111];
    prow(doc, ['Code', 'Account', 'Debit', 'Credit'], W, { bold: true, align: ['left', 'left', 'right', 'right'] });
    tb.rows.forEach((r) => prow(doc, [r.code, r.name, r.debit ? money(r.debit) : '', r.credit ? money(r.credit) : ''], W, { align: ['left', 'left', 'right', 'right'] }));
    prow(doc, ['', 'Totals', money(tb.totals.debit), money(tb.totals.credit)], W, { bold: true, align: ['left', 'left', 'right', 'right'] });
    doc.moveDown(0.4).fontSize(9).fillColor(tb.balanced ? '#2e7d57' : '#b3402f').text(tb.balanced ? 'Balanced' : 'OUT OF BALANCE');
  });
}

function financialStatementsPdf(client, fs) {
  return pdfBuffer((doc) => {
    pdfHeader(doc, 'Financial Statements', client.name + ' · TZS');
    const pl = fs.profitAndLoss, bs = fs.balanceSheet, W = [330, 181];
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#' + NAVY).text('Statement of Profit or Loss'); doc.moveDown(0.3);
    pl.income.forEach((r) => prow(doc, [r.name, money(r.amount)], W, { align: ['left', 'right'] }));
    prow(doc, ['Total income', money(pl.totalIncome)], W, { bold: true, align: ['left', 'right'] });
    pl.expense.forEach((r) => prow(doc, [r.name, money(r.amount)], W, { align: ['left', 'right'] }));
    prow(doc, ['Total expenses', money(pl.totalExpense)], W, { bold: true, align: ['left', 'right'] });
    prow(doc, ['Profit for the period', money(pl.profit)], W, { bold: true, align: ['left', 'right'] });
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#' + NAVY).text('Statement of Financial Position'); doc.moveDown(0.3);
    bs.assets.forEach((r) => prow(doc, [r.name, money(r.amount)], W, { align: ['left', 'right'] }));
    prow(doc, ['Total assets', money(bs.totalAssets)], W, { bold: true, align: ['left', 'right'] });
    bs.liabilities.forEach((r) => prow(doc, [r.name, money(r.amount)], W, { align: ['left', 'right'] }));
    prow(doc, ['Total liabilities', money(bs.totalLiabilities)], W, { bold: true, align: ['left', 'right'] });
    bs.equity.forEach((r) => prow(doc, [r.name, money(r.amount)], W, { align: ['left', 'right'] }));
    prow(doc, ['Current-period profit', money(bs.currentProfit)], W, { align: ['left', 'right'] });
    prow(doc, ['Total equity', money(bs.totalEquity)], W, { bold: true, align: ['left', 'right'] });
    prow(doc, ['Liabilities + Equity', money(bs.totalLiabilitiesAndEquity)], W, { bold: true, align: ['left', 'right'] });
  });
}

module.exports = { clientsXlsx, obligationsXlsx, trialBalanceXlsx, trialBalancePdf, financialStatementsPdf };

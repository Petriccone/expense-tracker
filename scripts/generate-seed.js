const XLSX = require('xlsx');
const fs = require('fs');
const wb = XLSX.readFile('C:/Users/rsp88/Desktop/Budget.xlsx');

// Each spreadsheet item becomes its own category with a unique icon
const categoryDefs = {
  'Insurance':    { icon: '🛡️', color: '#6366F1' },
  'Deliveroo':    { icon: '🛵', color: '#00CCBC' },
  'Ultra Plan':   { icon: '📱', color: '#8B5CF6' },
  'Phone':        { icon: '📞', color: '#3B82F6' },
  'Shop':         { icon: '🛒', color: '#F59E0B' },
  'Elitricity':   { icon: '⚡', color: '#FBBF24' },
  'Youtube':      { icon: '▶️', color: '#FF0000' },
  'Loan':         { icon: '🏦', color: '#64748B' },
  'Apple':        { icon: '🍎', color: '#A3A3A3' },
  'Amazon':       { icon: '📦', color: '#FF9900' },
  'Spotify':      { icon: '🎵', color: '#1DB954' },
  'Wifi':         { icon: '📡', color: '#06B6D4' },
  'Leap Card':    { icon: '🚌', color: '#10B981' },
  'AI':           { icon: '🤖', color: '#7C3AED' },
  'Eyebrows':     { icon: '✨', color: '#EC4899' },
  'Netflix':      { icon: '🎬', color: '#E50914' },
  'Eye Lashes':   { icon: '👁️', color: '#F472B6' },
  'Hair Cut':     { icon: '💇', color: '#D946EF' },
  'Nail':         { icon: '💅', color: '#F43F5E' },
  'Toll':         { icon: '🛣️', color: '#78716C' },
  'Fuel':         { icon: '⛽', color: '#EF4444' },
  'Gym':          { icon: '🏋️', color: '#22C55E' },
  'Cleaner':      { icon: '🧹', color: '#14B8A6' },
  'Rental':       { icon: '🏠', color: '#8B5CF6' },
  'Pay Later':    { icon: '💳', color: '#6366F1' },
  'Credit Card':  { icon: '💳', color: '#1E40AF' },
  'Car Fix':      { icon: '🔧', color: '#78716C' },
  'Van Rental':   { icon: '🚐', color: '#64748B' },
  'Car Wash':     { icon: '🚿', color: '#38BDF8' },
  'Mounjaro':     { icon: '💊', color: '#10B981' },
  'NCT':          { icon: '🚗', color: '#78716C' },
  'Nu Bank':      { icon: '💜', color: '#820AD1' },
  'Joao':         { icon: '👤', color: '#64748B' },
  'TAX':          { icon: '📋', color: '#DC2626' },
  'Santaninha':   { icon: '🎁', color: '#F97316' },
  'AirTag':       { icon: '📍', color: '#A3A3A3' },
  'Consulta GP':  { icon: '🩺', color: '#10B981' },
  'Other':        { icon: '📦', color: '#64748B' },
};

const incomeCategories = {
  'Salary':       { icon: '💰', color: '#10B981' },
  'Freelance':    { icon: '🛵', color: '#22C55E' },
  'Other Income': { icon: '💵', color: '#84CC16' },
};

// Build categories array
const categories = [];
let catId = 1;

Object.entries(categoryDefs).forEach(([name, def]) => {
  categories.push({
    id: String(catId++),
    name,
    icon: def.icon,
    color: def.color,
    type: 'expense'
  });
});

Object.entries(incomeCategories).forEach(([name, def]) => {
  categories.push({
    id: String(catId++),
    name,
    icon: def.icon,
    color: def.color,
    type: 'income'
  });
});

// Normalize variant names to canonical
function normalizeName(name) {
  if (name === 'Eletricity') return 'Elitricity';
  if (name === 'Apple ') return 'Apple';
  if (name === 'Eyebrowns') return 'Eyebrows';
  if (name === 'Rafael ') return 'Rafael';
  return name;
}

// Build transactions from all months
const monthDates = {
  'November': '2025-11',
  'December': '2025-12',
  'January ': '2026-01',
  'February': '2026-02',
  'March': '2026-03',
  'April': '2026-04',
};

const incomeMap = {
  'Rafaela': 'Salary',
  'Rafael': 'Salary',
  'Cash': 'Other Income',
  'Dinheiro': 'Other Income',
  'Deliveroo': 'Freelance',
};

const transactions = [];
let txId = 1;

Object.entries(monthDates).forEach(([sheetName, monthStr]) => {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return;
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  let section = 'bills';

  data.forEach(row => {
    if (!row || !row[0]) return;
    const rawName = String(row[0]).trim();

    if (rawName === 'Bills' || rawName === 'Fixes') return;
    if (rawName === 'Variables') { section = 'variables'; return; }
    if (rawName === 'Incomes') { section = 'incomes'; return; }
    if (['Total', 'Net Worth', 'Save', 'Us', 'El', 'Ela', 'Missing'].includes(rawName)) return;
    if (!isNaN(Number(rawName))) return;

    if (section === 'incomes') {
      const amount = typeof row[1] === 'number' ? row[1] : 0;
      if (amount <= 0) return;
      const category = incomeMap[normalizeName(rawName)] || 'Other Income';
      transactions.push({
        id: 'seed-' + (txId++),
        type: 'income',
        amount: Math.round(amount * 100) / 100,
        description: rawName.trim(),
        category,
        date: monthStr + '-15',
        createdAt: new Date().toISOString(),
      });
      return;
    }

    // Expense - use Spent (col 2) if available, else Value (col 1)
    let amount = 0;
    if (sheetName === 'November') {
      amount = typeof row[1] === 'number' ? row[1] : 0;
    } else {
      const spent = row[2];
      const value = row[1];
      if (typeof spent === 'number' && spent > 0) {
        amount = spent;
      } else if ((spent === null || spent === undefined) && typeof value === 'number' && value > 0) {
        amount = value;
      }
    }
    if (amount <= 0) return;

    const category = normalizeName(rawName);
    transactions.push({
      id: 'seed-' + (txId++),
      type: 'expense',
      amount: Math.round(amount * 100) / 100,
      description: rawName.trim(),
      category,
      date: monthStr + '-15',
      createdAt: new Date().toISOString(),
    });
  });
});

// Build budget limits from April Value column
const aprilSheet = wb.Sheets['April'];
const aprilData = XLSX.utils.sheet_to_json(aprilSheet, { header: 1 });
const budgets = [];
let budgetSection = 'bills';

let stopBudgets = false;
aprilData.forEach(row => {
  if (stopBudgets) return;
  if (!row || !row[0]) return;
  const rawName = String(row[0]).trim();
  if (rawName === 'Bills' || rawName === 'Fixes') return;
  if (rawName === 'Variables') { budgetSection = 'variables'; return; }
  if (rawName === 'Incomes') { stopBudgets = true; return; }
  if (['Total', 'Net Worth', 'Save', 'Us', 'El', 'Ela'].includes(rawName)) return;

  const value = typeof row[1] === 'number' ? row[1] : 0;
  if (value <= 0) return;

  const catName = normalizeName(rawName);
  const cat = categories.find(c => c.name === catName && c.type === 'expense');
  if (cat) {
    budgets.push({ categoryId: cat.id, limit: Math.round(value * 100) / 100 });
  }
});

// Save files
fs.writeFileSync('public/seed-data.json', JSON.stringify(transactions, null, 2));
fs.writeFileSync('public/seed-budgets.json', JSON.stringify(budgets, null, 2));
fs.writeFileSync('public/seed-categories.json', JSON.stringify(categories, null, 2));

// Summary
console.log('Categories:', categories.length);
categories.forEach(c => console.log('  ' + c.icon + ' ' + c.name + ' (' + c.type + ')'));
console.log('\nTransactions:', transactions.length);
console.log('Budgets:', budgets.length);
budgets.forEach(b => {
  const cat = categories.find(c => c.id === b.categoryId);
  console.log('  ' + (cat ? cat.icon + ' ' + cat.name : b.categoryId) + ': EUR ' + b.limit.toFixed(2));
});

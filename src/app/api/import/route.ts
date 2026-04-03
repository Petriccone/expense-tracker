import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import * as XLSX from 'xlsx';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';

const JWT_SECRET = process.env.JWT_SECRET || 'expense-tracker-secret-key-2026';

export async function POST(request: NextRequest) {
  try {
    // Verify token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    try {
      jwt.verify(token, JWT_SECRET);
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv' // .csv
    ];

    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls|csv)$/i)) {
      return NextResponse.json({ error: 'Invalid file type. Upload .xlsx, .xls, or .csv' }, { status: 400 });
    }

    // Save file temporarily
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const tempPath = join('/tmp', `expenses-${Date.now()}-${file.name}`);
    await writeFile(tempPath, buffer);

    // Parse Excel/CSV
    let transactions: any[] = [];

    try {
      const workbook = XLSX.readFile(tempPath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet);

      // Process rows - try to detect common column patterns
      transactions = data.map((row: any, index) => {
        // Try to find common column names (case insensitive)
        const keys = Object.keys(row);
        
        // Find date column
        const dateKey = keys.find(k => /data|date|dia/i.test(k)) || keys[0];
        // Find description column  
        const descKey = keys.find(k => /descri|description|nome|what/i.test(k)) || keys[1];
        // Find amount column
        const amountKey = keys.find(k => /amount|valor|value|montante/i.test(k)) || keys[2];
        // Find category column
        const categoryKey = keys.find(k => /categoria|category/i.test(k)) || keys[3];
        // Find type column (income/expense)
        const typeKey = keys.find(k => /type|tipo/i.test(k));
        // Find notes column
        const notesKey = keys.find(k => /notes|obs|observation/i.test(k));

        // Parse amount - handle different formats
        let amount = 0;
        const amountValue = row[amountKey];
        if (typeof amountValue === 'number') {
          amount = amountValue;
        } else if (typeof amountValue === 'string') {
          // Remove currency symbols and thousands separators
          const cleaned = amountValue.replace(/[€$R\$\s.,]/g, '').replace(',', '.');
          amount = parseFloat(cleaned) || 0;
        }

        // Determine type based on column or amount sign
        let type: 'income' | 'expense' = 'expense';
        if (typeKey && row[typeKey]) {
          const typeValue = String(row[typeKey]).toLowerCase();
          if (typeValue.includes('income') || typeValue.includes('receita') || typeValue.includes('entrada')) {
            type = 'income';
          }
        } else if (amount < 0) {
          type = 'income';
          amount = Math.abs(amount);
        }

        // Parse date
        let date = new Date().toISOString().split('T')[0];
        if (row[dateKey]) {
          try {
            const parsed = new Date(row[dateKey]);
            if (!isNaN(parsed.getTime())) {
              date = parsed.toISOString().split('T')[0];
            }
          } catch {}
        }

        // Find or guess category
        let category = row[categoryKey] || 'Other';
        if (!category || category === 'Other') {
          // Try to guess from description
          const desc = String(row[descKey] || '').toLowerCase();
          if (/food|restaurant|lunch|dinner|coffee|pizza/i.test(desc)) category = 'Food & Dining';
          else if (/uber|taxi|bus|metro|train|fuel/i.test(desc)) category = 'Transport';
          else if (/rent|mortgage|electricity|water|internet/i.test(desc)) category = 'Housing';
          else if (/movie|netflix|spotify|game|concert/i.test(desc)) category = 'Entertainment';
          else if (/shop|amazon|clothes|shoes/i.test(desc)) category = 'Shopping';
          else if (/doctor|hospital|pharmacy|medicine/i.test(desc)) category = 'Health';
          else if (/book|course|school|university/i.test(desc)) category = 'Education';
          else if (/bill|subscription|insurance/i.test(desc)) category = 'Bills & Utilities';
          else if (/salary|payroll/i.test(desc)) category = 'Salary';
          else if (/freelance|client/i.test(desc)) category = 'Freelance';
          else if (/dividend|interest|stock/i.test(desc)) category = 'Investment';
        }

        return {
          id: `imported-${Date.now()}-${index}`,
          type,
          amount,
          description: row[descKey] || 'Imported transaction',
          category,
          date,
          notes: notesKey ? row[notesKey] : '',
          createdAt: new Date().toISOString(),
        };
      }).filter(t => t.amount > 0); // Filter out invalid amounts

    } finally {
      // Clean up temp file
      try {
        await unlink(tempPath);
      } catch {}
    }

    return NextResponse.json({
      success: true,
      transactions,
      count: transactions.length,
    });

  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json({ error: 'Failed to import file' }, { status: 500 });
  }
}
# Expense Tracker - Specification

## 1. Project Overview

**Project Name:** ExpenseTracker AI
**Type:** Web Application (SaaS)
**Core Functionality:** Personal finance tracking app with AI-powered insights, automatic categorization, and smart spending analysis.
**Target Users:** Individuals and small businesses who want to track expenses, understand spending patterns, and save money.

---

## 2. UI/UX Specification

### Layout Structure

**Pages:**
1. **Dashboard** - Main overview with charts, recent transactions, AI insights
2. **Transactions** - Full list with filters, search, CRUD operations
3. **Add Transaction** - Form with AI auto-categorization
4. **Categories** - Manage expense categories
5. **Reports** - Detailed analytics and charts
6. **AI Assistant** - Chat interface for finance questions
7. **Settings** - User preferences, API keys, data export

**Responsive Breakpoints:**
- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px

### Visual Design

**Color Palette:**
- Primary: `#7C3AED` (Purple - Botfy style)
- Primary Dark: `#5B21B6`
- Secondary: `#0F172A` (Navy)
- Accent: `#10B981` (Green - for income/positive)
- Danger: `#EF4444` (Red - for expenses/negative)
- Warning: `#F59E0B` (Amber)
- Background: `#F8FAFC`
- Card Background: `#FFFFFF`
- Text Primary: `#1E293B`
- Text Secondary: `#64748B`

**Typography:**
- Font Family: `Inter` (headings), `DM Sans` (body)
- Headings: 
  - H1: 32px, font-weight 700
  - H2: 24px, font-weight 600
  - H3: 20px, font-weight 600
- Body: 16px, font-weight 400
- Small: 14px, font-weight 400

**Spacing System:**
- Base unit: 4px
- Common: 8px, 12px, 16px, 24px, 32px, 48px

**Visual Effects:**
- Cards: `box-shadow: 0 1px 3px rgba(0,0,0,0.1)`
- Hover cards: `box-shadow: 0 4px 12px rgba(0,0,0,0.15)`
- Border radius: 8px (cards), 6px (buttons), 4px (inputs)
- Transitions: 200ms ease

### Components

**Navigation:**
- Sidebar (desktop): 240px width, icons + labels
- Bottom nav (mobile): 5 items
- Active state: Purple background tint, bold text

**Cards:**
- Summary cards: Icon + title + value + trend indicator
- Transaction cards: Date, description, category badge, amount
- AI Insight cards: Purple border-left, light purple background

**Forms:**
- Input fields: Full width, 48px height, border on focus
- Select dropdowns: Custom styled with icons
- Date picker: Calendar popup
- Amount input: Currency formatting, large font

**Buttons:**
- Primary: Purple bg, white text
- Secondary: White bg, purple border
- Danger: Red bg, white text
- States: hover (darken 10%), active (scale 0.98), disabled (opacity 0.5)

**Charts:**
- Pie chart: Category distribution
- Bar chart: Monthly comparison
- Line chart: Spending trends
- Colors: Purple gradient palette

---

## 3. Functionality Specification

### Core Features

#### 3.1 Transaction Management
- Add new expense/income with: amount, date, description, category, notes
- Edit existing transactions
- Delete transactions (soft delete)
- Bulk delete
- Search by description
- Filter by: date range, category, type (income/expense), amount range
- Sort by: date, amount, category

#### 3.2 Categories
- Default categories: Food, Transport, Housing, Entertainment, Shopping, Health, Education, Bills, Other
- Custom categories with icon and color
- Income categories: Salary, Freelance, Investment, Gift, Other
- Category icons (using emoji or Lucide icons)

#### 3.3 Dashboard
- Total balance (income - expenses)
- This month summary (income, expenses, net)
- Spending by category (pie chart)
- Monthly comparison (bar chart - last 6 months)
- Recent transactions (last 10)
- AI Insights panel (top 3 insights)
- Quick add button

#### 3.4 AI Features

**Auto-categorization:**
- When adding transaction, AI suggests category based on description
- Uses GPT-4o mini to analyze description
- User can accept or change

**AI Insights:**
- Daily insight generation based on spending patterns
- Examples:
  - "You're spending 40% more on dining this month vs last"
  - "You've exceeded your entertainment budget by €50"
  - "Your average daily spend this week is €45"

**AI Chat Assistant:**
- Ask questions about finances
- Examples:
  - "How much did I spend on groceries this month?"
  - "What's my biggest expense category?"
  - "Give me a summary of my spending this year"
  - "Should I cut back on any category?"

**Spending Forecast:**
- Predict end-of-month total based on current trend
- Alert if likely to exceed budget

#### 3.5 Reports
- Monthly summary report
- Category breakdown
- Year-over-year comparison
- Export to CSV
- Date range selection

#### 3.6 Settings
- Monthly budget limit per category
- Currency selection (EUR, USD, BRL)
- Dark/light mode toggle
- Data export (JSON/CSV)
- Clear all data

### User Interactions

- Click transaction → View details / Edit modal
- Drag to reorder categories (future)
- Swipe to delete (mobile)
- Double-click amount to quick edit
- Keyboard shortcuts: Ctrl+N (new transaction), Ctrl+F (search)

### Data Handling

**Local Storage (Demo):**
- All data stored in localStorage for demo
- Structure: transactions[], categories[], settings{}
- Auto-save on changes

**API Endpoints (Future):**
- POST /api/transactions
- GET /api/transactions
- PUT /api/transactions/[id]
- DELETE /api/transactions/[id]
- POST /api/categorize (AI)
- POST /api/chat (AI assistant)
- GET /api/insights

### Edge Cases
- Empty state: Show onboarding/empty illustrations
- Large amounts: Format with K/M suffixes
- Long descriptions: Truncate with ellipsis
- No internet: Queue operations, sync later
- Invalid input: Show inline validation errors

---

## 4. Acceptance Criteria

### Visual Checkpoints
- [ ] Dashboard loads with all 6 summary cards
- [ ] Pie chart shows category distribution
- [ ] Bar chart shows 6-month comparison
- [ ] Recent transactions list renders
- [ ] AI insights panel shows at least 1 insight
- [ ] Navigation works between all pages
- [ ] Forms validate input before submission
- [ ] Responsive on mobile/tablet/desktop

### Functional Checkpoints
- [ ] Can add new expense with all fields
- [ ] Can add new income
- [ ] AI suggests category on new transaction
- [ ] Can edit existing transaction
- [ ] Can delete transaction
- [ ] Search filters transactions in real-time
- [ ] Category filter works
- [ ] Date range filter works
- [ ] AI chat responds to finance questions
- [ ] Settings save and persist
- [ ] Data persists in localStorage across refresh

### AI Checkpoints
- [ ] Auto-categorization returns relevant category
- [ ] AI insights update on new transaction
- [ ] Chat can answer spending questions
- [ ] Forecast shows predicted month-end total

---

## 5. Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Styling:** Tailwind CSS
- **Charts:** Recharts
- **Icons:** Lucide React
- **AI:** OpenAI GPT-4o mini (via API)
- **State:** React Context + useReducer
- **Storage:** localStorage (demo) / Ready for Supabase
- **Fonts:** Google Fonts (Inter, DM Sans)
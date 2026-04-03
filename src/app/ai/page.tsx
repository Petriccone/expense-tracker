'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Sparkles, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { useTransactions, useSettings } from '@/context/AppContext';
import { ChatMessage } from '@/types';

export default function AIPage() {
  const { transactions } = useTransactions();
  const { settings } = useSettings();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'assistant',
      content: "Hello! I'm your AI financial assistant. Ask me anything about your spending, savings, or financial health. For example:\n\n• How much did I spend on groceries this month?\n• What's my biggest expense category?\n• Should I cut back on any category?\n• How much have I saved this month?",
      createdAt: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currencySymbol = settings.currency === 'EUR' ? '€' : settings.currency === 'USD' ? '$' : 'R$';

  const formatAmount = (amount: number) => {
    return `${currencySymbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Simple AI response generator
  const generateResponse = (question: string): string => {
    const q = question.toLowerCase();
    const now = new Date();
    const thisMonth = transactions.filter((t) => {
      const d = new Date(t.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    const income = thisMonth.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const expenses = thisMonth.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const net = income - expenses;

    // Category breakdown
    const categoryTotals: Record<string, number> = {};
    thisMonth.filter((t) => t.type === 'expense').forEach((t) => {
      categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
    });
    const sortedCategories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);

    // Groceries/food spending
    if (q.includes('grocery') || q.includes('food') || q.includes('restaurant') || q.includes('meal')) {
      const foodSpending = categoryTotals['Food & Dining'] || 0;
      if (foodSpending > 0) {
        return `You've spent **${formatAmount(foodSpending)}** on food & dining this month. ` +
          (foodSpending > 300 ? "That's quite a bit! Consider cooking at home more often to save money." : "That's a reasonable amount for food.");
      }
      return "I don't see any food-related expenses in your records this month.";
    }

    // Biggest expense
    if (q.includes('biggest') || q.includes('main') || q.includes('most') || q.includes('top')) {
      if (sortedCategories.length > 0) {
        const [topCat, amount] = sortedCategories[0];
        const percentage = ((amount / expenses) * 100).toFixed(1);
        return `Your biggest expense this month is **${topCat}** at **${formatAmount(amount)}** (${percentage}% of total expenses).`;
      }
      return "You don't have any expenses recorded this month.";
    }

    // Savings/net
    if (q.includes('saving') || q.includes('net') || q.includes('left') || q.includes('surplus')) {
      if (net > 0) {
        return `Great news! You have a **positive net balance** of **${formatAmount(net)}** this month. ` +
          `That's ${((net / income) * 100).toFixed(1)}% of your income saved! ` +
          (net > 500 ? "Consider putting some of that into savings or investments." : "Keep it up!");
      } else if (net < 0) {
        return `Your net balance is **negative** at **${formatAmount(Math.abs(net))}**. ` +
          "You're spending more than you earn. Review your expenses and find areas to cut back.";
      }
      return "You have a balanced budget this month - income equals expenses.";
    }

    // Total spending
    if (q.includes('total') && (q.includes('spend') || q.includes('expense'))) {
      return `Your total expenses this month are **${formatAmount(expenses)}** across ${sortedCategories.length} categories.`;
    }

    // Total income
    if (q.includes('total') && q.includes('income') && !q.includes('expense')) {
      return `Your total income this month is **${formatAmount(income)}**.`;
    }

    // Monthly summary
    if (q.includes('summary') || q.includes('overview') || q.includes('month')) {
      let response = `Here's your monthly summary:\n\n`;
      response += `💰 **Income:** ${formatAmount(income)}\n`;
      response += `💸 **Expenses:** ${formatAmount(expenses)}\n`;
      response += `${net >= 0 ? '✅' : '⚠️'} **Net:** ${formatAmount(net)}\n\n`;
      if (sortedCategories.length > 0) {
        response += `**Top expenses:**\n`;
        sortedCategories.slice(0, 3).forEach(([cat, amount], i) => {
          response += `${i + 1}. ${cat}: ${formatAmount(amount)}\n`;
        });
      }
      return response;
    }

    // Budget question
    if (q.includes('budget')) {
      if (expenses > settings.monthlyBudget) {
        const overBy = expenses - settings.monthlyBudget;
        return `⚠️ You've exceeded your monthly budget of ${formatAmount(settings.monthlyBudget)} by **${formatAmount(overBy)}**. ` +
          "Consider cutting back on non-essential expenses.";
      }
      const remaining = settings.monthlyBudget - expenses;
      const percentUsed = ((expenses / settings.monthlyBudget) * 100).toFixed(1);
      return `You're using ${percentUsed}% of your monthly budget (${formatAmount(expenses)} of ${formatAmount(settings.monthlyBudget)}). ` +
        `You have **${formatAmount(remaining)}** remaining.`;
    }

    // Should I cut back
    if (q.includes('cut') || q.includes('reduce') || q.includes('save') || q.includes('advice')) {
      if (sortedCategories.length === 0) return "You don't have enough data yet. Add some transactions first!";

      const [topCat] = sortedCategories;
      const percentage = ((topCat[1] / expenses) * 100).toFixed(1);

      if (parseFloat(percentage) > 40) {
        return `I'd suggest looking at your **${topCat[0]}** spending - it accounts for ${percentage}% of your expenses. ` +
          "Reducing this could significantly improve your savings.";
      }
      return "Your spending looks fairly balanced across categories. Keep monitoring your expenses!";
    }

    // Help
    if (q.includes('help') || q.includes('what')) {
      return "Here are some things you can ask me:\n\n" +
        "• How much did I spend on [category]?\n" +
        "• What's my biggest expense?\n" +
        "• How much have I saved this month?\n" +
        "• What's my monthly summary?\n" +
        "• Am I over budget?\n" +
        "• Should I cut back on anything?";
    }

    // Default response
    return "I'm not sure I understand. Try asking about your spending, savings, or ask for a monthly summary!";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Simulate AI processing delay
    await new Promise((resolve) => setTimeout(resolve, 800));

    const response = generateResponse(input);

    const assistantMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: response,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, assistantMessage]);
    setIsLoading(false);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] animate-fadeIn">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-purple-600" />
          AI Financial Assistant
        </h1>
        <p className="text-slate-500">Ask me anything about your finances</p>
      </div>

      {/* Chat Container */}
      <div className="flex-1 bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                message.role === 'assistant' ? 'bg-purple-100' : 'bg-slate-100'
              }`}>
                {message.role === 'assistant' ? (
                  <Bot className="w-4 h-4 text-purple-600" />
                ) : (
                  <User className="w-4 h-4 text-slate-600" />
                )}
              </div>
              <div className={`max-w-[80%] rounded-2xl p-4 ${
                message.role === 'assistant'
                  ? 'bg-purple-50 text-slate-800'
                  : 'bg-slate-100 text-slate-800'
              }`}>
                <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                <Bot className="w-4 h-4 text-purple-600" />
              </div>
              <div className="bg-purple-50 rounded-2xl p-4">
                <Loader2 className="w-5 h-5 text-purple-600 animate-spin" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-slate-100">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your finances..."
              className="input-field flex-1"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="btn-primary px-6"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>

      {/* Quick Questions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => setInput("What's my monthly summary?")}
          className="px-4 py-2 bg-white rounded-full text-sm font-medium text-slate-700 shadow-sm hover:shadow-md transition-all border border-slate-200"
        >
          📊 Monthly Summary
        </button>
        <button
          onClick={() => setInput("What's my biggest expense?")}
          className="px-4 py-2 bg-white rounded-full text-sm font-medium text-slate-700 shadow-sm hover:shadow-md transition-all border border-slate-200"
        >
          🔝 Biggest Expense
        </button>
        <button
          onClick={() => setInput("Am I over budget?")}
          className="px-4 py-2 bg-white rounded-full text-sm font-medium text-slate-700 shadow-sm hover:shadow-md transition-all border border-slate-200"
        >
          💰 Budget Status
        </button>
        <button
          onClick={() => setInput("How much have I saved this month?")}
          className="px-4 py-2 bg-white rounded-full text-sm font-medium text-slate-700 shadow-sm hover:shadow-md transition-all border border-slate-200"
        >
          ✅ Savings
        </button>
      </div>
    </div>
  );
}
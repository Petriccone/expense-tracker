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
      content: "Olá! Sou seu assistente financeiro com IA. Pergunte qualquer coisa sobre seus gastos, economias ou saúde financeira. Por exemplo:\n\n• Quanto gastei com alimentação este mês?\n• Qual é minha maior categoria de despesa?\n• Devo reduzir alguma categoria?\n• Quanto economizei este mês?",
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
        return `Você gastou **${formatAmount(foodSpending)}** com alimentação este mês. ` +
          (foodSpending > 300 ? "É bastante! Considere cozinhar em casa com mais frequência para economizar." : "É um valor razoável para alimentação.");
      }
      return "Não encontrei despesas com alimentação nos seus registros este mês.";
    }

    // Biggest expense
    if (q.includes('biggest') || q.includes('main') || q.includes('most') || q.includes('top')) {
      if (sortedCategories.length > 0) {
        const [topCat, amount] = sortedCategories[0];
        const percentage = ((amount / expenses) * 100).toFixed(1);
        return `Sua maior despesa este mês é **${topCat}** com **${formatAmount(amount)}** (${percentage}% do total de despesas).`;
      }
      return "Você não tem despesas registradas este mês.";
    }

    // Savings/net
    if (q.includes('saving') || q.includes('net') || q.includes('left') || q.includes('surplus')) {
      if (net > 0) {
        return `Ótima notícia! Você tem um **saldo positivo** de **${formatAmount(net)}** este mês. ` +
          `Isso representa ${((net / income) * 100).toFixed(1)}% da sua renda economizada! ` +
          (net > 500 ? "Considere investir parte disso em poupança ou investimentos." : "Continue assim!");
      } else if (net < 0) {
        return `Seu saldo está **negativo** em **${formatAmount(Math.abs(net))}**. ` +
          "Você está gastando mais do que ganha. Revise suas despesas e encontre áreas para cortar.";
      }
      return "Você tem um orçamento equilibrado este mês - receita igual às despesas.";
    }

    // Total spending
    if (q.includes('total') && (q.includes('spend') || q.includes('expense'))) {
      return `Suas despesas totais este mês são **${formatAmount(expenses)}** em ${sortedCategories.length} categorias.`;
    }

    // Total income
    if (q.includes('total') && q.includes('income') && !q.includes('expense')) {
      return `Sua receita total este mês é **${formatAmount(income)}**.`;
    }

    // Monthly summary
    if (q.includes('summary') || q.includes('overview') || q.includes('month')) {
      let response = `Aqui está seu resumo mensal:\n\n`;
      response += `💰 **Receita:** ${formatAmount(income)}\n`;
      response += `💸 **Despesas:** ${formatAmount(expenses)}\n`;
      response += `${net >= 0 ? '✅' : '⚠️'} **Saldo:** ${formatAmount(net)}\n\n`;
      if (sortedCategories.length > 0) {
        response += `**Maiores despesas:**\n`;
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
        return `⚠️ Você ultrapassou seu orçamento mensal de ${formatAmount(settings.monthlyBudget)} em **${formatAmount(overBy)}**. ` +
          "Considere reduzir despesas não essenciais.";
      }
      const remaining = settings.monthlyBudget - expenses;
      const percentUsed = ((expenses / settings.monthlyBudget) * 100).toFixed(1);
      return `Você está usando ${percentUsed}% do seu orçamento mensal (${formatAmount(expenses)} de ${formatAmount(settings.monthlyBudget)}). ` +
        `Você ainda tem **${formatAmount(remaining)}** disponível.`;
    }

    // Should I cut back
    if (q.includes('cut') || q.includes('reduce') || q.includes('save') || q.includes('advice')) {
      if (sortedCategories.length === 0) return "Você ainda não tem dados suficientes. Adicione algumas transações primeiro!";

      const [topCat] = sortedCategories;
      const percentage = ((topCat[1] / expenses) * 100).toFixed(1);

      if (parseFloat(percentage) > 40) {
        return `Eu sugiro analisar seus gastos com **${topCat[0]}** - representa ${percentage}% das suas despesas. ` +
          "Reduzir isso pode melhorar significativamente suas economias.";
      }
      return "Seus gastos parecem bem equilibrados entre as categorias. Continue monitorando suas despesas!";
    }

    // Help
    if (q.includes('help') || q.includes('what')) {
      return "Aqui estão algumas coisas que você pode me perguntar:\n\n" +
        "• Quanto gastei com [categoria]?\n" +
        "• Qual é minha maior despesa?\n" +
        "• Quanto economizei este mês?\n" +
        "• Qual é meu resumo mensal?\n" +
        "• Estou acima do orçamento?\n" +
        "• Devo reduzir alguma coisa?";
    }

    // Default response
    return "Não tenho certeza se entendi. Tente perguntar sobre seus gastos, economias ou peça um resumo mensal!";
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
        <h1 className="text-2xl md:text-3xl font-bold gradient-text flex items-center gap-2">
          <Sparkles className="w-6 h-6" style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 8px rgba(124, 58, 237, 0.4))' }} />
          Assistente Financeiro IA
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>Pergunte qualquer coisa sobre suas finanças</p>
      </div>

      {/* Chat Container */}
      <div className="flex-1 glass-card-static overflow-hidden flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  background: message.role === 'assistant'
                    ? 'linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(6, 182, 212, 0.1))'
                    : 'var(--bg-input)',
                  border: '1px solid ' + (message.role === 'assistant' ? 'rgba(124, 58, 237, 0.2)' : 'var(--border-color)'),
                }}
              >
                {message.role === 'assistant' ? (
                  <Bot className="w-4 h-4" style={{ color: '#a78bfa' }} />
                ) : (
                  <User className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                )}
              </div>
              <div
                className="max-w-[80%] rounded-2xl p-4"
                style={{
                  background: message.role === 'assistant'
                    ? 'linear-gradient(135deg, rgba(124, 58, 237, 0.08), rgba(6, 182, 212, 0.04))'
                    : 'var(--bg-card)',
                  border: '1px solid ' + (message.role === 'assistant' ? 'rgba(124, 58, 237, 0.12)' : 'var(--border-color)'),
                }}
              >
                <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                  {message.content}
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(6, 182, 212, 0.1))',
                  border: '1px solid rgba(124, 58, 237, 0.2)',
                }}
              >
                <Bot className="w-4 h-4" style={{ color: '#a78bfa' }} />
              </div>
              <div
                className="rounded-2xl p-4"
                style={{
                  background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.08), rgba(6, 182, 212, 0.04))',
                  border: '1px solid rgba(124, 58, 237, 0.12)',
                }}
              >
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#a78bfa' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4" style={{ borderTop: '1px solid var(--border-color)' }}>
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pergunte sobre suas finanças..."
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
        {[
          { label: 'Resumo Mensal', icon: '���' },
          { label: 'Maior Despesa', icon: '🔝' },
          { label: 'Status do Orçamento', icon: '💰' },
          { label: 'Economias', icon: '✅' },
        ].map((q) => (
          <button
            key={q.label}
            onClick={() => setInput(
              q.label === 'Resumo Mensal' ? "Qual é meu resumo mensal?" :
              q.label === 'Maior Despesa' ? "Qual é minha maior despesa?" :
              q.label === 'Status do Orçamento' ? "Estou acima do orçamento?" :
              "Quanto economizei este mês?"
            )}
            className="px-4 py-2 rounded-full text-sm font-medium transition-all"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.3)';
              e.currentTarget.style.background = 'rgba(124, 58, 237, 0.08)';
              e.currentTarget.style.color = '#c4b5fd';
              e.currentTarget.style.boxShadow = '0 0 15px rgba(124, 58, 237, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.background = 'var(--bg-card)';
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {q.icon} {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}

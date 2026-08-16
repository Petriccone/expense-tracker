export const metadata = {
  title: 'Terms of Service — Expense Tracker',
};

export default function TermsPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px', lineHeight: 1.6 }}>
      <h1>Terms of Service</h1>
      <p><em>Last updated: 15 August 2026</em></p>

      <p>
        Expense Tracker is a private, personal budgeting application operated by Rafael Pietroni
        for his own household use. By using it you agree to these terms.
      </p>

      <h2>Personal use</h2>
      <p>
        The app is provided for the operator&apos;s own household budgeting. You connect only
        accounts that you are entitled to access, and you are responsible for the accounts and
        consents you authorise.
      </p>

      <h2>Bank connections</h2>
      <p>
        Bank account information is accessed read-only through <strong>Enable Banking Oy</strong>,
        a regulated Account Information Service Provider, under a consent you grant to your bank.
        The app cannot move money or make payments; it only reads account and transaction data to
        display your budget.
      </p>

      <h2>No warranty; no financial advice</h2>
      <p>
        The app is provided &quot;as is&quot;, without warranty of any kind. Budget figures are for
        your own information only and do not constitute financial advice. The operator is not
        liable for any loss arising from use of the app or from inaccuracies in imported data.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href="mailto:rafa.pietroni@gmail.com">rafa.pietroni@gmail.com</a>.
      </p>
    </main>
  );
}

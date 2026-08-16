export const metadata = {
  title: 'Privacy Policy — Expense Tracker',
};

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px', lineHeight: 1.6 }}>
      <h1>Privacy Policy</h1>
      <p><em>Last updated: 15 August 2026</em></p>

      <p>
        Expense Tracker is a private, personal budgeting application operated by Rafael Pietroni
        for his own household use. This page explains what data the app handles and how.
      </p>

      <h2>What data we access</h2>
      <p>
        With your explicit consent, the app connects to your own bank account(s) through
        <strong> Enable Banking Oy</strong>, a regulated Account Information Service Provider
        (AISP) supervised by the Finnish Financial Supervisory Authority. It reads account and
        transaction information (amounts, dates, descriptions and counterparty names) on a
        read-only basis, solely to show your budget inside the app. The app never receives or
        stores your bank login credentials — those stay with your bank and Enable Banking.
      </p>

      <h2>How we use it</h2>
      <p>
        Transaction data is used only to display and categorise your household budget within this
        app. It is stored privately on the operator&apos;s own server and is not sold, shared,
        advertised against, or disclosed to any third party.
      </p>

      <h2>Your control</h2>
      <p>
        You may revoke the app&apos;s access to your bank data at any time through your bank or the
        Enable Banking consent, and you may request deletion of any imported data. Bank consent is
        time-limited and must be renewed periodically (roughly every 180 days) under PSD2.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy: <a href="mailto:rafa.pietroni@gmail.com">rafa.pietroni@gmail.com</a>.
      </p>
    </main>
  );
}

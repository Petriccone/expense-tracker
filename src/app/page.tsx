import { redirect } from 'next/navigation';

// Budget is the app's primary landing now — see
// docs/2026-08-15-budget-model-redesign-design.md.
export default function Home() {
  redirect('/budget');
}

// Only the signed-in account avatar label; never inspect forms, cookies, page text or tokens.
(() => {
  if (location.protocol !== 'https:' || !['accounts.google.com', 'myaccount.google.com', 'mail.google.com'].includes(location.hostname)) return '';
  const avatar = document.querySelector('[aria-label^="Google Account:"]');
  const label = avatar?.getAttribute('aria-label') ?? '';
  const match = label.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match?.[0] ?? '';
})()

/**
 * Transactions Page Entry Point
 */
import { createRoot } from '@wordpress/element';
import TransactionsPage from './TransactionsPage';

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
	const rootElement = document.getElementById(
		'fair-payment-transactions-root'
	);

	if (rootElement) {
		const root = createRoot(rootElement);
		root.render(<TransactionsPage />);
	}
});

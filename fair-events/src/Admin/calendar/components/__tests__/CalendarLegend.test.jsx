/**
 * @jest-environment jsdom
 *
 * Tests for CalendarLegend (#1052).
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import CalendarLegend from '../CalendarLegend.js';

it('renders all four link-type variants with their labels and classes', () => {
	const { container } = render(<CalendarLegend />);

	expect(screen.getByText('Public page')).toBeInTheDocument();
	expect(screen.getByText('Series occurrence')).toBeInTheDocument();
	expect(screen.getByText('External page')).toBeInTheDocument();
	expect(screen.getByText('No public page yet')).toBeInTheDocument();

	expect(
		container.querySelector('.link-type-post .dashicons-admin-post')
	).toBeInTheDocument();
	expect(
		container.querySelector('.link-type-instance .dashicons-update')
	).toBeInTheDocument();
	expect(
		container.querySelector('.link-type-external .dashicons-admin-links')
	).toBeInTheDocument();
	expect(
		container.querySelector('.link-type-unlinked .dashicons-editor-unlink')
	).toBeInTheDocument();
});

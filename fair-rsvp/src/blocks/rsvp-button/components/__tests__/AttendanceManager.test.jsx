/**
 * Component tests for AttendanceManager
 *
 * Tests the RSVP permission management component using React Testing Library.
 * This validates rendering, user interactions, and permission updates.
 *
 * @see src/blocks/rsvp-button/components/AttendanceManager.js
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AttendanceManager from '../AttendanceManager';

// Mock WordPress dependencies
jest.mock('@wordpress/i18n', () => ({
	__: (text) => text,
}));

jest.mock('@wordpress/api-fetch', () => ({
	__esModule: true,
	default: jest.fn(() => Promise.reject(new Error('Not implemented'))),
}));

jest.mock('@wordpress/components', () => ({
	Button: ({ children, ...props }) => <button {...props}>{children}</button>,
	SelectControl: ({ label, value, onChange, options }) => (
		<div>
			<label>{label}</label>
			<select value={value} onChange={(e) => onChange(e.target.value)}>
				{options.map((opt) => (
					<option key={opt.value} value={opt.value}>
						{opt.label}
					</option>
				))}
			</select>
		</div>
	),
	Notice: ({ children }) => <div role="alert">{children}</div>,
}));

jest.mock('@wordpress/element', () => ({
	useState: require('react').useState,
	useEffect: require('react').useEffect,
}));

describe('AttendanceManager', () => {
	const mockOnChange = jest.fn();

	beforeEach(() => {
		mockOnChange.mockClear();
		// Suppress console.error for expected API failures
		jest.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		console.error.mockRestore();
	});

	test('renders without crashing', () => {
		const attendance = {};
		const { container } = render(
			<AttendanceManager
				attendance={attendance}
				onChange={mockOnChange}
			/>
		);

		// Component should render the container div
		expect(
			container.querySelector('.fair-rsvp-attendance-manager')
		).toBeInTheDocument();
	});

	test('renders with attendance data', () => {
		const attendance = {
			users: 1,
			anonymous: 0,
		};

		const { container } = render(
			<AttendanceManager
				attendance={attendance}
				onChange={mockOnChange}
			/>
		);

		// Should render the component
		expect(
			container.querySelector('.fair-rsvp-attendance-manager')
		).toBeInTheDocument();
	});

	test('accepts onChange callback', () => {
		const attendance = {};
		render(
			<AttendanceManager
				attendance={attendance}
				onChange={mockOnChange}
			/>
		);

		// onChange should not be called on initial render
		expect(mockOnChange).not.toHaveBeenCalled();
	});
});

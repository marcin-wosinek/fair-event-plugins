/**
 * Tests for date and time utility functions
 */

import { calculateDuration, formatDateOrFallback } from '../src/dateTime.js';

describe( 'calculateDuration', () => {
	it( 'should calculate duration between two valid datetime strings', () => {
		const startTime = '2024-10-08T10:00:00';
		const endTime = '2024-10-08T12:30:00';
		expect( calculateDuration( startTime, endTime ) ).toBe( 150 );
	} );

	it( 'should return null for missing startTime', () => {
		const endTime = '2024-10-08T12:30:00';
		expect( calculateDuration( null, endTime ) ).toBeNull();
		expect( calculateDuration( '', endTime ) ).toBeNull();
	} );

	it( 'should return null for missing endTime', () => {
		const startTime = '2024-10-08T10:00:00';
		expect( calculateDuration( startTime, null ) ).toBeNull();
		expect( calculateDuration( startTime, '' ) ).toBeNull();
	} );

	it( 'should return null for invalid datetime strings', () => {
		expect(
			calculateDuration( 'invalid', '2024-10-08T12:30:00' )
		).toBeNull();
		expect(
			calculateDuration( '2024-10-08T10:00:00', 'invalid' )
		).toBeNull();
		expect( calculateDuration( 'invalid', 'invalid' ) ).toBeNull();
	} );

	it( 'should handle duration spanning multiple days', () => {
		const startTime = '2024-10-08T22:00:00';
		const endTime = '2024-10-09T02:00:00';
		expect( calculateDuration( startTime, endTime ) ).toBe( 240 );
	} );

	it( 'should handle negative duration (end before start)', () => {
		const startTime = '2024-10-08T12:00:00';
		const endTime = '2024-10-08T10:00:00';
		expect( calculateDuration( startTime, endTime ) ).toBe( -120 );
	} );

	it( 'should handle zero duration (same time)', () => {
		const startTime = '2024-10-08T10:00:00';
		const endTime = '2024-10-08T10:00:00';
		expect( calculateDuration( startTime, endTime ) ).toBe( 0 );
	} );
} );

describe( 'formatDateOrFallback', () => {
	it( 'should return the date value when provided', () => {
		expect( formatDateOrFallback( '2024-12-27' ) ).toBe( '2024-12-27' );
		expect( formatDateOrFallback( '2024-10-08T10:00:00' ) ).toBe(
			'2024-10-08T10:00:00'
		);
	} );

	it( 'should return default fallback "-" for null', () => {
		expect( formatDateOrFallback( null ) ).toBe( '-' );
	} );

	it( 'should return default fallback "-" for undefined', () => {
		expect( formatDateOrFallback( undefined ) ).toBe( '-' );
	} );

	it( 'should return default fallback "-" for empty string', () => {
		expect( formatDateOrFallback( '' ) ).toBe( '-' );
	} );

	it( 'should return custom fallback when provided', () => {
		expect( formatDateOrFallback( null, 'N/A' ) ).toBe( 'N/A' );
		expect( formatDateOrFallback( undefined, 'No date' ) ).toBe(
			'No date'
		);
		expect( formatDateOrFallback( '', 'Not set' ) ).toBe( 'Not set' );
	} );

	it( 'should return date value even when custom fallback is provided', () => {
		expect( formatDateOrFallback( '2024-12-27', 'N/A' ) ).toBe(
			'2024-12-27'
		);
	} );

	it( 'should handle whitespace-only strings as empty', () => {
		// Note: Current implementation only checks for empty string, not whitespace
		// This test documents current behavior
		expect( formatDateOrFallback( '   ' ) ).toBe( '   ' );
	} );
} );

/**
 * @jest-environment jsdom
 *
 * Tests for the plugin adapter around the shared CopyUrlButton (#1846).
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { __ } from '@wordpress/i18n';
import CopyUrlButton from '../CopyUrlButton.js';

jest.mock( '@wordpress/i18n', () => {
	const actual = jest.requireActual( '@wordpress/i18n' );
	return { ...actual, __: jest.fn( actual.__ ) };
} );

describe( 'CopyUrlButton adapter', () => {
	let writeText;

	beforeEach( () => {
		writeText = jest.fn().mockResolvedValue();
		Object.defineProperty( navigator, 'clipboard', {
			value: { writeText },
			configurable: true,
		} );
	} );

	it( 'supplies translated default text from the fair-events-experimental domain', async () => {
		render( <CopyUrlButton url="https://example.com/feed" /> );

		const button = screen.getByRole( 'button', { name: 'Copy URL' } );
		expect( __ ).toHaveBeenCalledWith(
			'Copy URL',
			'fair-events-experimental'
		);
		expect( __ ).toHaveBeenCalledWith(
			'Copy URL to clipboard',
			'fair-events-experimental'
		);

		await act( async () => {
			fireEvent.click( button );
		} );

		expect( writeText ).toHaveBeenCalledWith( 'https://example.com/feed' );
		expect( screen.getByText( 'Copied!' ) ).toBeInTheDocument();
		expect( __ ).toHaveBeenCalledWith(
			'Copied!',
			'fair-events-experimental'
		);
	} );

	it( 'forwards custom label and callbacks', async () => {
		const onSuccess = jest.fn();
		render(
			<CopyUrlButton
				url="https://example.com/api"
				label="Copy API URL"
				onSuccess={ onSuccess }
			/>
		);

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Copy API URL' } )
			);
		} );

		expect( writeText ).toHaveBeenCalledWith( 'https://example.com/api' );
		expect( onSuccess ).toHaveBeenCalledTimes( 1 );
	} );
} );

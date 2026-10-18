/**
 * @jest-environment jsdom
 *
 * Component tests for the shared URL-copy button used by Fair Events and
 * Fair Events Experimental admin screens (#1846).
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CopyUrlButton from '../CopyUrlButton.js';

const TEXT = {
	label: 'Copy URL',
	tooltip: 'Copy URL to clipboard',
	copiedLabel: 'Copied!',
};

function setClipboard( writeText ) {
	Object.defineProperty( navigator, 'clipboard', {
		value: writeText ? { writeText } : undefined,
		configurable: true,
	} );
}

async function click( button ) {
	await act( async () => {
		fireEvent.click( button );
	} );
}

describe( 'CopyUrlButton', () => {
	beforeEach( () => {
		jest.useFakeTimers();
	} );

	afterEach( () => {
		jest.useRealTimers();
		setClipboard( undefined );
	} );

	it( 'copies the exact URL and confirms only after the clipboard resolves', async () => {
		let resolveWrite;
		const writeText = jest.fn(
			() =>
				new Promise( ( resolve ) => {
					resolveWrite = resolve;
				} )
		);
		setClipboard( writeText );
		const onSuccess = jest.fn();

		render(
			<CopyUrlButton
				{ ...TEXT }
				url="https://example.com/feed.ics"
				onSuccess={ onSuccess }
			/>
		);

		await click( screen.getByRole( 'button', { name: 'Copy URL' } ) );

		expect( writeText ).toHaveBeenCalledWith(
			'https://example.com/feed.ics'
		);
		expect( screen.queryByText( 'Copied!' ) ).not.toBeInTheDocument();
		expect( onSuccess ).not.toHaveBeenCalled();

		await act( async () => {
			resolveWrite();
		} );

		expect( screen.getByText( 'Copied!' ) ).toBeInTheDocument();
		expect( onSuccess ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'resets the confirmation after two seconds', async () => {
		setClipboard( jest.fn().mockResolvedValue() );
		render( <CopyUrlButton { ...TEXT } url="https://example.com" /> );

		await click( screen.getByRole( 'button' ) );
		expect( screen.getByText( 'Copied!' ) ).toBeInTheDocument();

		act( () => {
			jest.advanceTimersByTime( 1999 );
		} );
		expect( screen.getByText( 'Copied!' ) ).toBeInTheDocument();

		act( () => {
			jest.advanceTimersByTime( 1 );
		} );
		expect( screen.getByText( 'Copy URL' ) ).toBeInTheDocument();
	} );

	it( 'restarts the reset timer on a repeated successful copy', async () => {
		setClipboard( jest.fn().mockResolvedValue() );
		render( <CopyUrlButton { ...TEXT } url="https://example.com" /> );

		await click( screen.getByRole( 'button' ) );
		act( () => {
			jest.advanceTimersByTime( 1500 );
		} );
		await click( screen.getByRole( 'button' ) );
		act( () => {
			jest.advanceTimersByTime( 1500 );
		} );

		expect( screen.getByText( 'Copied!' ) ).toBeInTheDocument();

		act( () => {
			jest.advanceTimersByTime( 500 );
		} );
		expect( screen.getByText( 'Copy URL' ) ).toBeInTheDocument();
	} );

	it( 'calls onError without confirming when the clipboard rejects', async () => {
		const error = new Error( 'denied' );
		setClipboard( jest.fn().mockRejectedValue( error ) );
		const onSuccess = jest.fn();
		const onError = jest.fn();

		render(
			<CopyUrlButton
				{ ...TEXT }
				url="https://example.com"
				onSuccess={ onSuccess }
				onError={ onError }
			/>
		);

		await click( screen.getByRole( 'button' ) );

		expect( screen.queryByText( 'Copied!' ) ).not.toBeInTheDocument();
		expect( onError ).toHaveBeenCalledWith( error );
		expect( onSuccess ).not.toHaveBeenCalled();
	} );

	it( 'calls onError when clipboard support is missing', async () => {
		setClipboard( undefined );
		const onError = jest.fn();

		render(
			<CopyUrlButton
				{ ...TEXT }
				url="https://example.com"
				onError={ onError }
			/>
		);

		await click( screen.getByRole( 'button' ) );

		expect( screen.queryByText( 'Copied!' ) ).not.toBeInTheDocument();
		expect( onError ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'clears a stale confirmation when a later copy fails', async () => {
		const writeText = jest
			.fn()
			.mockResolvedValueOnce()
			.mockRejectedValueOnce( new Error( 'denied' ) );
		setClipboard( writeText );

		render( <CopyUrlButton { ...TEXT } url="https://example.com" /> );

		await click( screen.getByRole( 'button' ) );
		expect( screen.getByText( 'Copied!' ) ).toBeInTheDocument();

		await click( screen.getByRole( 'button' ) );
		expect( screen.queryByText( 'Copied!' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Copy URL' ) ).toBeInTheDocument();
	} );

	it( 'keeps confirmation state independent per control', async () => {
		const writeText = jest.fn().mockResolvedValue();
		setClipboard( writeText );

		render(
			<>
				<CopyUrlButton
					{ ...TEXT }
					label="iCal"
					url="https://example.com/feed.ics"
				/>
				<CopyUrlButton
					{ ...TEXT }
					label="JSON"
					url="https://example.com/feed.json"
				/>
			</>
		);

		await click( screen.getByRole( 'button', { name: 'JSON' } ) );

		expect( writeText ).toHaveBeenCalledWith(
			'https://example.com/feed.json'
		);
		expect( screen.getAllByText( 'Copied!' ) ).toHaveLength( 1 );
		expect(
			screen.getByRole( 'button', { name: 'iCal' } )
		).toBeInTheDocument();
	} );

	it( 'clears its timer on unmount', async () => {
		setClipboard( jest.fn().mockResolvedValue() );
		const { unmount } = render(
			<CopyUrlButton { ...TEXT } url="https://example.com" />
		);

		await click( screen.getByRole( 'button' ) );
		unmount();

		expect( jest.getTimerCount() ).toBe( 0 );
	} );
} );

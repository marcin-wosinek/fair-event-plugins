/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import useNotificationEditor, {
	reconcileDraft,
} from '../useNotificationEditor.js';

jest.mock( '@wordpress/api-fetch' );

const PATH = '/fair-events/v1/event-notifications';
const FIELDS = [ 'subject', 'time_of_day' ];

const ADAPTER = {
	fields: FIELDS,
	toForm: ( payload ) => ( {
		subject: payload.subject,
		time_of_day: payload.time_of_day,
	} ),
	toPayload: ( form ) => ( { ...form, subject: form.subject.trim() } ),
	problem: ( form ) =>
		'' === form.subject ? 'Subject is required.' : null,
	testNotice: ( response ) => ( {
		status: 'success',
		message: `Sent to ${ response.sent_to }.`,
	} ),
	messages: {
		saved: 'Saved.',
		saveFailed: 'Could not save.',
		testFailed: 'Could not test.',
	},
};

function channel( overrides ) {
	return {
		id: 'sample',
		subject: 'Weekly',
		time_of_day: '08:00',
		...overrides,
	};
}

function deferred() {
	let resolve;
	const promise = new Promise( ( yes ) => {
		resolve = yes;
	} );
	return { promise, resolve };
}

function renderEditor( initial = channel(), onSaved = jest.fn() ) {
	return renderHook(
		( props ) =>
			useNotificationEditor( {
				adapter: ADAPTER,
				onSaved,
				...props,
			} ),
		{ initialProps: { channel: initial } }
	);
}

afterEach( () => {
	jest.resetAllMocks();
} );

describe( 'reconcileDraft', () => {
	const saved = { subject: 'A', time_of_day: '08:00' };
	const other = { subject: 'B', time_of_day: '08:00' };

	it( 'moves a clean draft to the new saved settings', () => {
		expect(
			reconcileDraft(
				FIELDS,
				{ form: saved, baseline: saved, conflict: false },
				other
			)
		).toEqual( { form: other, baseline: other, conflict: false } );
	} );

	it( 'keeps a dirty draft and its baseline, and flags the change', () => {
		const form = { subject: 'Mine', time_of_day: '08:00' };
		expect(
			reconcileDraft(
				FIELDS,
				{ form, baseline: saved, conflict: false },
				other
			)
		).toEqual( { form, baseline: saved, conflict: true } );
	} );

	it( 'treats a draft equal to the new saved settings as clean', () => {
		expect(
			reconcileDraft(
				FIELDS,
				{ form: other, baseline: saved, conflict: false },
				other
			)
		).toEqual( { form: other, baseline: other, conflict: false } );
	} );

	it( 'leaves a draft alone when the saved settings did not move', () => {
		const current = {
			form: { subject: 'Mine', time_of_day: '08:00' },
			baseline: saved,
			conflict: false,
		};
		expect( reconcileDraft( FIELDS, current, { ...saved } ) ).toBe(
			current
		);
	} );
} );

describe( 'useNotificationEditor', () => {
	it( 'sends one save for a double submit and normalizes the payload', async () => {
		const request = deferred();
		apiFetch.mockReturnValue( request.promise );
		const onSaved = jest.fn();
		const { result } = renderEditor( channel(), onSaved );

		act( () => result.current.setField( 'subject', ' Next ' ) );
		let first;
		act( () => {
			first = result.current.save();
			result.current.save();
		} );

		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: `${ PATH }/configurations/sample`,
			method: 'POST',
			data: { subject: 'Next', time_of_day: '08:00' },
		} );
		expect( result.current.pending.save ).toBe( true );

		await act( async () => {
			request.resolve( channel( { subject: 'Next' } ) );
			await first;
		} );

		expect( onSaved ).toHaveBeenCalledWith(
			'sample',
			channel( { subject: 'Next' } )
		);
		expect( result.current.form.subject ).toBe( 'Next' );
		expect( result.current.dirty ).toBe( false );
		expect( result.current.pending.save ).toBe( false );
		expect( result.current.notice ).toEqual( {
			status: 'success',
			message: 'Saved.',
		} );
	} );

	it( 'refuses to save a draft with a problem', async () => {
		const { result } = renderEditor();

		act( () => result.current.setField( 'subject', '' ) );
		expect( result.current.problem ).toBe( 'Subject is required.' );
		await act( () => result.current.save() );

		expect( apiFetch ).not.toHaveBeenCalled();
		expect( result.current.dirty ).toBe( true );
	} );

	it( 'reports a failed test with the fallback message', async () => {
		apiFetch.mockRejectedValue( {} );
		const { result } = renderEditor();

		await act( () => result.current.sendTest() );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: `${ PATH }/configurations/sample/test`,
			method: 'POST',
		} );
		expect( result.current.notice ).toEqual( {
			status: 'error',
			message: 'Could not test.',
		} );
		expect( result.current.pending.test ).toBe( false );
	} );

	it( 'does not save while a test is being sent', async () => {
		const request = deferred();
		apiFetch.mockReturnValue( request.promise );
		const { result } = renderEditor();

		act( () => {
			result.current.sendTest();
		} );
		await act( () => result.current.save() );

		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		await act( async () => {
			request.resolve( { sent_to: 'admin@example.test' } );
		} );
		expect( result.current.testResult ).toEqual( {
			sent_to: 'admin@example.test',
		} );
		expect( result.current.notice.message ).toBe(
			'Sent to admin@example.test.'
		);
	} );

	it( 'drops a preview requested before the saved settings changed', async () => {
		const request = deferred();
		apiFetch.mockReturnValue( request.promise );
		const { result, rerender } = renderEditor();

		act( () => {
			result.current.loadPreview();
		} );
		rerender( { channel: channel( { time_of_day: '09:00' } ) } );
		expect( result.current.form.time_of_day ).toBe( '09:00' );

		await act( async () => {
			request.resolve( { subject: 'Stale' } );
		} );

		expect( result.current.preview ).toBeNull();
		expect( result.current.pending.preview ).toBe( false );
	} );

	it( 'shows a conflict only while the draft differs', () => {
		const { result, rerender } = renderEditor();

		act( () => result.current.setField( 'subject', 'Mine' ) );
		rerender( { channel: channel( { subject: 'Theirs' } ) } );
		expect( result.current.conflict ).toBe( true );
		expect( result.current.saved.subject ).toBe( 'Weekly' );

		// Typing the original value back follows the newer saved settings.
		act( () => result.current.setField( 'subject', 'Weekly' ) );
		expect( result.current.dirty ).toBe( false );
		expect( result.current.conflict ).toBe( false );
		expect( result.current.form.subject ).toBe( 'Theirs' );
	} );
} );

/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import { useEffect, useRef, useState } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { PATH, errorMessage, useUnsavedWarning } from './shared.js';

function sameForm( fields, a, b ) {
	return fields.every( ( field ) => a[ field ] === b[ field ] );
}

/**
 * Bring a draft up to date with saved settings read from the server.
 *
 * A clean draft follows the saved settings. A dirty draft keeps its values
 * and the baseline it started from, and is flagged when the saved settings
 * moved away from that baseline, so saving would replace someone else's
 * change.
 *
 * @param {Array}  fields  Editable fields.
 * @param {Object} current Draft state: `form`, `baseline` and `conflict`.
 * @param {Object} saved   Editable state of the saved settings.
 * @return {Object} Next draft state.
 */
export function reconcileDraft( fields, current, saved ) {
	if ( sameForm( fields, current.baseline, saved ) ) {
		return current.conflict ? { ...current, conflict: false } : current;
	}
	if (
		sameForm( fields, current.form, saved ) ||
		sameForm( fields, current.form, current.baseline )
	) {
		return { form: saved, baseline: saved, conflict: false };
	}
	return current.conflict ? current : { ...current, conflict: true };
}

/**
 * Draft, save, preview and test lifecycle of one notification configuration.
 *
 * Every call keeps its own state, so editing, saving or previewing one
 * configuration never touches another one's draft or requests, also when
 * both are of the same kind. Requests go to the configuration's own routes,
 * by its ID.
 *
 * @param {Object}   props
 * @param {Object}   props.channel             Saved configuration payload, with its `id`.
 * @param {Object}   props.adapter             What differs per kind.
 * @param {Array}    props.adapter.fields      Editable fields.
 * @param {Function} props.adapter.toForm      Channel payload to editable state.
 * @param {Function} [props.adapter.toPayload] Editable state to request data.
 * @param {Function} [props.adapter.problem]   Why the draft cannot be saved, or null.
 * @param {Function} props.adapter.testNotice  Test response to a notice.
 * @param {Object}   props.adapter.messages    Save and test messages.
 * @param {Function} props.onSaved             Receives the ID and the saved configuration payload.
 * @return {Object} Draft, derived state and actions.
 */
export default function useNotificationEditor( { channel, adapter, onSaved } ) {
	const { fields, toForm, messages } = adapter;
	const { id } = channel;
	const route = `${ PATH }/configurations/${ id }`;
	const saved = toForm( channel );
	const savedKey = JSON.stringify(
		fields.map( ( field ) => saved[ field ] )
	);
	const latestSaved = useRef( saved );
	latestSaved.current = saved;

	const [ draft, setDraft ] = useState( () => ( {
		form: saved,
		baseline: saved,
		conflict: false,
	} ) );
	const [ notice, setNotice ] = useState( null );
	const [ pending, setPending ] = useState( {
		save: false,
		preview: false,
		test: false,
	} );
	const [ preview, setPreview ] = useState( null );
	const [ testResult, setTestResult ] = useState( null );

	// Guards against a double click firing before the re-render.
	const busy = useRef( { save: false, preview: false, test: false } );
	// Bumped whenever a preview stops describing the saved settings.
	const previewRequest = useRef( 0 );

	useEffect( () => {
		setDraft( ( current ) =>
			reconcileDraft( fields, current, latestSaved.current )
		);
		previewRequest.current++;
		setPreview( null );
	}, [ savedKey, fields ] );

	const dirty = ! sameForm( fields, draft.form, draft.baseline );
	const problem = adapter.problem ? adapter.problem( draft.form ) : null;
	useUnsavedWarning( dirty );

	const start = ( action ) => {
		busy.current[ action ] = true;
		setPending( ( current ) => ( { ...current, [ action ]: true } ) );
	};
	const finish = ( action ) => {
		busy.current[ action ] = false;
		setPending( ( current ) => ( { ...current, [ action ]: false } ) );
	};

	// A draft edited back to its baseline follows the latest saved settings.
	const setField = ( field, value ) =>
		setDraft( ( current ) =>
			reconcileDraft(
				fields,
				{ ...current, form: { ...current.form, [ field ]: value } },
				latestSaved.current
			)
		);

	const save = async () => {
		if ( busy.current.save || busy.current.test || problem ) {
			return;
		}
		const submitted = draft.form;
		start( 'save' );
		setNotice( null );
		try {
			const savedChannel = await apiFetch( {
				path: route,
				method: 'POST',
				data: adapter.toPayload
					? adapter.toPayload( submitted )
					: submitted,
			} );
			const savedForm = toForm( savedChannel );
			// Edits typed while the request ran stay in the draft.
			setDraft( ( current ) => ( {
				form: sameForm( fields, current.form, submitted )
					? savedForm
					: current.form,
				baseline: savedForm,
				conflict: false,
			} ) );
			onSaved( id, savedChannel );
			setNotice( { status: 'success', message: messages.saved } );
		} catch ( error ) {
			setNotice( {
				status: 'error',
				message: errorMessage( error, messages.saveFailed ),
			} );
		}
		finish( 'save' );
	};

	const loadPreview = async () => {
		if ( busy.current.preview ) {
			return;
		}
		const request = ++previewRequest.current;
		start( 'preview' );
		let next;
		try {
			next = await apiFetch( { path: `${ route }/preview` } );
		} catch ( error ) {
			next = {
				error: errorMessage(
					error,
					__( 'Failed to build the preview.', 'fair-events' )
				),
			};
		}
		if ( request === previewRequest.current ) {
			setPreview( next );
		}
		finish( 'preview' );
	};

	const sendTest = async () => {
		if ( busy.current.test || busy.current.save ) {
			return;
		}
		start( 'test' );
		setTestResult( null );
		setNotice( null );
		try {
			const response = await apiFetch( {
				path: `${ route }/test`,
				method: 'POST',
			} );
			setTestResult( response );
			setNotice( adapter.testNotice( response ) );
		} catch ( error ) {
			setNotice( {
				status: 'error',
				message: errorMessage( error, messages.testFailed ),
			} );
		}
		finish( 'test' );
	};

	return {
		form: draft.form,
		saved: draft.baseline,
		conflict: dirty && draft.conflict,
		dirty,
		problem,
		notice,
		dismissNotice: () => setNotice( null ),
		pending,
		preview,
		testResult,
		setField,
		save,
		loadPreview,
		sendTest,
	};
}

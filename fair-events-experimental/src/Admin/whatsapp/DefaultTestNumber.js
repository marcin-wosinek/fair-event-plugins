import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import { useEffect, useRef, useState } from '@wordpress/element';
import {
	Button,
	Flex,
	FlexItem,
	Notice,
	TextControl,
} from '@wordpress/components';

const PATH = '/fair-events-experimental/v1/whatsapp/test-recipient';

/**
 * The message of a failed request, or a fallback when it carries none.
 *
 * @param {Object} error    apiFetch error.
 * @param {string} fallback Message to use otherwise.
 * @return {string} Message.
 */
function errorMessage( error, fallback ) {
	// An invalid number is reported per parameter, under a generic message.
	const invalid = error?.data?.params?.recipient;
	if ( typeof invalid === 'string' && invalid ) {
		return invalid;
	}
	return typeof error?.message === 'string' && error?.code
		? error.message
		: fallback;
}

/**
 * The administrator's own default number for test sends. It only fills in
 * the recipient when the page opens: saving or clearing it never sends a
 * message and never changes the recipient currently shown.
 *
 * @param {Object}   props
 * @param {Function} props.onLoaded Receives the saved number ('' for none)
 *                                  once, when it first loads.
 * @return {Element} The default number field and its actions.
 */
export default function DefaultTestNumber( { onLoaded } ) {
	const [ state, setState ] = useState( 'loading' );
	const [ saved, setSaved ] = useState( '' );
	const [ draft, setDraft ] = useState( '' );
	const [ saving, setSaving ] = useState( false );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );
	const savingRef = useRef( false );
	const onLoadedRef = useRef( onLoaded );
	onLoadedRef.current = onLoaded;

	useEffect( () => {
		let active = true;
		apiFetch( { path: PATH } )
			.then( ( response ) => {
				if ( ! active ) {
					return;
				}
				const number = response?.recipient || '';
				setSaved( number );
				// Keep anything typed while the number was loading.
				setDraft( ( current ) => current || number );
				setState( 'ready' );
				onLoadedRef.current( number );
			} )
			.catch( () => {
				if ( active ) {
					setState( 'error' );
				}
			} );
		return () => {
			active = false;
		};
	}, [] );

	const dirty = 'loading' !== state && draft.trim() !== saved;
	useEffect( () => {
		if ( ! dirty ) {
			return undefined;
		}
		const warn = ( event ) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener( 'beforeunload', warn );
		return () => window.removeEventListener( 'beforeunload', warn );
	}, [ dirty ] );

	const write = async ( value, message ) => {
		if ( savingRef.current ) {
			return;
		}
		savingRef.current = true;
		setSaving( true );
		setError( null );
		setSuccess( null );
		try {
			const response = await apiFetch( {
				path: PATH,
				method: 'POST',
				data: { recipient: value },
			} );
			const number = response?.recipient || '';
			setSaved( number );
			setDraft( number );
			setState( 'ready' );
			setSuccess( message );
		} catch ( failure ) {
			// The field keeps what was typed; the saved number is unchanged.
			setError(
				errorMessage(
					failure,
					__(
						'The default test number could not be saved.',
						'fair-events-experimental'
					)
				)
			);
		}
		savingRef.current = false;
		setSaving( false );
	};

	let saveBlocker = null;
	if ( 'loading' === state ) {
		saveBlocker = __(
			'Loading your default test number…',
			'fair-events-experimental'
		);
	} else if ( ! draft.trim() ) {
		saveBlocker = saved
			? __(
					'Enter a number to save, or clear your default test number.',
					'fair-events-experimental'
				)
			: __(
					'Enter a number to save it as your default.',
					'fair-events-experimental'
				);
	} else if ( ! dirty ) {
		saveBlocker = __( 'No unsaved changes.', 'fair-events-experimental' );
	}

	return (
		<div
			style={ {
				borderTop: '1px solid #e0e0e0',
				marginTop: '24px',
				paddingTop: '16px',
			} }
		>
			<h3 style={ { marginTop: 0 } }>
				{ __( 'My default test number', 'fair-events-experimental' ) }
			</h3>
			<p>
				{ __(
					'Fills in the recipient number each time you open this page. Only you can see it. Saving it sends nothing, and each test still needs your confirmation.',
					'fair-events-experimental'
				) }
			</p>
			{ 'error' === state && (
				<Notice status="error" isDismissible={ false }>
					{ __(
						'Your default test number could not be loaded. You can still enter the recipient number by hand.',
						'fair-events-experimental'
					) }
				</Notice>
			) }
			<TextControl
				__nextHasNoMarginBottom
				__next40pxDefaultSize
				label={ __(
					'My default test number',
					'fair-events-experimental'
				) }
				help={ __(
					'International format with the country code, such as +34 600 123 456.',
					'fair-events-experimental'
				) }
				type="tel"
				autoComplete="off"
				value={ draft }
				disabled={ saving || 'loading' === state }
				onChange={ ( value ) => {
					setDraft( value );
					setSuccess( null );
				} }
			/>
			<Flex
				wrap
				justify="flex-start"
				gap={ 2 }
				style={ { marginTop: '16px' } }
			>
				<FlexItem>
					<Button
						variant="secondary"
						onClick={ () =>
							write(
								draft.trim(),
								__(
									'Default test number saved. It fills in the recipient next time you open this page.',
									'fair-events-experimental'
								)
							)
						}
						isBusy={ saving }
						disabled={ saving || !! saveBlocker }
					>
						{ __(
							'Save default number',
							'fair-events-experimental'
						) }
					</Button>
				</FlexItem>
				{ !! saved && (
					<FlexItem>
						<Button
							variant="tertiary"
							onClick={ () =>
								write(
									'',
									__(
										'Default test number cleared.',
										'fair-events-experimental'
									)
								)
							}
							disabled={ saving }
						>
							{ __(
								'Clear default number',
								'fair-events-experimental'
							) }
						</Button>
					</FlexItem>
				) }
			</Flex>
			{ saveBlocker && 'loading' !== state && (
				<p className="description">{ saveBlocker }</p>
			) }
			{ dirty && (
				<p className="description">
					{ __(
						'Unsaved changes to your default test number.',
						'fair-events-experimental'
					) }
				</p>
			) }
			<div role="status" style={ { marginTop: '8px' } }>
				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) }
				{ success && (
					<Notice status="success" isDismissible={ false }>
						{ success }
					</Notice>
				) }
			</div>
		</div>
	);
}

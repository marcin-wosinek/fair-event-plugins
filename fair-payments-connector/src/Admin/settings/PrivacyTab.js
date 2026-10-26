/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect, useCallback, useRef } from '@wordpress/element';
import {
	Card,
	CardBody,
	ToggleControl,
	Button,
	Notice,
	Spinner,
} from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import { saveConnectorSettings } from './settings-api.js';

const SHARE_EMAIL_SETTING = 'fair_payment_share_ticket_buyer_email';

/**
 * Privacy Tab Component
 *
 * Lets the admin decide whether Fair Events ticket payments send the
 * buyer's email to the payment provider.
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying notices
 * @return {JSX.Element} The privacy tab
 */
export default function PrivacyTab( { onNotice } ) {
	const [ savedShareEmail, setSavedShareEmail ] = useState( null );
	const [ shareEmail, setShareEmail ] = useState( false );
	const [ loadError, setLoadError ] = useState( null );
	const [ saveError, setSaveError ] = useState( null );
	const [ isSaving, setIsSaving ] = useState( false );
	const savingRef = useRef( false );

	const loading = savedShareEmail === null && ! loadError;
	const isDirty = savedShareEmail !== null && shareEmail !== savedShareEmail;

	const load = useCallback( () => {
		setLoadError( null );
		apiFetch( { path: '/wp/v2/settings' } )
			.then( ( settings ) => {
				const value = settings[ SHARE_EMAIL_SETTING ] === true;
				setSavedShareEmail( value );
				setShareEmail( value );
			} )
			.catch( ( err ) => {
				setLoadError(
					err.message ||
						__(
							'Failed to load privacy settings.',
							'fair-payments-connector'
						)
				);
			} );
	}, [] );

	useEffect( load, [ load ] );

	useEffect( () => {
		if ( ! isDirty ) {
			return undefined;
		}
		const warn = ( event ) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener( 'beforeunload', warn );
		return () => window.removeEventListener( 'beforeunload', warn );
	}, [ isDirty ] );

	const handleSave = async () => {
		if ( savingRef.current ) {
			return;
		}
		savingRef.current = true;
		setIsSaving( true );
		setSaveError( null );
		try {
			await saveConnectorSettings( {
				[ SHARE_EMAIL_SETTING ]: shareEmail,
			} );
			setSavedShareEmail( shareEmail );
			onNotice( {
				status: 'success',
				message: __(
					'Privacy settings saved.',
					'fair-payments-connector'
				),
			} );
		} catch ( err ) {
			setSaveError(
				err.message ||
					__(
						'Failed to save privacy settings. Please try again.',
						'fair-payments-connector'
					)
			);
		} finally {
			savingRef.current = false;
			setIsSaving( false );
		}
	};

	if ( loading ) {
		return <Spinner />;
	}

	if ( loadError ) {
		return (
			<Notice status="error" isDismissible={ false }>
				<p>{ loadError }</p>
				<Button variant="secondary" onClick={ load }>
					{ __( 'Try again', 'fair-payments-connector' ) }
				</Button>
			</Notice>
		);
	}

	return (
		<Card>
			<CardBody>
				<h2>{ __( 'Payment provider', 'fair-payments-connector' ) }</h2>

				<ToggleControl
					__nextHasNoMarginBottom
					label={ __(
						'Send ticket buyers’ emails to the payment provider',
						'fair-payments-connector'
					) }
					help={ __(
						'Include the buyer’s email in payment metadata to help reconcile Fair Events ticket payments. Enabling this sends personal data to the external payment provider. Your choice applies to future payment attempts, including retries. It does not change data already held by a provider. Buyer emails remain stored locally for registration management and messages.',
						'fair-payments-connector'
					) }
					checked={ shareEmail }
					onChange={ setShareEmail }
					disabled={ isSaving }
				/>

				{ saveError && (
					<div style={ { marginTop: '16px' } }>
						<Notice status="error" isDismissible={ false }>
							{ saveError }
						</Notice>
					</div>
				) }

				<div
					style={ {
						marginTop: '16px',
						display: 'flex',
						flexWrap: 'wrap',
						alignItems: 'center',
						gap: '12px',
					} }
				>
					<Button
						variant="primary"
						onClick={ handleSave }
						isBusy={ isSaving }
						disabled={ isSaving }
					>
						{ isSaving
							? __( 'Saving…', 'fair-payments-connector' )
							: __(
									'Save privacy settings',
									'fair-payments-connector'
								) }
					</Button>
					{ isDirty && ! isSaving && (
						<span>
							{ __(
								'You have unsaved changes.',
								'fair-payments-connector'
							) }
						</span>
					) }
				</div>
			</CardBody>
		</Card>
	);
}

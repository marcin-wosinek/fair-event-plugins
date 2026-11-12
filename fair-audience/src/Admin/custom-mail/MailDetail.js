/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect, useRef } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
	Spinner,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { loadCustomMail } from './custom-mail-api.js';
import { audienceOf, formatSentAt, subjectOf } from './mail-format.js';
import { isModifiedClick, viewUrl } from './mail-route.js';

/**
 * Why a message could not be shown, in words for the organizer.
 *
 * @param {Object} error Error thrown by apiFetch.
 * @return {{kind: string, message: string}} Error kind and message.
 */
function describeError( error ) {
	const status = error?.data?.status;
	if ( status === 404 ) {
		return {
			kind: 'missing',
			message: __(
				'This email is no longer in Mail History. Its record may have been deleted.',
				'fair-audience'
			),
		};
	}
	if ( status === 401 || status === 403 ) {
		return {
			kind: 'forbidden',
			message: __(
				'You do not have permission to view sent emails.',
				'fair-audience'
			),
		};
	}
	return {
		kind: 'failed',
		message:
			error?.message ||
			__( 'The email could not be loaded. Try again.', 'fair-audience' ),
	};
}

/**
 * Read-only view of one recorded Custom Mail message.
 *
 * Shows the message as it was saved. Nothing here sends email or touches the
 * composer's draft.
 *
 * @param {Object}   props             Component props.
 * @param {number}   props.id          Message ID.
 * @param {Function} props.onBack      Called when "Back to Mail History" is
 *                                     followed in this tab.
 * @param {boolean}  [props.focusOnLoad] Move focus to the heading once loaded,
 *                                     after an in-page navigation.
 * @return {JSX.Element} The detail view.
 */
export default function MailDetail( { id, onBack, focusOnLoad = false } ) {
	const [ state, setState ] = useState( {
		status: 'loading',
		mail: null,
		error: null,
	} );
	const [ attempt, setAttempt ] = useState( 0 );
	const headingRef = useRef( null );

	useEffect( () => {
		// Only the answer for the message still on screen is kept.
		let current = true;
		setState( { status: 'loading', mail: null, error: null } );
		loadCustomMail( id )
			.then( ( mail ) => {
				if ( current ) {
					setState( { status: 'ready', mail, error: null } );
				}
			} )
			.catch( ( error ) => {
				if ( current ) {
					setState( {
						status: 'error',
						mail: null,
						error: describeError( error ),
					} );
				}
			} );
		return () => {
			current = false;
		};
	}, [ id, attempt ] );

	useEffect( () => {
		if ( focusOnLoad && state.status !== 'loading' ) {
			headingRef.current?.focus();
		}
	}, [ focusOnLoad, state.status ] );

	const backLink = (
		<p className="fair-audience-custom-mail__back">
			<a
				href={ viewUrl( null ) }
				onClick={ ( event ) => {
					if ( isModifiedClick( event ) ) {
						return;
					}
					event.preventDefault();
					onBack();
				} }
			>
				&larr; { __( 'Back to Mail History', 'fair-audience' ) }
			</a>
		</p>
	);

	if ( state.status === 'loading' ) {
		return (
			<div className="wrap fair-audience-custom-mail">
				{ backLink }
				<h1>{ __( 'Sent email', 'fair-audience' ) }</h1>
				<div className="fair-audience-custom-mail__loading">
					<Spinner />
					{ __( 'Loading the email…', 'fair-audience' ) }
				</div>
			</div>
		);
	}

	if ( state.status === 'error' ) {
		return (
			<div className="wrap fair-audience-custom-mail">
				{ backLink }
				<h1 ref={ headingRef } tabIndex={ -1 }>
					{ state.error.kind === 'missing'
						? __( 'Email not found', 'fair-audience' )
						: __( 'Sent email', 'fair-audience' ) }
				</h1>
				<Notice
					status={
						state.error.kind === 'missing' ? 'warning' : 'error'
					}
					isDismissible={ false }
				>
					{ state.error.message }
				</Notice>
				{ state.error.kind === 'failed' && (
					<Button
						variant="secondary"
						onClick={ () => setAttempt( ( n ) => n + 1 ) }
					>
						{ __( 'Try again', 'fair-audience' ) }
					</Button>
				) }
			</div>
		);
	}

	const { mail } = state;

	return (
		<div className="wrap fair-audience-custom-mail">
			{ backLink }
			<h1
				ref={ headingRef }
				tabIndex={ -1 }
				className="fair-audience-custom-mail__detail-title"
			>
				{ subjectOf( mail ) }
			</h1>

			<Card className="fair-audience-custom-mail__detail">
				<CardBody>
					<dl className="fair-audience-custom-mail__meta">
						<div>
							<dt>{ __( 'Sent to', 'fair-audience' ) }</dt>
							<dd>{ audienceOf( mail ) }</dd>
						</div>
						<div>
							<dt>{ __( 'Date', 'fair-audience' ) }</dt>
							<dd>{ formatSentAt( mail.created_at ) }</dd>
						</div>
						<div>
							<dt>{ __( 'Sent', 'fair-audience' ) }</dt>
							<dd>{ mail.sent_count }</dd>
						</div>
						<div>
							<dt>{ __( 'Failed', 'fair-audience' ) }</dt>
							<dd>{ mail.failed_count }</dd>
						</div>
						<div>
							<dt>{ __( 'Skipped', 'fair-audience' ) }</dt>
							<dd>{ mail.skipped_count }</dd>
						</div>
						<div>
							<dt>
								{ __( 'Marketing email', 'fair-audience' ) }
							</dt>
							<dd>
								{ mail.is_marketing
									? __( 'Yes', 'fair-audience' )
									: __( 'No', 'fair-audience' ) }
							</dd>
						</div>
					</dl>
				</CardBody>
			</Card>

			<Card className="fair-audience-custom-mail__detail">
				<CardHeader>
					<h2 className="fair-audience-custom-mail__card-title">
						{ __( 'Content', 'fair-audience' ) }
					</h2>
				</CardHeader>
				<CardBody>
					<p className="fair-audience-custom-mail__help">
						{ __(
							'This is the email as it was written. Placeholders in braces were filled in with each recipient’s own details when it was sent.',
							'fair-audience'
						) }
					</p>
					<div
						className="fair-audience-custom-mail__content"
						// The server sanitizes the saved body with wp_kses_post().
						dangerouslySetInnerHTML={ { __html: mail.content } }
					/>
				</CardBody>
			</Card>
		</div>
	);
}

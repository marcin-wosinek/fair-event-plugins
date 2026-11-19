/**
 * WordPress dependencies
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import { useState, useRef } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
	RadioControl,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { confirmChoice, cancelChoice } from './api.js';

const helpStyle = { color: '#50575e', marginTop: 0 };
const rowStyle = {
	display: 'flex',
	flexWrap: 'wrap',
	gap: '8px',
	alignItems: 'center',
};

/**
 * Whether an error says the choice is no longer the administrator's
 * current one (expired, cancelled, replaced or already used).
 *
 * @param {Object} error apiFetch error.
 * @return {boolean} True when the choice is gone.
 */
function isChoiceGone( error ) {
	return error?.code === 'instagram_choice_unknown';
}

/**
 * Choose which of the Instagram accounts Meta shared this site publishes to.
 * Nothing is selected at first; only **Connect selected account** saves the
 * choice. The current connection is kept until then.
 *
 * Render with `key={ choice.id }`, so a new choice starts unselected.
 *
 * @param {Object}                    props             Props.
 * @param {Object}                    props.choice      Pending choice: `id` and `accounts`.
 * @param {Object}                    props.connection  Current connection details.
 * @param {(details: Object) => void} props.onConnected Called with the new connection details.
 * @param {(details: Object) => void} props.onCancelled Called with the connection details.
 * @param {(message: string) => void} props.onGone      Called with a message when the choice no longer exists.
 * @return {Element} The card.
 */
export default function AccountChoice( {
	choice,
	connection,
	onConnected,
	onCancelled,
	onGone,
} ) {
	const [ selected, setSelected ] = useState( null );
	const [ pending, setPending ] = useState( null );
	const [ error, setError ] = useState( null );
	const inFlight = useRef( false );

	const run = ( action, request, onSuccess, fallback ) => {
		if ( inFlight.current ) {
			return;
		}
		inFlight.current = true;
		setPending( action );
		setError( null );
		request()
			.then( ( details ) => {
				inFlight.current = false;
				onSuccess( details );
			} )
			.catch( ( failure ) => {
				inFlight.current = false;
				setPending( null );
				const message = failure?.message || fallback;
				if ( isChoiceGone( failure ) ) {
					onGone( message );
				} else {
					setError( message );
				}
			} );
	};

	const handleConfirm = () => {
		if ( ! selected ) {
			return;
		}
		run(
			'confirm',
			() => confirmChoice( { choice: choice.id, accountId: selected } ),
			onConnected,
			__(
				'The selected Instagram account could not be connected. Nothing was changed; try again.',
				'fair-events-experimental'
			)
		);
	};

	const handleCancel = () => {
		run(
			'cancel',
			() => cancelChoice( choice.id ),
			onCancelled,
			__(
				'The account choice could not be cancelled. Try again.',
				'fair-events-experimental'
			)
		);
	};

	const isBusy = pending !== null;
	const current = connection.connected ? connection.user_id : null;

	let keepText = null;
	if ( connection.connected && connection.username ) {
		keepText = sprintf(
			/* translators: %s: Instagram username */
			__(
				'This site stays connected to @%s until you connect the selected account.',
				'fair-events-experimental'
			),
			connection.username
		);
	} else if ( connection.connected ) {
		keepText = __(
			'This site stays connected to its current Instagram account until you connect the selected account.',
			'fair-events-experimental'
		);
	}

	const options = choice.accounts.map( ( account ) => ( {
		value: account.id,
		label:
			account.id === current
				? sprintf(
						/* translators: %s: Instagram username */
						__(
							'@%s (currently connected)',
							'fair-events-experimental'
						),
						account.username
					)
				: `@${ account.username }`,
	} ) );

	return (
		<Card
			style={ { marginBottom: '16px' } }
			className="fair-events-instagram-choice"
		>
			<CardHeader>
				<h2 style={ { margin: 0 } }>
					{ __(
						'Choose the Instagram account',
						'fair-events-experimental'
					) }
				</h2>
			</CardHeader>
			<CardBody>
				<p style={ helpStyle }>
					{ sprintf(
						/* translators: %d: number of Instagram accounts */
						_n(
							'Meta shared %d Instagram account. Choose the one this site publishes to.',
							'Meta shared %d Instagram accounts. Choose the one this site publishes to.',
							choice.accounts.length,
							'fair-events-experimental'
						),
						choice.accounts.length
					) }
				</p>
				{ keepText && <p style={ helpStyle }>{ keepText }</p> }
				<div style={ { overflowWrap: 'anywhere' } }>
					<RadioControl
						label={ __(
							'Instagram account',
							'fair-events-experimental'
						) }
						selected={ selected ?? undefined }
						options={ options }
						onChange={ ( value ) => {
							if ( ! isBusy ) {
								setSelected( value );
								setError( null );
							}
						} }
						disabled={ isBusy }
					/>
				</div>
				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) }
				<div style={ { ...rowStyle, marginTop: '16px' } }>
					<Button
						variant="primary"
						onClick={ handleConfirm }
						isBusy={ pending === 'confirm' }
						disabled={ ! selected || isBusy }
					>
						{ __(
							'Connect selected account',
							'fair-events-experimental'
						) }
					</Button>
					<Button
						variant="tertiary"
						onClick={ handleCancel }
						isBusy={ pending === 'cancel' }
						disabled={ isBusy }
					>
						{ __( 'Cancel', 'fair-events-experimental' ) }
					</Button>
					{ ! selected && (
						<span style={ helpStyle }>
							{ __(
								'Choose an account to connect it.',
								'fair-events-experimental'
							) }
						</span>
					) }
				</div>
			</CardBody>
		</Card>
	);
}

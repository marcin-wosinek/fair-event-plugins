import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	CheckboxControl,
	ExternalLink,
	Flex,
	FlexItem,
	Notice,
	SelectControl,
	TextControl,
} from '@wordpress/components';

const PATH = '/fair-events-experimental/v1/whatsapp';

// Re-read when the page regains focus: the token is managed in Connectors,
// usually in another tab, and replacing it invalidates the validation.
const REMOTE_FIELDS = [ 'token_configured', 'token_source', 'validation' ];

const ID_PATTERN = /^\d{0,32}$/;

/**
 * What the administrator should know about the access token: whether one is
 * configured and where it comes from. A configured token is not proof that
 * Meta accepts it.
 *
 * @param {Object} config WhatsApp settings payload.
 * @return {{status: string, message: string}} Notice status and text.
 */
export function tokenStatus( config ) {
	const name = config.token_override_name;
	if ( ! config.token_configured ) {
		return {
			status: 'warning',
			message: __(
				'No WhatsApp access token is configured. Add one in Connectors.',
				'fair-events-experimental'
			),
		};
	}
	if ( 'env' === config.token_source ) {
		return {
			status: 'info',
			message: sprintf(
				/* translators: %s: environment variable name */
				__(
					'The access token comes from the %s environment variable, which overrides any token saved in Connectors. Validate the connection to confirm Meta accepts it.',
					'fair-events-experimental'
				),
				name
			),
		};
	}
	if ( 'constant' === config.token_source ) {
		return {
			status: 'info',
			message: sprintf(
				/* translators: %s: PHP constant name */
				__(
					'The access token comes from the %s constant, which overrides any token saved in Connectors. Validate the connection to confirm Meta accepts it.',
					'fair-events-experimental'
				),
				name
			),
		};
	}
	return {
		status: 'info',
		message: __(
			'An access token is saved in Connectors. It is not shown here. Validate the connection to confirm Meta accepts it.',
			'fair-events-experimental'
		),
	};
}

/**
 * Meta's error code and trace ID of a failure, for support requests.
 *
 * @param {Object} data Error data from the API.
 * @return {string} Detail line, or an empty string.
 */
export function errorDetail( data ) {
	const parts = [];
	if ( data?.meta_code ) {
		parts.push(
			sprintf(
				/* translators: %d: numeric error code reported by Meta */
				__( 'Meta error code: %d', 'fair-events-experimental' ),
				data.meta_code
			)
		);
	}
	if ( data?.trace_id ) {
		parts.push(
			sprintf(
				/* translators: %s: Meta trace ID */
				__( 'Trace ID: %s', 'fair-events-experimental' ),
				data.trace_id
			)
		);
	}
	return parts.join( ' · ' );
}

/**
 * The message of a failed request, or a fallback when it carries none.
 *
 * @param {Object} error    apiFetch error.
 * @param {string} fallback Message to use otherwise.
 * @return {string} Message.
 */
function errorMessage( error, fallback ) {
	return typeof error?.message === 'string' && error?.code
		? error.message
		: fallback;
}

/**
 * The last validation: who the sender is and when it was checked.
 *
 * @param {Object} props
 * @param {Object} props.validation Validation from the API.
 * @return {Element} Sender summary.
 */
function SenderSummary( { validation } ) {
	const { sender } = validation;
	return (
		<Notice status="success" isDismissible={ false }>
			<p>
				{ sprintf(
					/* translators: 1: sender's verified business name, 2: sender's telephone number, 3: date and time of the validation */
					__(
						'Connection validated: messages are sent as %1$s (%2$s). Checked on %3$s.',
						'fair-events-experimental'
					),
					sender.verified_name ||
						__( '(no display name)', 'fair-events-experimental' ),
					sender.display_phone_number ||
						__( 'number not reported', 'fair-events-experimental' ),
					validation.validated_at_local
				) }
			</p>
			{ sender.quality_rating && (
				<p>
					{ sprintf(
						/* translators: %s: quality rating reported by Meta, such as GREEN */
						__( 'Quality rating: %s', 'fair-events-experimental' ),
						sender.quality_rating
					) }
				</p>
			) }
		</Notice>
	);
}

/**
 * Result of the last test send. Acceptance is not delivery.
 *
 * @param {Object} props
 * @param {Object} props.result Test send result.
 * @return {Element} Result box.
 */
function TestResult( { result } ) {
	let title = __( 'Not sent', 'fair-events-experimental' );
	if ( result.accepted ) {
		title = __( 'Accepted by WhatsApp', 'fair-events-experimental' );
	} else if ( 'uncertain' === result.outcome ) {
		title = __( 'Outcome unknown', 'fair-events-experimental' );
	}
	return (
		<div
			role="status"
			style={ {
				border: '1px solid #e0e0e0',
				padding: '8px 12px',
				marginTop: '16px',
				overflowWrap: 'anywhere',
			} }
		>
			<h3 style={ { marginTop: 0 } }>{ title }</h3>
			<p>{ result.message }</p>
			{ result.detail && (
				<p style={ { color: '#757575' } }>{ result.detail }</p>
			) }
		</div>
	);
}

/**
 * Fair Events → WhatsApp: save the sender's IDs, validate them against Meta
 * and send one approved template to an authorized recipient.
 *
 * @param {Object}   props
 * @param {Function} props.onNotice Shows a page-level notice.
 * @return {Element} The connection settings.
 */
export default function WhatsAppConnection( { onNotice } ) {
	const [ config, setConfig ] = useState( null );
	const [ savedConfig, setSavedConfig ] = useState( null );
	const [ saving, setSaving ] = useState( false );
	const [ validating, setValidating ] = useState( false );
	const [ validationError, setValidationError ] = useState( null );
	const [ templates, setTemplates ] = useState( {
		state: 'idle',
		items: [],
		error: null,
	} );
	const [ template, setTemplate ] = useState( '' );
	const [ recipient, setRecipient ] = useState( '' );
	const [ authorized, setAuthorized ] = useState( false );
	const [ sending, setSending ] = useState( false );
	const [ result, setResult ] = useState( null );

	const applyConfig = ( next ) => {
		setConfig( next );
		setSavedConfig( next );
	};

	useEffect( () => {
		apiFetch( { path: PATH } )
			.then( applyConfig )
			.catch( () =>
				onNotice( {
					status: 'error',
					message: __(
						'Failed to load the WhatsApp settings.',
						'fair-events-experimental'
					),
				} )
			);
	}, [] );

	const refreshRemote = useCallback( () => {
		if ( 'hidden' === document.visibilityState ) {
			return;
		}
		apiFetch( { path: PATH } )
			.then( ( next ) => {
				const remote = Object.fromEntries(
					REMOTE_FIELDS.map( ( field ) => [ field, next[ field ] ] )
				);
				const merge = ( current ) =>
					current ? { ...current, ...remote } : current;
				setConfig( merge );
				setSavedConfig( merge );
			} )
			.catch( () => {} );
	}, [] );
	useEffect( () => {
		window.addEventListener( 'focus', refreshRemote );
		document.addEventListener( 'visibilitychange', refreshRemote );
		return () => {
			window.removeEventListener( 'focus', refreshRemote );
			document.removeEventListener( 'visibilitychange', refreshRemote );
		};
	}, [ refreshRemote ] );

	const validatedAt = savedConfig?.validation?.validated_at || '';
	const loadTemplates = useCallback( () => {
		setTemplates( ( current ) => ( {
			...current,
			state: 'loading',
			error: null,
		} ) );
		apiFetch( { path: `${ PATH }/templates` } )
			.then( ( items ) => {
				setTemplates( { state: 'ready', items, error: null } );
				setTemplate( ( current ) =>
					items.some(
						( item ) =>
							`${ item.name }|${ item.language }` === current
					)
						? current
						: ''
				);
			} )
			.catch( ( error ) =>
				setTemplates( {
					state: 'error',
					items: [],
					error: {
						message: errorMessage(
							error,
							__(
								'Failed to load the templates.',
								'fair-events-experimental'
							)
						),
						detail: errorDetail( error?.data ),
					},
				} )
			);
	}, [] );
	useEffect( () => {
		if ( validatedAt ) {
			loadTemplates();
		} else {
			setTemplates( { state: 'idle', items: [], error: null } );
		}
	}, [ validatedAt, loadTemplates ] );

	const dirty =
		!! config &&
		( config.waba_id !== savedConfig.waba_id ||
			config.phone_number_id !== savedConfig.phone_number_id );
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

	if ( ! config ) {
		return (
			<p>
				{ __(
					'Loading WhatsApp settings…',
					'fair-events-experimental'
				) }
			</p>
		);
	}

	const busy = saving || validating || sending;
	const wabaValid = ID_PATTERN.test( config.waba_id.trim() );
	const phoneValid = ID_PATTERN.test( config.phone_number_id.trim() );

	let saveBlocker = null;
	if ( ! wabaValid || ! phoneValid ) {
		saveBlocker = __(
			'IDs contain digits only. Fix the highlighted field to save.',
			'fair-events-experimental'
		);
	} else if ( ! dirty ) {
		saveBlocker = __( 'No unsaved changes.', 'fair-events-experimental' );
	}

	let validateBlocker = null;
	if ( ! config.token_configured ) {
		validateBlocker = __(
			'Add a WhatsApp access token in Connectors before validating the connection.',
			'fair-events-experimental'
		);
	} else if ( ! savedConfig.waba_id || ! savedConfig.phone_number_id ) {
		validateBlocker = __(
			'Save the WhatsApp Business Account ID and the Phone Number ID before validating the connection.',
			'fair-events-experimental'
		);
	} else if ( dirty ) {
		validateBlocker = __(
			'Save or discard your changes before validating: validation checks the saved settings, not what is in the fields.',
			'fair-events-experimental'
		);
	}

	const selected = templates.items.find(
		( item ) => `${ item.name }|${ item.language }` === template
	);
	let sendBlocker = null;
	if ( ! savedConfig.validation || dirty ) {
		sendBlocker = __(
			'Validate the connection with the saved settings to send a test template.',
			'fair-events-experimental'
		);
	} else if ( 'ready' === templates.state && ! templates.items.length ) {
		sendBlocker = __(
			'This account has no approved templates without parameters. Create one in WhatsApp Manager, or use hello_world, then reload the templates.',
			'fair-events-experimental'
		);
	} else if ( ! selected ) {
		sendBlocker = __(
			'Choose a template to send.',
			'fair-events-experimental'
		);
	} else if ( ! recipient.trim() ) {
		sendBlocker = __(
			'Enter the recipient number.',
			'fair-events-experimental'
		);
	} else if ( ! authorized ) {
		sendBlocker = __(
			'Confirm that the recipient agreed to receive this test message.',
			'fair-events-experimental'
		);
	}

	const save = async () => {
		setSaving( true );
		try {
			applyConfig(
				await apiFetch( {
					path: PATH,
					method: 'POST',
					data: {
						waba_id: config.waba_id.trim(),
						phone_number_id: config.phone_number_id.trim(),
					},
				} )
			);
			setValidationError( null );
			onNotice( {
				status: 'success',
				message: __(
					'WhatsApp settings saved. Validate the connection to check them with Meta.',
					'fair-events-experimental'
				),
			} );
		} catch ( error ) {
			onNotice( {
				status: 'error',
				message: errorMessage(
					error,
					__(
						'Failed to save the WhatsApp settings.',
						'fair-events-experimental'
					)
				),
			} );
		}
		setSaving( false );
	};

	const validate = async () => {
		setValidating( true );
		setValidationError( null );
		try {
			applyConfig(
				await apiFetch( {
					path: `${ PATH }/validate`,
					method: 'POST',
				} )
			);
		} catch ( error ) {
			setValidationError( {
				message: errorMessage(
					error,
					__(
						'The connection could not be validated.',
						'fair-events-experimental'
					)
				),
				detail: errorDetail( error?.data ),
			} );
			// A failed validation clears the previous one on the server.
			const clear = ( current ) => ( { ...current, validation: null } );
			setConfig( clear );
			setSavedConfig( clear );
		}
		setValidating( false );
	};

	const sendTest = async () => {
		setSending( true );
		setResult( null );
		try {
			const response = await apiFetch( {
				path: `${ PATH }/test`,
				method: 'POST',
				data: {
					recipient: recipient.trim(),
					template_name: selected.name,
					template_language: selected.language,
					authorized: true,
				},
			} );
			setResult( {
				accepted: true,
				outcome: 'accepted',
				message: sprintf(
					/* translators: 1: template name, 2: template language code, 3: recipient number with most digits hidden */
					__(
						'WhatsApp accepted the %1$s (%2$s) template for %3$s. This does not confirm delivery: ask the recipient whether it arrived.',
						'fair-events-experimental'
					),
					response.template.name,
					response.template.language,
					response.recipient
				),
				detail: '',
			} );
		} catch ( error ) {
			setResult( {
				accepted: false,
				outcome: error?.data?.outcome || 'not_sent',
				message: errorMessage(
					error,
					__(
						'The test template could not be sent.',
						'fair-events-experimental'
					)
				),
				detail: errorDetail( error?.data ),
			} );
		}
		// Each send needs its own confirmation.
		setAuthorized( false );
		setSending( false );
	};

	const token = tokenStatus( config );
	const idField = ( key, label, help, valid ) => (
		<TextControl
			__nextHasNoMarginBottom
			__next40pxDefaultSize
			label={ label }
			help={
				valid
					? help
					: __( 'Use digits only.', 'fair-events-experimental' )
			}
			value={ config[ key ] }
			inputMode="numeric"
			autoComplete="off"
			aria-invalid={ ! valid }
			onChange={ ( value ) => setConfig( { ...config, [ key ]: value } ) }
		/>
	);

	return (
		<>
			<Card style={ { marginTop: '16px' } }>
				<CardHeader>
					<h2>{ __( 'Connection', 'fair-events-experimental' ) }</h2>
				</CardHeader>
				<CardBody>
					<Notice status={ token.status } isDismissible={ false }>
						{ token.message }{ ' ' }
						<ExternalLink href={ config.connectors_url }>
							{ __(
								'Manage in Connectors',
								'fair-events-experimental'
							) }
						</ExternalLink>
					</Notice>
					<div
						style={ {
							display: 'grid',
							gap: '16px',
							marginTop: '16px',
						} }
					>
						{ idField(
							'waba_id',
							__(
								'WhatsApp Business Account ID',
								'fair-events-experimental'
							),
							__(
								'Shown in the App Dashboard under WhatsApp → API Setup, and in WhatsApp Manager. It is an account ID, not a telephone number.',
								'fair-events-experimental'
							),
							wabaValid
						) }
						{ idField(
							'phone_number_id',
							__( 'Phone Number ID', 'fair-events-experimental' ),
							__(
								'The ID Meta assigns to the sender number, shown under WhatsApp → API Setup. It differs from the telephone number itself.',
								'fair-events-experimental'
							),
							phoneValid
						) }
					</div>
					<Flex
						wrap
						justify="flex-start"
						gap={ 2 }
						style={ { marginTop: '16px' } }
					>
						<FlexItem>
							<Button
								variant="primary"
								onClick={ save }
								isBusy={ saving }
								disabled={ busy || !! saveBlocker }
							>
								{ __(
									'Save settings',
									'fair-events-experimental'
								) }
							</Button>
						</FlexItem>
						{ dirty && (
							<FlexItem>
								<Button
									variant="tertiary"
									onClick={ () => setConfig( savedConfig ) }
									disabled={ busy }
								>
									{ __(
										'Discard changes',
										'fair-events-experimental'
									) }
								</Button>
							</FlexItem>
						) }
						<FlexItem>
							<Button
								variant="secondary"
								onClick={ validate }
								isBusy={ validating }
								disabled={ busy || !! validateBlocker }
							>
								{ __(
									'Validate connection',
									'fair-events-experimental'
								) }
							</Button>
						</FlexItem>
					</Flex>
					{ saveBlocker && dirty && (
						<p className="description">{ saveBlocker }</p>
					) }
					{ validateBlocker && (
						<p className="description">{ validateBlocker }</p>
					) }
					<div role="status" style={ { marginTop: '16px' } }>
						{ validating && (
							<p>
								{ __(
									'Checking the connection with Meta…',
									'fair-events-experimental'
								) }
							</p>
						) }
						{ ! validating && validationError && (
							<Notice status="error" isDismissible={ false }>
								<p>{ validationError.message }</p>
								{ validationError.detail && (
									<p>{ validationError.detail }</p>
								) }
							</Notice>
						) }
						{ ! validating &&
							! validationError &&
							savedConfig.validation && (
								<SenderSummary
									validation={ savedConfig.validation }
								/>
							) }
						{ ! validating &&
							! validationError &&
							! savedConfig.validation &&
							savedConfig.waba_id &&
							savedConfig.phone_number_id && (
								<p>
									{ __(
										'Settings saved, not validated.',
										'fair-events-experimental'
									) }
								</p>
							) }
					</div>
				</CardBody>
			</Card>

			<Card style={ { marginTop: '16px' } }>
				<CardHeader>
					<h2>
						{ __(
							'Send a test template',
							'fair-events-experimental'
						) }
					</h2>
				</CardHeader>
				<CardBody>
					<p>
						{ __(
							'Sends one approved template without parameters, once. Only send to someone who agreed to receive it. The recipient number is not stored.',
							'fair-events-experimental'
						) }
					</p>
					{ 'loading' === templates.state && (
						<p>
							{ __(
								'Loading templates…',
								'fair-events-experimental'
							) }
						</p>
					) }
					{ 'error' === templates.state && (
						<Notice status="error" isDismissible={ false }>
							<p>{ templates.error.message }</p>
							{ templates.error.detail && (
								<p>{ templates.error.detail }</p>
							) }
						</Notice>
					) }
					<div style={ { display: 'grid', gap: '16px' } }>
						<SelectControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							label={ __(
								'Template',
								'fair-events-experimental'
							) }
							value={ template }
							disabled={
								sending || 'ready' !== templates.state || dirty
							}
							options={ [
								{
									value: '',
									label: __(
										'Choose a template',
										'fair-events-experimental'
									),
								},
								...templates.items.map( ( item ) => ( {
									value: `${ item.name }|${ item.language }`,
									label: `${ item.name } (${ item.language })`,
								} ) ),
							] }
							onChange={ setTemplate }
						/>
						<TextControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							label={ __(
								'Recipient number',
								'fair-events-experimental'
							) }
							help={ __(
								'International format with the country code, such as +34 600 123 456. A test sender only reaches numbers added in the App Dashboard.',
								'fair-events-experimental'
							) }
							type="tel"
							autoComplete="off"
							value={ recipient }
							disabled={ sending }
							onChange={ setRecipient }
						/>
						<CheckboxControl
							__nextHasNoMarginBottom
							label={ __(
								'The recipient agreed to receive this test message.',
								'fair-events-experimental'
							) }
							checked={ authorized }
							disabled={ sending }
							onChange={ setAuthorized }
						/>
					</div>
					<Flex
						wrap
						justify="flex-start"
						gap={ 2 }
						style={ { marginTop: '16px' } }
					>
						<FlexItem>
							<Button
								variant="primary"
								onClick={ sendTest }
								isBusy={ sending }
								disabled={ busy || !! sendBlocker }
							>
								{ __(
									'Send test template',
									'fair-events-experimental'
								) }
							</Button>
						</FlexItem>
						{ !! savedConfig.validation && ! dirty && (
							<FlexItem>
								<Button
									variant="tertiary"
									onClick={ loadTemplates }
									disabled={
										busy || 'loading' === templates.state
									}
								>
									{ __(
										'Reload templates',
										'fair-events-experimental'
									) }
								</Button>
							</FlexItem>
						) }
					</Flex>
					{ sendBlocker && (
						<p className="description">{ sendBlocker }</p>
					) }
					{ sending && (
						<p role="status">
							{ __(
								'Sending the test template…',
								'fair-events-experimental'
							) }
						</p>
					) }
					{ result && <TestResult result={ result } /> }
				</CardBody>
			</Card>
		</>
	);
}

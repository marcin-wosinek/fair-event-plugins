/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useCallback } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	Modal,
	TextControl,
	CheckboxControl,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { loadApiTokens, createApiToken, revokeApiToken } from './settings-api';

const DEFAULT_SCOPES = [ 'transactions:read' ];

/**
 * Scopes offered for a new token. Older tokens can list scopes that are no
 * longer offered; those are shown as stored.
 *
 * @return {Array<{value: string, label: string}>} Scope options
 */
function availableScopes() {
	return [
		{
			value: 'transactions:read',
			label: __( 'Read transactions', 'fair-payments-connector' ),
		},
	];
}

/**
 * Token timestamps are stored in UTC; say so rather than let them pass for
 * site-local times.
 *
 * @param {string} value MySQL datetime in UTC.
 * @return {string} Display value
 */
function formatUtc( value ) {
	return sprintf(
		/* translators: %s: date and time, e.g. 2026-01-31 14:05 */
		__( '%s UTC', 'fair-payments-connector' ),
		value.slice( 0, 16 )
	);
}

/**
 * API Tokens Tab Component
 *
 * Issues, lists and revokes the scoped tokens other sites use to read this
 * site's transactions over the data sharing API. A token's plaintext exists
 * only in this component's state, between its creation and the moment the
 * dialog closes or the tab is left.
 *
 * @return {JSX.Element} The API tokens tab
 */
export default function ApiTokensTab() {
	const [ tokens, setTokens ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ loadError, setLoadError ] = useState( null );
	const [ success, setSuccess ] = useState( null );

	// Creation dialog: null while closed, otherwise the form or, once the
	// token exists, its one-time plaintext.
	const [ creation, setCreation ] = useState( null );
	// Revoke dialog: null while closed, otherwise the token being revoked.
	const [ revocation, setRevocation ] = useState( null );

	const load = useCallback( () => {
		setLoading( true );
		setLoadError( null );

		return loadApiTokens()
			.then( ( data ) => {
				setTokens( Array.isArray( data ) ? data : [] );
			} )
			.catch( ( err ) => {
				setLoadError(
					err.message ||
						__(
							'Failed to load API tokens.',
							'fair-payments-connector'
						)
				);
			} )
			.finally( () => setLoading( false ) );
	}, [] );

	useEffect( () => {
		load();
	}, [ load ] );

	const openCreation = () => {
		setSuccess( null );
		setCreation( {
			label: '',
			scopes: DEFAULT_SCOPES,
			saving: false,
			error: null,
			token: null,
			copied: null,
		} );
	};

	// Closing drops the plaintext token for good.
	const closeCreation = () => setCreation( null );

	const updateCreation = ( changes ) =>
		setCreation( ( current ) =>
			current ? { ...current, ...changes } : current
		);

	const labelMissing = creation ? creation.label.trim() === '' : false;
	const scopesMissing = creation ? creation.scopes.length === 0 : false;
	const canCreate =
		!! creation && ! creation.saving && ! labelMissing && ! scopesMissing;

	const handleCreate = ( event ) => {
		event.preventDefault();
		if ( ! canCreate ) {
			return;
		}

		updateCreation( { saving: true, error: null } );

		createApiToken( {
			label: creation.label.trim(),
			scopes: creation.scopes,
		} )
			.then( ( response ) => {
				updateCreation( { saving: false, token: response.token } );
				load();
			} )
			.catch( ( err ) => {
				updateCreation( {
					saving: false,
					error:
						err.message ||
						__(
							'Failed to create API token.',
							'fair-payments-connector'
						),
				} );
			} );
	};

	const handleCopy = () => {
		const copy = window.navigator.clipboard
			? window.navigator.clipboard.writeText( creation.token )
			: Promise.reject( new Error( 'Clipboard unavailable' ) );

		copy.then(
			() => updateCreation( { copied: 'done' } ),
			() => updateCreation( { copied: 'failed' } )
		);
	};

	const closeRevocation = () => setRevocation( null );

	const handleRevoke = () => {
		const { token } = revocation;

		setRevocation( { token, saving: true, error: null } );

		revokeApiToken( token.id )
			.then( () => {
				setRevocation( null );
				setSuccess(
					sprintf(
						/* translators: %s: token label */
						__(
							'API token "%s" revoked.',
							'fair-payments-connector'
						),
						token.label
					)
				);
				load();
			} )
			.catch( ( err ) => {
				setRevocation( {
					token,
					saving: false,
					error:
						err.message ||
						__(
							'Failed to revoke API token.',
							'fair-payments-connector'
						),
				} );
			} );
	};

	return (
		<Card className="fair-payments-connector-api-tokens">
			<CardHeader className="fair-payments-connector-api-tokens__header">
				<h2 className="fair-payments-connector-api-tokens__title">
					{ __( 'API Tokens', 'fair-payments-connector' ) }
				</h2>
				<Button variant="primary" onClick={ openCreation }>
					{ __( 'Generate token', 'fair-payments-connector' ) }
				</Button>
			</CardHeader>
			<CardBody>
				<p className="fair-payments-connector-api-tokens__intro">
					{ __(
						"Issue tokens so other sites can read this site's transactions over the data sharing API.",
						'fair-payments-connector'
					) }
				</p>

				{ loadError && (
					<Notice status="error" isDismissible={ false }>
						{ loadError }
					</Notice>
				) }

				{ success && (
					<Notice
						status="success"
						isDismissible
						onRemove={ () => setSuccess( null ) }
					>
						{ success }
					</Notice>
				) }

				{ loading && tokens.length === 0 && <Spinner /> }

				{ ! loading && ! loadError && tokens.length === 0 && (
					<p>
						{ __(
							'No API tokens yet. Generate one to share transactions with another site.',
							'fair-payments-connector'
						) }
					</p>
				) }

				{ tokens.length > 0 && (
					<table className="widefat striped fair-payments-connector-api-tokens__table">
						<thead>
							<tr>
								<th scope="col">
									{ __( 'Label', 'fair-payments-connector' ) }
								</th>
								<th scope="col">
									{ __(
										'Scopes',
										'fair-payments-connector'
									) }
								</th>
								<th scope="col">
									{ __(
										'Created',
										'fair-payments-connector'
									) }
								</th>
								<th scope="col">
									{ __(
										'Last used',
										'fair-payments-connector'
									) }
								</th>
								<th scope="col">
									{ __(
										'Status',
										'fair-payments-connector'
									) }
								</th>
								<th scope="col">
									{ __(
										'Actions',
										'fair-payments-connector'
									) }
								</th>
							</tr>
						</thead>
						<tbody>
							{ tokens.map( ( token ) => (
								<tr key={ token.id }>
									<td
										data-label={ __(
											'Label',
											'fair-payments-connector'
										) }
									>
										<strong>
											{ token.label ||
												__(
													'(no label)',
													'fair-payments-connector'
												) }
										</strong>
									</td>
									<td
										data-label={ __(
											'Scopes',
											'fair-payments-connector'
										) }
									>
										{ ( token.scopes || [] ).join( ', ' ) ||
											'—' }
									</td>
									<td
										data-label={ __(
											'Created',
											'fair-payments-connector'
										) }
									>
										{ formatUtc( token.created_at ) }
									</td>
									<td
										data-label={ __(
											'Last used',
											'fair-payments-connector'
										) }
									>
										{ token.last_used_at
											? formatUtc( token.last_used_at )
											: __(
													'Never',
													'fair-payments-connector'
											  ) }
									</td>
									<td
										data-label={ __(
											'Status',
											'fair-payments-connector'
										) }
									>
										<span
											className={
												token.status === 'active'
													? 'fair-payments-connector-api-tokens__status is-active'
													: 'fair-payments-connector-api-tokens__status is-revoked'
											}
										>
											{ token.status === 'active'
												? __(
														'Active',
														'fair-payments-connector'
												  )
												: __(
														'Revoked',
														'fair-payments-connector'
												  ) }
										</span>
									</td>
									<td className="fair-payments-connector-api-tokens__actions">
										{ token.status === 'active' && (
											<Button
												variant="secondary"
												size="small"
												isDestructive
												onClick={ () => {
													setSuccess( null );
													setRevocation( {
														token,
														saving: false,
														error: null,
													} );
												} }
											>
												{ __(
													'Revoke',
													'fair-payments-connector'
												) }
											</Button>
										) }
									</td>
								</tr>
							) ) }
						</tbody>
					</table>
				) }
			</CardBody>

			{ creation && ! creation.token && (
				<Modal
					title={ __(
						'Generate API token',
						'fair-payments-connector'
					) }
					onRequestClose={ closeCreation }
					className="fair-payments-connector-api-tokens__dialog"
				>
					<form onSubmit={ handleCreate }>
						{ creation.error && (
							<Notice status="error" isDismissible={ false }>
								{ creation.error }
							</Notice>
						) }
						<TextControl
							label={ __( 'Label', 'fair-payments-connector' ) }
							value={ creation.label }
							onChange={ ( label ) =>
								updateCreation( { label } )
							}
							help={ __(
								'A name to identify who this token is for, e.g. the address of the site that will use it.',
								'fair-payments-connector'
							) }
							disabled={ creation.saving }
							__nextHasNoMarginBottom
							__next40pxDefaultSize
						/>
						<fieldset className="fair-payments-connector-api-tokens__scopes">
							<legend>
								{ __( 'Scopes', 'fair-payments-connector' ) }
							</legend>
							{ availableScopes().map( ( scope ) => (
								<CheckboxControl
									key={ scope.value }
									label={ scope.label }
									checked={ creation.scopes.includes(
										scope.value
									) }
									onChange={ ( checked ) =>
										updateCreation( {
											scopes: checked
												? [
														...creation.scopes,
														scope.value,
												  ]
												: creation.scopes.filter(
														( value ) =>
															value !==
															scope.value
												  ),
										} )
									}
									disabled={ creation.saving }
									__nextHasNoMarginBottom
								/>
							) ) }
						</fieldset>
						{ ( labelMissing || scopesMissing ) && (
							<p className="fair-payments-connector-api-tokens__hint">
								{ labelMissing
									? __(
											'Enter a label to generate the token.',
											'fair-payments-connector'
									  )
									: __(
											'Select at least one scope to generate the token.',
											'fair-payments-connector'
									  ) }
							</p>
						) }
						<div className="fair-payments-connector-api-tokens__buttons">
							<Button
								variant="tertiary"
								onClick={ closeCreation }
								disabled={ creation.saving }
							>
								{ __( 'Cancel', 'fair-payments-connector' ) }
							</Button>
							<Button
								variant="primary"
								type="submit"
								isBusy={ creation.saving }
								disabled={ ! canCreate }
							>
								{ creation.saving
									? __(
											'Generating…',
											'fair-payments-connector'
									  )
									: __(
											'Generate token',
											'fair-payments-connector'
									  ) }
							</Button>
						</div>
					</form>
				</Modal>
			) }

			{ creation && creation.token && (
				<Modal
					title={ __( 'Token created', 'fair-payments-connector' ) }
					onRequestClose={ closeCreation }
					className="fair-payments-connector-api-tokens__dialog"
				>
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'Copy this token now. For security it will not be shown again.',
							'fair-payments-connector'
						) }
					</Notice>
					<code className="fair-payments-connector-api-tokens__token">
						{ creation.token }
					</code>
					{ creation.copied === 'failed' && (
						<p className="fair-payments-connector-api-tokens__hint">
							{ __(
								'Copying failed. Select the token above and copy it manually.',
								'fair-payments-connector'
							) }
						</p>
					) }
					<div className="fair-payments-connector-api-tokens__buttons">
						<Button variant="secondary" onClick={ handleCopy }>
							{ creation.copied === 'done'
								? __( 'Copied!', 'fair-payments-connector' )
								: __(
										'Copy token',
										'fair-payments-connector'
								  ) }
						</Button>
						<Button variant="primary" onClick={ closeCreation }>
							{ __( 'Done', 'fair-payments-connector' ) }
						</Button>
					</div>
				</Modal>
			) }

			{ revocation && (
				<Modal
					title={ __(
						'Revoke API token',
						'fair-payments-connector'
					) }
					onRequestClose={
						revocation.saving ? () => {} : closeRevocation
					}
					isDismissible={ ! revocation.saving }
					className="fair-payments-connector-api-tokens__dialog"
				>
					{ revocation.error && (
						<Notice status="error" isDismissible={ false }>
							{ revocation.error }
						</Notice>
					) }
					<p>
						{ sprintf(
							/* translators: %s: token label */
							__(
								'Revoke the API token "%s"? Every site connected with it loses access to this site\'s transactions immediately. This cannot be undone.',
								'fair-payments-connector'
							),
							revocation.token.label
						) }
					</p>
					<div className="fair-payments-connector-api-tokens__buttons">
						<Button
							variant="tertiary"
							onClick={ closeRevocation }
							disabled={ revocation.saving }
						>
							{ __( 'Cancel', 'fair-payments-connector' ) }
						</Button>
						<Button
							variant="primary"
							isDestructive
							isBusy={ revocation.saving }
							disabled={ revocation.saving }
							onClick={ handleRevoke }
						>
							{ revocation.saving
								? __( 'Revoking…', 'fair-payments-connector' )
								: __(
										'Revoke token',
										'fair-payments-connector'
								  ) }
						</Button>
					</div>
				</Modal>
			) }
		</Card>
	);
}
